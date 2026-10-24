# Documentation Index (by Zone)

> English | [中文](./README.md)

Dark Forest's documentation is organized by “who reads it and when.” If you only need to find where a code change goes, go straight to the [Maintenance Guide](./维护指南.en.md).

## 1. Players and Releases

| Document | Purpose |
|---|---|
| [README.en.md](../README.en.md) | Main entry: quick start, online play, controls, history/replay, startup recovery |
| [游戏介绍.en.md](../游戏介绍.en.md) | Game concepts, how a match is played |
| [规则书.en.md](../规则书.en.md) | Complete rules (v1.0.0); parameters here are authoritative |
| [玩法与策略说明.en.md](../玩法与策略说明.en.md) | Basic strategy and psychological warfare, not rules |
| [OPL联机说明.en.md](../OPL联机说明.en.md) | OPL / OpenP2P online play, ports |
| [RELEASE-2.6.1a19.en.md](../RELEASE-2.6.1a19.en.md) | Current version release notes |
| [public/audio/README.en.md](../public/audio/README.en.md) | BGM playlists, tracks, licensing reminders |

These documents are shipped with the player release package (`docs/`, `AGENTS.md`, and `AGENTS.en.md` are not shipped; the Lite version also omits `public/audio/`).

## 2. Design, Experiments, and Training

| Document | Purpose |
|---|---|
| [设计笔记.md (Chinese)](../设计笔记.md) | Design judgments + implementation notes from v0.55 to the current version (the de facto changelog) |
| [GPU-VS-AI2.md (Chinese)](../GPU-VS-AI2.md) | Win-rate experiment of the local GPU model against AI 2.x |
| [TRAINING-ITERATION-1.md (Chinese)](../TRAINING-ITERATION-1.md) | First behavior-cloning training iteration |
| [ai/train/README.en.md](../ai/train/README.en.md) | Training environment, data, scripts |
| [ai/train/APEX-REPORT.en.md](../ai/train/APEX-REPORT.en.md) | Apprentice models (apex / apex-safe) report |

## 3. Technical and Maintenance

| Document | Purpose |
|---|---|
| [维护指南.en.md](./维护指南.en.md) | **Code zones, task router, constraints, tests, release, version checklist** |
| [AGENTS.en.md](../AGENTS.en.md) | Short entry point for coding agents (read this before the maintenance guide) |
| [AI-BRIDGE.en.md](../AI-BRIDGE.en.md) | Local Bridge protocol, ports, handshake, troubleshooting |
| [ai/README.en.md](../ai/README.en.md) | AI model API, built-in models, GPU integration, simulation |
| [ai/EXTERNAL-MODELS.en.md](../ai/EXTERNAL-MODELS.en.md) | External JSON model format and limits |

## 4. Code Zone Quick Reference

| Zone | Entry Point |
|---|---|
| Rule Core | [src/engine/game.js](../src/engine/game.js), [actions.js](../src/engine/actions.js) |
| Shared Geometry | [shared/ring.js](../shared/ring.js) |
| Server | [server/index.js](../server/index.js), [rooms.js](../server/rooms.js) |
| Browser UI | [public/app.js](../public/app.js), [index.html](../public/index.html), [styles.css](../public/styles.css) |
| Browser Submodules | [board.js](../public/board.js), [history.js](../public/history.js), [audio-player.js](../public/audio-player.js), [bridge-client.js](../public/bridge-client.js), [ambient-light.js](../public/ambient-light.js) |
| AI Runtime/Plugins | [src/engine/aiRuntime.js](../src/engine/aiRuntime.js), [ai/lib/](../ai/lib/), [ai/models/](../ai/models/) |
| Tests | [test/engine.test.js](../test/engine.test.js), [test/ai.test.js](../test/ai.test.js) |

## Maintenance Conventions

- When adding/removing documentation, update this index and §9 of the maintenance guide.
- Long documents in the root directory are not moved for now: they are referenced by the README, player release packages, and historical links; zoning is handled by this index and the maintenance guide, not by moving files.
- The release package includes only the “Players and Releases” group; it does not include `docs/`, `AGENTS.md`, `AGENTS.en.md`, `test/`, `tools/`, `ai/sim/`, `ai/train/`.
