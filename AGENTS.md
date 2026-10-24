# AGENTS.md · 黑暗森林维护入口

> [English](./AGENTS.en.md) | 中文

> 当前版本 **2.6.1a19**。这是给代码代理/新维护者的短入口；完整分区、发布流程、故障排查见
> [docs/维护指南.md](./docs/维护指南.md)，文档索引见 [docs/README.md](./docs/README.md)。

## 开工前

1. 先读本文件；改代码前按下面“任务路由”找到分区，**只打开该分区的文件**。
2. 不要全仓 `grep`/`glob`。确实找不到入口时，先补路由表再动代码。
3. 规则以服务端 `src/engine/` 为准；玩家文档与实现冲突时，同时改实现、测试和规则书。
4. 当前目录**不是 git 仓库**。大改前先备份目标文件；不要删除 `dist/`、`ai/train/data/` 等大资产。

## 分区

| 区 | 路径 | 一句话 |
|---|---|---|
| Z0 规则核心 | `src/engine/` | 状态机、结算、合法性、`view` 过滤、回放记录 |
| Z1 共享几何 | `shared/ring.js` | 前后端共用的环形几何，必须同构 |
| Z2 服务端 | `server/`、`launcher.mjs`、`start.bat` | HTTP + WS、房间生命周期、计时器、启动 |
| Z3 浏览器主界面 | `public/index.html`、`app.js`、`styles.css` | 菜单/房间/对局/回放/设置 |
| Z4 浏览器子模块 | `public/board.js` 等 | 地图、光效、BGM、IndexedDB、Bridge 客户端 |
| Z5 AI 运行时/插件 | `src/engine/aiRuntime.js`、`ai/lib/`、`ai/models/` | 模型加载、私密 ctx、策略 |
| Z6 AI 实验 | `ai/sim/`、`ai/train/` | 模拟、训练、权重；不进发布包 |
| Z7 工具/资产 | `tools/`、`public/audio/` | 音频生成、模型校验 |
| Z8 测试 | `test/` | 33 engine + 12 AI |
| Z9 文档 | 根目录 `*.md`、`docs/`、`ai/*.md` | 规则/设计/发布/维护 |
| Z10 生成物 | `dist/`、`release/`、`runtime/`、`logs/` | 不直接编辑 |

## 任务路由（先看这些）

- 规则/结算/伤害/轰炸 → `src/engine/game.js` + `actions.js`；同步 `test/engine.test.js`、`规则书.md`
- 地图/段数/柱数 → `src/engine/map.js`
- 环形几何/半区/弧 → `shared/ring.js`
- WS/房间/座位/计时/断线 → `server/index.js` + `server/rooms.js`
- 页面/交互/文案 → `public/index.html` + `public/app.js`（按分区标记）+ `public/styles.css`
- 地图画法/涟漪 → `public/board.js` / `public/ambient-light.js`
- 回放 → `src/engine/game.js`（`getReplayRecord`）+ `public/app.js`（`renderReplay`）+ `public/history.js`
- AI 行为 → `ai/lib/common.js` + `ai/models/*.js`；同步 `test/ai.test.js`、`ai/README.md`
- 外部 JSON 模型 → `ai/lib/profile.js` + `ai/EXTERNAL-MODELS.md`
- GPU 模型 → `ai/models/gpu.js` + `ai/gpu.config.json`
- Bridge → `ai-bridge.mjs` + `public/bridge-client.js` + `server/index.js` 的 `*Bridge*`
- 版本/发布 → `package.json`、`RELEASE-*.md`、`README.md`、`server/index.js` 启动行；见指南 §7/§8

## 不能破坏

1. 非观战者 `getView()` 不返回其他玩家位置；AI ctx 的 `players` 不含位置。
2. 开火结果（命中/空枪/互射）不反馈给玩家/AI，只进回放。
3. 结算顺序：藏 → 观 → 溜 → 攻 → 死亡；原上藏无效，柱上藏才隐身。
4. 阶段机 `lobby → selecting → resolved → over`；人类超时按藏；AI 与人类同时推理。
5. `shared/ring.js` 不能依赖 Node/浏览器 API；浏览器 import 用 `/board.js`、`/shared/ring.js`。
6. 发布包不包含 `test/`、`tools/`、`ai/sim/`、`ai/train/`、`docs/`、`AGENTS.md`、`AGENTS.en.md`。

## 验证

```powershell
npm test              # 45 tests
npm run check:zones   # 分区 import 边界
npm run verify        # 两项一起
```

- 服务端冒烟：`PORT=3099 DARK_FOREST_NO_OPEN=1 node server/index.js`，再 `curl http://127.0.0.1:3099/api/health`。
- UI 冒烟：`http://localhost:3001/?auto=1&players=4`；调试 `?debug=1`。
- AI 模拟：`npm run sim -- --games=100 --players=2,4,8`。

## 改动规矩

- 小改只读一个分区；跨分区改动（如 view 结构）必须同时检查 `server`、`public`、`test`、文档。
- 行为/规则/协议变化：更新对应文档（见维护指南 §9）。
- 版本变化：按维护指南 §8 的清单逐项改，避免只改 `package.json`。
- 发现新的“改动类型 → 文件”映射，补进维护指南 §3 和本文件的路由表。
- 不要编辑 `dist/` 里的旧包来“修 bug”；改源码后重新打包。
