# 文档索引（分区）

> [English](./README.en.md) | 中文

黑暗森林的文档按“谁读、什么时候读”分区。只是找代码改动位置时，直接看 [维护指南](./维护指南.md)。英文版索引见 [README.en.md](./README.en.md)。

## 一、玩家与发布

| 文档 | 用途 |
|---|---|
| [README.md](../README.md) | 总入口：快速开始、联机、操作、历史/回放、启动恢复 |
| [游戏介绍.md](../游戏介绍.md) | 游戏概念、一局怎么玩 |
| [规则书.md](../规则书.md) | 完整规则（v1.0.0），参数以这里为准 |
| [玩法与策略说明.md](../玩法与策略说明.md) | 基本策略与心理战，不是规则 |
| [OPL联机说明.md](../OPL联机说明.md) | OPL / OpenP2P 联机、端口 |
| [RELEASE-2.6.1a19.md](../RELEASE-2.6.1a19.md) | 当前版本发布说明 |
| [public/audio/README.md](../public/audio/README.md) | BGM 歌单、曲目、授权提醒 |

这些文档会随玩家发布包一起发出（`docs/` 与 `AGENTS.md` 不发；Lite 版还不含 `public/audio/`）。

## 二、设计、实验与训练

| 文档 | 用途 |
|---|---|
| [设计笔记.md](../设计笔记.md) | 设计判断 + 从 v0.55 到当前版本的实现备注（事实上的 changelog） |
| [GPU-VS-AI2.md](../GPU-VS-AI2.md) | 本地 GPU 模型对 AI 2.x 的胜率实验 |
| [TRAINING-ITERATION-1.md](../TRAINING-ITERATION-1.md) | 第一次行为克隆训练迭代 |
| [ai/train/README.md](../ai/train/README.md) | 训练环境、数据、脚本 |
| [ai/train/APEX-REPORT.md](../ai/train/APEX-REPORT.md) | 学徒模型（apex / apex-safe）报告 |

## 三、技术与维护

| 文档 | 用途 |
|---|---|
| [维护指南.md](./维护指南.md) | **代码分区、任务路由、约束、测试、发布、版本清单** |
| [AGENTS.md](../AGENTS.md) | 代码代理的短入口（先读这个再读维护指南） |
| [AI-BRIDGE.md](../AI-BRIDGE.md) | 本机 Bridge 协议、端口、握手、排查 |
| [ai/README.md](../ai/README.md) | AI 模型 API、内置型号、GPU 接入、模拟 |
| [ai/EXTERNAL-MODELS.md](../ai/EXTERNAL-MODELS.md) | 外部 JSON 模型格式与限制 |

## 四、代码分区速查

| 分区 | 入口 |
|---|---|
| 规则核心 | [src/engine/game.js](../src/engine/game.js)、[actions.js](../src/engine/actions.js) |
| 共享几何 | [shared/ring.js](../shared/ring.js) |
| 服务端 | [server/index.js](../server/index.js)、[rooms.js](../server/rooms.js) |
| 浏览器 UI | [public/app.js](../public/app.js)、[index.html](../public/index.html)、[styles.css](../public/styles.css) |
| 浏览器子模块 | [board.js](../public/board.js)、[history.js](../public/history.js)、[audio-player.js](../public/audio-player.js)、[bridge-client.js](../public/bridge-client.js)、[ambient-light.js](../public/ambient-light.js) |
| AI 运行时/插件 | [src/engine/aiRuntime.js](../src/engine/aiRuntime.js)、[ai/lib/](../ai/lib/)、[ai/models/](../ai/models/) |
| 测试 | [test/engine.test.js](../test/engine.test.js)、[test/ai.test.js](../test/ai.test.js) |

## 维护约定

- 新增/删除文档时，同步本索引和维护指南 §9。
- 根目录的长文档暂时不移动：它们被 README、玩家发布包和历史链接引用；分区靠本索引和维护指南，而不是靠搬文件。
- 发布包只带“玩家与发布”组，不带 `docs/`、`AGENTS.md`、`test/`、`tools/`、`ai/sim/`、`ai/train/`。
