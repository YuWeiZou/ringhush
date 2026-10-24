# 外部 AI 模型 · 制作与导入指南

> [English](./EXTERNAL-MODELS.en.md) | 中文

这份文档写给两类人：

1. **玩家**：想给房主提供自己的 AI 对手；
2. **其他大模型**：想按格式生成一个可玩的 AI 倾向。

外部模型**只支持 JSON 条件模型**，不支持任意 JavaScript。  
这样服务器不需要执行来路不明的代码，模型也更容易被 LLM 生成和校验。

## 1. 安装位置

在**房主**的电脑上，把模型包放进：

    ai/external/{model-folder}/model.json

例如：

    ai/external/my-ai/model.json

- `ai/external` 不存在时自己创建；
- 目录名随意，但建议用英文、数字、`-`、`_`；
- `_` 开头的目录会被忽略，`ai/external/_template` 是模板；
- 放好后**重启游戏服务端**（重新双击 `start.bat`）；
- 局域网客机不能上传模型，只能使用房主已有的模型；
- 外部模型默认**不进随机池**，只能在房间里手动选择。

## 2. 最小可用文件

    {
      "id": "my-ai",
      "name": "我的 AI",
      "version": "1.0.0",
      "description": "一个偏进攻的模型",
      "style": {
        "aggression": 0.7,
        "observation": 0.4,
        "hide": 0.4,
        "trapCommit": 0.9,
        "blindFire": 0.3,
        "longArc": 0.7,
        "compartmentClear": 0.5,
        "bombCaution": 0.8
      },
      "rules": []
    }

`id` 只能包含：

    A-Z a-z 0-9 _ -

长度 1–40。

## 3. 风格权重

所有值都是 `0..1`。

- 字段：`aggression`；含义：看到目标时主动攻击的倾向
- 字段：`observation`；含义：主动观测/搜索的倾向
- 字段：`hide`；含义：柱上藏身的倾向
- 字段：`trapCommit`；含义：无退路时仍选择攻击而不是探头的倾向
- 字段：`blindFire`；含义：用排除法盲狙的倾向
- 字段：`longArc`；含义：柱-柱对枪时选长弧的倾向（≥0.5 偏长）
- 字段：`compartmentClear`；含义：中局检查同一隔断/残局换区的倾向
- 字段：`bombCaution`；含义：躲当前轰炸目标的倾向

注意：

- 1v1 锁定最后一人且对方无移动空间时，**通用规则强制攻击**，不受这些权重影响；
- 所以 `trapCommit` 只影响其他无退路场景，不会让“锁定必杀”变成探头。

## 4. 规则数组

`rules` 从上到下匹配，**第一条满足的规则生效，后面的不再看**。

    {
      "rules": [
        {
          "when": {
            "phase": 2,
            "myComponentSize": { "lte": 4 },
            "nearUnclearedCount": { "gte": 1 }
          },
          "style": {
            "compartmentClear": 0.9,
            "hide": 0.2
          },
          "note": "第二阶段小隔断先排点"
        },
        {
          "when": {
            "phase": 3,
            "alive": { "lte": 3 }
          },
          "style": {
            "aggression": 0.85,
            "blindFire": 0.6,
            "hide": 0.2
          }
        }
      ]
    }

`note` 只是给人看的，会被忽略。

规则之间**不需要互斥**，也**不需要覆盖所有情况**：

- 第一条命中就停止；
- 如果没有命中，使用默认 `style`；
- 后面的规则不会叠加。

## 5. 条件格式

### 5.1 直接相等

    "phase": 2

支持数字、字符串、布尔。

### 5.2 比较

    "alive": { "lte": 3 }

支持：

    gte, lte, gt, lt, eq, neq, in

例如：

    "myComponentSize": { "gte": 2, "lte": 5 }

### 5.3 数组

    "bombMode": { "in": ["fast", "double"] }

### 5.4 组合

`all` 全部成立：

    "when": {
      "all": [
        { "phase": 3 },
        { "myExitCount": { "lte": 2 } }
      ]
    }

`any` 任一成立：

    "when": {
      "any": [
        { "deathsBySlip": { "gte": 2 } },
        { "nearUnclearedCount": { "gte": 2 } }
      ]
    }

`all` / `any` 可以嵌套。

## 6. 可用条件

### 阶段与轰炸

    phase                  1 / 2 / 3
    bombMode               normal / fast / double
    round
    alive
    initialPlayers
    aliveRatio
    ruinsCount
    ruinsRatio
    bombTargetCount
    bombTargetOnMe
    bombTargetInMyCompartment
    bombTargetDistance
    futureBlockedCount

### 地图碎片化

    componentCount
    largestComponentSize
    largestComponentShare
    myComponentSize
    myComponentShare
    myExitCount
    myChokePoint
    nearUnclearedCount
    unclearedCompartmentCount
    compartmentRisk

### 人数与密度

    playerDensity
    myCompartmentPressure

### 已知信息

    knownTargetCount
    knownTargetAge
    knownTargetDistance
    knownTargetOnPillar
    lastObserveRound
    roundsSinceLastObserve
    candidateCount
    candidateConcentration
    blindConfidence
    lockedLastEnemy
    targetHasNoMoves

### 自身状态

    myTerrain
    canHideEffective
    legalMoveCount
    bombOnMe
    samePositionRounds
    roundsSinceLastAttack
    roundsSinceLastMove
    lastAction

### 死亡与战斗历史

    deathsByGun
    deathsBySlip
    deathsByBomb
    deathsLast3Rounds
    slipDeathsThisGame
    gunDeathsThisGame

这些只来自公开死亡原因，不包含击杀者身份。

### 说明

- `phase` 来自当前轰炸模式：普通 = 1，加速 = 2，双区 = 3；
- `componentCount` 等按“当前废墟 + 下一轮轰炸目标”计算；
- `lockedLastEnemy` 是通用 1v1 锁定条件；
- `targetHasNoMoves` 表示最后已知敌人所在段没有任何移动空间；
- 所有条件都不读取其他玩家的真实坐标。

## 7. 复杂度上限

- 项目：`model.json` 文件；上限：128 KB
- 项目：规则条数；上限：256
- 项目：单条规则条件数；上限：32
- 项目：总条件数；上限：2048
- 项目：估算内存；上限：1 MB

超过任意一项：

- 模型仍然出现在列表里；
- 简介显示 **模型溢出**；
- 不能选中、不能用于对局。

格式错误：

- 显示文件名/模型名；
- 简介显示 **模型无法读取**；
- 不能选中。

## 8. 校验

房主可以运行：

    npm run ai:validate -- ai/external/my-ai/model.json

或：

    node tools/validate-ai-model.mjs ai/external/my-ai/model.json

成功：

    {
      "ok": true,
      "id": "my-ai",
      "rules": 2,
      "conditions": 5
    }

失败会给出 `invalid` 或 `overflow` 以及原因。

## 9. 给大模型生成模型的提示词

可以直接把下面这段交给其他模型：

    你要为一个隐藏信息、同时行动的环形桌游生成一个外部 AI 模型。
    只输出 JSON，不要输出解释。

    格式：
    {
      "id": "...",
      "name": "...",
      "version": "1.0.0",
      "description": "...",
      "style": {
        "aggression": 0..1,
        "observation": 0..1,
        "hide": 0..1,
        "trapCommit": 0..1,
        "blindFire": 0..1,
        "longArc": 0..1,
        "compartmentClear": 0..1,
        "bombCaution": 0..1
      },
      "rules": [
        {
          "when": { 条件 },
          "style": { 覆盖权重 }
        }
      ]
    }

    硬限制：
    - id 只能 A-Z a-z 0-9 _ -，1..40 字符；
    - 最多 256 条规则；
    - 每条规则最多 32 个条件；
    - 所有 style 值 0..1；
    - 规则从上到下第一条匹配生效；
    - 不能写 JavaScript，只能写 JSON；
    - 不要读取其他玩家真实位置；
    - 1v1 锁定最后一人且对方无移动空间时，通用规则会强制攻击，不需要在规则里重复。

    可用条件见 ai/EXTERNAL-MODELS.md。

## 10. 设计建议

### 激进型

    "style": {
      "aggression": 0.8,
      "hide": 0.25,
      "trapCommit": 1.0,
      "blindFire": 0.5,
      "longArc": 0.85,
      "compartmentClear": 0.6,
      "bombCaution": 0.5
    }

### 保守型

    "style": {
      "aggression": 0.35,
      "observation": 0.7,
      "hide": 0.75,
      "trapCommit": 0.7,
      "blindFire": 0.2,
      "longArc": 0.5,
      "compartmentClear": 0.7,
      "bombCaution": 0.9
    }

### 中局排点型

    "rules": [
      {
        "when": {
          "phase": { "in": [2, 3] },
          "myComponentSize": { "lte": 5 },
          "nearUnclearedCount": { "gte": 1 }
        },
        "style": {
          "compartmentClear": 1.0,
          "hide": 0.15,
          "observation": 0.7
        }
      }
    ]

## 11. 限制

- 只支持 JSON 条件模型；
- 不支持网络请求、文件读取、任意代码；
- 局域网只有房主能提供模型；
- 外部模型不进随机池；
- 模型包不会同步给客机，客机只收到房主的模型列表；
- 修改 `model.json` 后需要重启服务端才会重新读取。
