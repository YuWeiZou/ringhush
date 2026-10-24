# AGENTS.en.md · Dark Forest Maintenance Entry Point

> English | [中文](./AGENTS.md)

> Current version **2.6.1a19**. This is the short entry point for coding agents/new maintainers; for the full zone map, release process, and troubleshooting, see
> [docs/维护指南.en.md](./docs/维护指南.en.md); for the documentation index, see [docs/README.en.md](./docs/README.en.md).

## Before You Start

1. Read this file first. Before changing code, use the “Task Router” below to find the zone, and **open only files in that zone**.
2. Do not run repo-wide `grep`/`glob`. If you truly cannot find the entry point, update the task router first, then touch code.
3. Rules are defined by the server-side `src/engine/`; if player documentation conflicts with the implementation, change the implementation, tests, and rulebook together.
4. The current directory **is not a git repository**. Back up target files before major changes; do not delete large assets such as `dist/`, `ai/train/data/`.

## Zones

| Zone | Path | In One Sentence |
|---|---|---|
| Z0 Rule Core | `src/engine/` | State machine, resolution, legality, `view` filtering, replay records |
| Z1 Shared Geometry | `shared/ring.js` | Ring geometry shared by the frontend and backend; must be isomorphic |
| Z2 Server | `server/`, `launcher.mjs`, `start.bat` | HTTP + WS, room lifecycle, timers, startup |
| Z3 Browser UI | `public/index.html`, `app.js`, `styles.css` | Menu/room/match/replay/settings |
| Z4 Browser Submodules | `public/board.js`, etc. | Map, light effects, BGM, IndexedDB, Bridge client |
| Z5 AI Runtime/Plugins | `src/engine/aiRuntime.js`, `ai/lib/`, `ai/models/` | Model loading, private ctx, strategies |
| Z6 AI Experiments | `ai/sim/`, `ai/train/` | Simulation, training, weights; not included in release packages |
| Z7 Tools/Assets | `tools/`, `public/audio/` | Audio generation, model validation |
| Z8 Tests | `test/` | 33 engine + 12 AI |
| Z9 Documentation | Root `*.md`, `docs/`, `ai/*.md` | Rules/design/release/maintenance |
| Z10 Generated Artifacts | `dist/`, `release/`, `runtime/`, `logs/` | Do not edit directly |

## Task Router (Start Here)

- Rules/resolution/damage/bombardment → `src/engine/game.js` + `actions.js`; sync `test/engine.test.js`, `规则书.en.md`
- Map/segment count/pillar count → `src/engine/map.js`
- Ring geometry/half-plane/arcs → `shared/ring.js`
- WS/rooms/seats/timing/disconnect → `server/index.js` + `server/rooms.js`
- Pages/interactions/copy → `public/index.html` + `public/app.js` (by zone marker) + `public/styles.css`
- Map drawing/ripples → `public/board.js` / `public/ambient-light.js`
- Replay → `src/engine/game.js` (`getReplayRecord`) + `public/app.js` (`renderReplay`) + `public/history.js`
- AI behavior → `ai/lib/common.js` + `ai/models/*.js`; sync `test/ai.test.js`, `ai/README.en.md`
- External JSON models → `ai/lib/profile.js` + `ai/EXTERNAL-MODELS.en.md`
- GPU models → `ai/models/gpu.js` + `ai/gpu.config.json`
- Bridge → `ai-bridge.mjs` + `public/bridge-client.js` + `*Bridge*` in `server/index.js`
- Version/release → `package.json`, `RELEASE-*.md`, `README.en.md`, startup line in `server/index.js`; see Guide §7/§8

## Must Not Break

1. Non-spectator `getView()` does not return other players' positions; the `players` in AI ctx contain no positions.
2. Shot outcomes (hit/empty shot/mutual attack) are not fed back to players/AI; they go only into the replay.
3. Resolution order: Hide → Observe → Slip → Attack → Death; Hide on a Plain has no effect; only Hide on a Pillar grants invisibility.
4. Phase machine `lobby → selecting → resolved → over`; human timeout counts as Hide; AI and humans reason at the same time.
5. `shared/ring.js` must not depend on Node/browser APIs; browser imports use `/board.js`, `/shared/ring.js`.
6. Release packages do not include `test/`, `tools/`, `ai/sim/`, `ai/train/`, `docs/`, `AGENTS.md`, or `AGENTS.en.md`.

## Verification

```powershell
npm test              # 45 tests
npm run check:zones   # zone import boundaries
npm run verify        # both together
```

- Server smoke test: `PORT=3099 DARK_FOREST_NO_OPEN=1 node server/index.js`, then `curl http://127.0.0.1:3099/api/health`.
- UI smoke test: `http://localhost:3001/?auto=1&players=4`; debug with `?debug=1`.
- AI simulation: `npm run sim -- --games=100 --players=2,4,8`.

## Change Discipline

- For a small change, read only one zone; cross-zone changes (e.g., the view structure) must check `server`, `public`, `test`, and docs together.
- Behavior/rule/protocol changes: update the corresponding docs (see Maintenance Guide §9).
- Version changes: work through the checklist in Maintenance Guide §8 item by item; do not change only `package.json`.
- When you discover a new “change type → file” mapping, add it to Maintenance Guide §3 and the task router in this file.
- Do not edit the old package in `dist/` to “fix a bug”; change the source and repackage.
