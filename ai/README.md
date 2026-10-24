# AI 逻辑模型

> [English](./README.en.md) | 中文

这个文件夹是《黑暗森林》的 AI 逻辑插件目录。主程序**不内置任何 AI 策略**：

- `ai/models/` 为空或不存在 → 服务端仍能启动，但房间内不能添加 AI，`开始对局` 会被禁用。
- 把模型 `.js` 放进 `ai/models/`，重启服务端即可安装。
- 正式对局开始前，房主可以在房间里逐个 AI 座位选择型号。
- 对局中没有任何聊天/交流通道；AI 模型只拿到自己的 `view`，`ctx.players` 不包含其他玩家的位置。

## 模型 API

`ai/models/*.js` 需要导出：

    export const meta = {
      id: 'my-ai',
      name: '我的 AI',
      version: '1.0.0',
      generation: 1,
      description: '一句话说明',
      default: false,   // 可选：默认型号
      external: false,  // 可选：需要外部推理服务
    };

    export function chooseAction(ctx) {
      // 可以返回 Promise（本地显卡模型就是异步的）
      return { type: 'hide' };
    }

可用行动：

    { type: 'hide' }
    { type: 'observe', dir: 1 | -1, length: 1..S }
    { type: 'attack', target: 0..S-1, dir: 1 | -1 } // 引擎内部 0-based
    { type: 'slip', dir: 1 | -1, distance: 1 | 2 }

`ctx` 包括：

- `round`、`S`、`P`、`map`（地形/轰炸/废墟）
- `me`：自己的位置/地形
- `players`：姓名、是否 AI、是否存活；**没有 position**
- `bomb`、`legal`
- `privateLog`：自己的观测红点、左右枪声、被伤害/死亡；开火结果不反馈
- `publicLog`：公开事件
- `memory`：跨回合持久对象
- `random()`：该 AI 自己的确定性随机数
- `helpers`：`mod`、`steps`、`attackArc`、`observeSegments`、`halfPlane`

模型只能通过这些信息推理，不能直接读引擎的其他玩家位置。

## 外部 JSON 模型

外部模型放在 `ai/external/{id}/model.json`，只支持声明式 JSON，不支持任意 JS。完整格式、条件、风格权重、限制和 LLM 生成提示见 [EXTERNAL-MODELS.md](./EXTERNAL-MODELS.md)。

## 已安装型号

- id：`adaptive`；名称：适应者；说明：2.3.3 默认。1v1 锁定（轰炸/单层废墟/旧点会让位）；全已知只搜可达池；枪声修正。
- id：`hunter`；名称：猎手；说明：2.3.3：1v1 锁定（轰炸/单层废墟/旧点会让位）；全已知只搜可达池。
- id：`survivor`；名称：潜行者；说明：2.3：1v1 锁定必杀；保命优先；低概率排点/盲狙。
- id：`balanced`；名称：灰烬；说明：2.3：1v1 锁定必杀；中局排点；残局换区与盲狙。
- id：`basic`；名称：守夜人；说明：旧版基线：柱上藏、原上观察，不移动不攻击。**不参与随机池**，只能手动选。
- id：`gpu`；名称：本地显卡模型；说明：2.3.0：通过本机 GPU 推理服务（当前 qwen2.5:3b）出决策；不可用时回退猎手 2.3。
- id：`apex`；名称：学徒·JSON；说明：0.1.0：从 adaptive 自博弈训练的全候选排序器；实验，不进随机池。
- id：`apex-safe`；名称：学徒·守门；说明：0.2.0：只在 4 人局 3–4 人存活时启用学生动作，其余回退 adaptive。

### 随机池

- “随机”只从 `randomPool !== false` 的模型里抽；
- `basic`（守夜人）只会藏/整圈观察，已标记 `randomPool: false`，**不进随机池**，但仍可手动选择；
- 其他 AI 2.2 模型和 `gpu` 仍在随机池。

### 本地模型 vs AI 2.2 胜率

2 人局、交替座位、GPU 模型 `qwen2.5:3b` 对 `adaptive`：

    node ai/sim/h2h.mjs --games=50 --opponent=adaptive

本次 50 局：

    gpu 15 : 31 adaptive，4 平
    gpu 胜率（不含平局）：32.6%
    平均 4.6 回合

但要看清代价：

    GPU 调用 228 次
    合法出招 44 次
    回退猎手 184 次（80.7%）

这 32.6% **不是纯本地模型实力**。  
另一组 20 局里 GPU 合法出招 87/92、回退 5 次，实际只赢了 1 局（5%）。

结论：qwen2.5:3b 目前不适合作为实战 AI；需要 7B/14B、约束解码或更小的动作分类头。  
行为克隆 checkpoint 还没有接回游戏，所以不能把它算进这个胜率。

## AI 2.3 行为

### 观测不再默认整圈

旧版 `observeAction()` 的 `full` 默认是 `true`，导致柱上 AI 也调用整圈观测；2.0 改成：

- **原上**：规则强制整圈，没有选择；
- **柱上**：按人数选择弧宽：
  - 2 人约半圈；
  - 3–4 人约 1/3 圈；
  - 5+ 人约 1/4 圈；
  - 有近期红点时，向红点方向收窄，避免整圈暴露。
- 观测方向优先覆盖近期已知红点；没有红点时左右轮换。

所以你在原上看到 AI 整圈，是规则/地形强制；柱上整圈是旧实现的 bug，2.0 已消除。

### 攻击不再永远选短弧

旧版 `attackAction()` 永远选 `min(d1,d2)`；2.0：

- **1v1 且双方都在柱上**：选长弧，互射时更长弧获胜；
- **3–4 人**：长/短弧各 50%，避免被读死；
- **5+ 人**：偏短弧，减少第三方暴露；
- **目标在原上**：短弧（原上没有互射保护）；
- 模型也可以显式要求 `{ mode: 'long' | 'short' }`；`survivor` 仍坚持短弧保命。

### 2.3.2 锁定必杀 / 轰炸规避 / 枪声修正

**1v1 锁定必杀**：`lockedDuelTarget()` 在只剩两人、最后敌人已被观测、且敌人所在段没有任何移动空间时，将其视为固定坐标。`lockAttack()` 由运行时强制执行长弧攻击；但如果 AI 自己站在下一轮轰炸目标上且存在合法逃生，则放弃锁定，先溜出轰炸区。`refreshKnown()` 还会用最近一次枪声半区丢弃与声音矛盾的旧红点，`blindTargets()` 在无红点时用枪声半区收窄候选池。

**中局排点**：`compartmentRisk()`/`compartmentGuard()` 会检查自己所在的轰炸隔断。若隔断较小、附近还有未清段、且自己已停留过久，会在藏身前先观测排点，避免被同隔断的人溜刀。为了避免过度观测，这个逻辑只在 3 人以上、且确实有近处未清段时以概率触发。

**残局机动**：`rankedMoves()` 在 3 人以下（或 5 人以下且已进入加速/双区轰炸）会把“下一步/两步还有多少出口”和“所在连通区有多大”计入移动评分。`endgameMove()` 会在以下情况主动换位：

- 当前所在区被下一轮废墟/轰炸预告切成小口袋；
- 当前段是只有一个出口的死胡同；
- 同一段停留过久，可能成为对方盲狙目标。

它不会读取其他玩家位置，只使用公开地图、当前/下一轮轰炸目标、自己的私密观测和公开存活信息。

**排除法盲狙**：`blindTargets()` 从自己的 `observe` 私密记录出发，按“已经过了几回合、最多能移动多远”展开候选段，并排除废墟/当前轰炸目标/自己所在段。`blindAttack()` 只在 3 人以下、候选池集中到某一段有足够权重时才会开枪；这既是盲狙，也是对被敌人盲狙的回应。

### 模拟行为指标

`ai/sim/run.js` 会统计每档：

- `observeFullRate`：整圈观测比例；
- `observePillarFull`：柱上整圈（2.0 应为 0）；
- `observePlainForced`：原上强制整圈；
- `attackLongRate`：长弧攻击比例。

500 局/档的 AI 2.3.3 结果（5 个模型混战，2/4/8 人）：

- 人数：2；整圈观测：17–100%；柱上整圈：0；长弧攻击：23–39%
- 人数：4；整圈观测：9–100%；柱上整圈：0；长弧攻击：38–100%
- 人数：8；整圈观测：8–100%；柱上整圈：0；长弧攻击：17–74%

整圈观测全部来自原上强制整圈；柱上整圈为 0。长弧比例低是因为很多目标在原上，原上攻击没有互射保护，短弧更优。

### 跑 2.3 模拟

    node ai/sim/run.js --games=1000 --players=2,4,8
    node ai/sim/run.js --games=1000 --players=2,4,8 --models=adaptive,hunter,survivor,balanced

## 本地显卡模型（7900 XTX）

Node 服务**不做推理**。它把 AI 自己的局面压缩成 JSON，发给本机运行中的推理服务；显卡负责出动作。这样不会把 PyTorch/ROCm 依赖塞进游戏本体。

配置文件：[gpu.config.json](./gpu.config.json)

    {
      "mode": "openai",
      "url": "http://127.0.0.1:11434/v1/chat/completions",
      "model": "qwen2.5:3b",
      "apiKey": "",
      "timeoutMs": 15000
    }

本机已验证（2026-10-21）：

- Ollama `0.40.6`，模型 `qwen2.5:3b`；
- `ollama ps` 显示 `100% GPU`；
- 预检命令：

    node ai/sim/gpu-check.mjs --load
    # loaded: qwen2.5:3b · vram=.../... (100% GPU)

- PyTorch/ROCm 训练基线见 [train/README.md](./train/README.md)：
  - WSL2 + torch `2.8.0+rocm7.2.0`；
  - RX 7900 XTX，迭代 1：92,521 条决策、3 个 seed，最佳验证动作准确率 67.6%。

也支持环境变量覆盖：

    DARK_FOREST_GPU_URL=...
    DARK_FOREST_GPU_MODEL=...
    DARK_FOREST_GPU_KEY=...
    DARK_FOREST_GPU_TIMEOUT_MS=...
    DARK_FOREST_GPU_MODE=openai|decide

### 方案 A：Ollama（AMD ROCm / Vulkan）

    ollama serve
    ollama pull qwen2.5:3b

7900 XTX 24GB 可以跑 14B 级别量化模型；本次先验证 `qwen2.5:3b`（1.9GB），已确认 100% GPU。模型名改成你本地 `ollama list` 里的名字。

### 方案 B：llama.cpp server（Vulkan）

    llama-server -m your-model.gguf --host 127.0.0.1 --port 8080 -ngl 99

然后把 `gpu.config.json` 的 `url` 改成 `http://127.0.0.1:8080/v1/chat/completions`，`model` 改成服务端要求的名字。

### 自定义模型服务

`mode: "decide"` 时，游戏会 POST：

    { "state": { "...": "..." } }

服务端返回：

    { "action": { "type": "attack", "target": 5, "dir": 1 } }

也可以直接返回行动对象。`gpu.js` 会校验合法性；非法/超时会在 30 秒内回退到猎手，避免对局卡死。

## 跑模拟

    node ai/sim/run.js --games=1000 --players=2,4,8

- 默认跳过 `external` 模型（GPU 模型每步都要推理，不适合大批量模拟）。
- 结果写入 `ai/sim/results.json`。
- 当前 500 局/档的混合对局里，`adaptive` 在 2/4/8 人局每座位胜率约 62.3% / 30.3% / 15.0%；`hunter` 约 58.5% / 24.5% / 8.9%；`survivor` 在 8 人局约 17.2%。
- 默认跳过 `external`；要跑 GPU 模型：`node ai/sim/run.js --games=50 --players=2,4 --external --models=gpu`，但每一步都走推理服务，速度取决于本机显卡/模型。

## 空文件夹

    # 让 AI 不可用
    mv ai/models ai/models.disabled
    # 重启服务端

服务端会打印 `AI models: 无`；本地开始按钮进入房间后显示“缺少 AI 模型”，无法开始带 AI 的对局。房间中如果有纯人类座位，仍然可以开局。

## 安装 / 卸载

- **安装**：把整个 `ai/` 文件夹放到项目根目录，重启服务端。
- **卸载**：移走 `ai/models/`，重启服务端。
- 也可以用 `DARK_FOREST_AI_DIR=/path/to/models` 指向另一个模型目录。
- 不需要改主程序代码；加载器在 `src/engine/aiLoader.js`，运行时在 `src/engine/aiRuntime.js`。
