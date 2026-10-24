# Dark Forest

> English | [中文](./README.md)
>
> The in-game UI stays Chinese by design, with no language toggle; use the browser's built-in translation if needed.

An online board game with a ring map, simultaneous actions, and hidden information. **Release 2.6.1a19** ships with a self-contained Windows runtime: the host double-clicks `start.bat` to start it and the browser opens automatically, with no need to install Node.js/npm; other players simply open the host's LAN address in a browser. After each match, every player's browser saves a complete god-view replay.

For the full introduction, see [game introduction](./游戏介绍.en.md); for the complete rules, see [rulebook](./规则书.en.md) (v1.0.0); for gameplay and basic strategy, see [gameplay and strategy notes](./玩法与策略说明.en.md); for the AI plugin documentation, see [ai/README.en.md](./ai/README.en.md); for design analysis, see [design notes (Chinese)](./设计笔记.md); for OPL/OpenP2P multiplayer, see [OPL multiplayer guide](./OPL联机说明.en.md); for release notes, see [RELEASE-2.6.1a19](./RELEASE-2.6.1a19.en.md).

Project maintenance and code zones are covered in [maintenance guide](./docs/维护指南.en.md), and the documentation index is in [docs/README.en.md](./docs/README.en.md); code agents should start with [AGENTS.en.md](./AGENTS.en.md). These maintenance docs live in the source repository and are not shipped with the player package.

## Quick Start (Release Package)

1. Extract the whole `黑暗森林-2.6.1a19` folder;
2. Double-click `start.bat`;
3. The browser opens `http://localhost:3001` automatically.

No Node.js, npm, or any plugin needs to be installed. `start.bat` uses the bundled `runtime\node.exe`. It runs hidden by default; the first window waits for the server health check to pass, then opens the browser and closes automatically. Run `start.bat --console` if you need to see the startup log.

A development environment (with Node.js installed) still works:

    npm install
    npm start

Open `http://localhost:3001` in a browser.

## LAN Multiplayer

This Release only covers LAN multiplayer; NAT traversal/public mapping is not configured for now.

The host runs the server, everyone else opens `http://{host IP}:3001` and joins with the room code. A room holds at most **8 players (humans + AI)**; the total number of players is not chosen in advance; humans join over time, and the host can add/remove AI seats in the room.

### LAN Multiplayer Steps

1. The host double-clicks `start.bat` and the browser opens the local page automatically; the startup log is hidden by default—use `start.bat --console` when needed;
2. Other players open this `LAN` address on the same LAN; nothing needs to be installed;
3. The host clicks "LAN Multiplayer → Create Room" and sends the 4-character room code to friends;
4. Friends click "LAN Multiplayer → enter nickname/room code → Join Room";
5. The host adds AI, picks models/random, sets the round timer, and clicks "Start Match" once there are at least 2 players.

The "host" is the player who creates the room; the server runs on the host machine. Other players must be on the same LAN as the host machine.

## How to Play

1. Local match: click "Start Local Match" to enter the room; online: click "LAN Multiplayer", then create a room or join with a room code.
2. In the room the host adds/removes AI and picks a model or "Random" for each AI; sets the action time per round (20 seconds–3 minutes, default 60 seconds).
3. Player count = humans + AI; 2–8 players is enough to start—a full room is not required; after the start, AI models and the timer are locked.
4. Each round you choose one of **Hide / Observe / Attack / Slip**; Hide only has an effect on a Pillar—Hide on a Plain is an empty action.
5. Resolution order: **Hide → Observe → Slip → Attack → Death**; a timeout is treated as Hide.
6. Round 2 gives the first warning, round 4 the first bombardment; afterwards, by survivor count: more than half → 3-round interval, single target; at or below half → 2-round interval, single target; at or below a quarter → 3-round interval, two targets announced at once and detonated simultaneously.
7. After resolution, the next round starts only when every surviving human clicks "Continue"; the result phase continues automatically after 10 seconds. The last one alive wins; if everyone dies in the same round, it is a draw.
8. If a non-host player disconnects during a match: that round is treated as Hide, they die immediately, a public broadcast announces "died from disconnection", and the corpse is recorded normally; if the host disconnects, the room still closes.

There is no chat or communication channel during a match; AI can only use its own private information.

Click "Rules" in the game for a quick reference.

### Actions

- **Observe**: choose a direction + length; a full ring on a Plain, at most half a ring on a Pillar.
- **Attack**: click "Attack" first, then click a segment on the map to pick the target; the direction determines the attack arc length. Gunshots do not publicly reveal the exact segment; other players only learn "left/right" and how many shots rang out on each side.
- **Slip**: choose from the available landing spots; on a Plain you may be able to move 2 segments, or cut straight through Ruins from the Plain side.
- **Intel**: click an intel entry to view only that round; the "Intel History" timeline below the map can return to "All".
- **Intel visualization**: segments where observation spotted someone keep a red dot + an `R<round>` label; half-plane gunshots are shown as blue light arcs on the outer ring of the map, and the intel panel shows the number of shots on the left and right sides. Historical information does not disappear, and the timeline can go back to it.
- The resolution popup lets you "view the map first" or "continue to the next round".

## Assist Settings

"Assist Settings" is available in the main menu, the ready room, during a match, and in replays, and only affects the local machine:

- **UI font size**: 100% / 115% / 130% / 145%;
- **High contrast**: brightens text, borders, and status colors;
- **Large board labels**: enlarges segment numbers, terrain text, and player/corpse labels;
- **Reduce animations**: turns off fades, pulses, and transitions;
- **Keyboard controls**: during a match `1` Hide, `2` Observe, `3` Attack, `4` Slip, `Enter` submit;
- Settings are saved in the local browser and persist after a refresh.

## Match History and Replay

- Eliminated players automatically enter **god view**: they can see all player positions, terrain, and public events, and keep watching;
- When only AI remain, the server simulates straight to the end and saves the complete record; when the match ends you return directly to the room and the next match does not start automatically;
- When a match ends normally (a winner is decided/a draw), the server sends the **complete god-view record** to every player who is still connected;
- Each player's browser stores it with IndexedDB **on their own computer**, not only on the host machine;
- Main menu → "Match History" lets you view local records;
- The "Round Review" resolution panel opens automatically at the end of each round;
- Online rooms have a "Match History" button; the history list expands directly below the room and does not cover it;
- Replays are scrubbed manually with a **round slider**, with previous round/next round and a "round start / round end" toggle;
- It shows the true positions of all players, their actions, movement/attack lines, deaths, bombardments/Ruins, public events, and each person's private events;
- In replays, hidden players' tokens have a white edge; observing players are shown as colored arcs on the outermost ring, concentric at different radii when they overlap;
- Deletion only removes this record on the local machine; it does not affect other players or the server;
- Clearing site data or using private browsing in the browser will wipe local records.
- Corpse markers: a living player only sees corpses **on their current segment**; they know the public death list but not where corpses elsewhere are, nor the true round of death—only "the round I found it". Coming back to the same segment updates it with new corpses. Corpses do not block movement/observation/attack. Replays use god view and show every corpse, the true round of death, and names; the dead are no longer stacked as separate tokens but aggregated by segment.

## Startup / Connection Recovery

- If the server exits abnormally, `start.bat` restarts it automatically, at most 3 times;
- Errors are written to `logs\server-errors.log`;
- After all browsers are closed, the server exits automatically after a 5-second grace period; refreshing the page reconnects within the grace period;
- A disconnected browser tries to reconnect; repeated failures show "Connection lost" and "Refresh to reconnect";
- A page script error shows "The page hit an error" and a refresh button, so the screen does not just go black;
- A reconnect only returns to the main menu/lobby, not to a match in progress.

## BGM · "Borrowed from Mature Works"

- The Release package ships only the current playlist `public/audio/playlists/long-night-dam/`;
- Tracks: Desolated / 赛伊德01 / 解药公司 / 赛伊德03 / 瘟疫公司主题曲 / 瘟疫公司·食血怪 / 赛伊德02;
- Manifest: `public/audio/playlists/long-night-dam/songbook.json`;
- The first version `finally-pastoral/` is kept only in the source tree and is not shipped with the Release;
- The settings page keeps only the music volume (adjustable);
- It is wired into the menu, the room, replays, settings, and the automatic switching between the three in-match phases;
- Details: `public/audio/README.en.md`.

## External AI Bridge (v2.1.0)

- Each player runs a local Bridge on their own computer;
- Control port `127.0.0.1:3210`, model ports `3211–3218`;
- It forwards only that player's own view and never leaves the LAN;
- Enable "External AI Channel" in settings, then click "Open Local Bridge" in the room;
- On a guest machine, run `install-ai-bridge.bat` once to register `dfbridge://`;
- Manual confirmation / auto-submit; auto-submit has a 1.5-second human override window;
- Protocol and examples are in [AI-BRIDGE.en.md](./AI-BRIDGE.en.md).

## OPL / OpenP2P Multiplayer

The game uses only one TCP port, **3001** by default; a room code is a logical room, so no random port is needed. When OPL cannot connect, first check whether the OPL tunnel maps **3001** to the joining side's local port.

- The `37520` in old configs is the Minecraft/legacy preset port, not this game's port;
- The "Local/Local port" in the OPL panel is the port the browser must visit—open `http://127.0.0.1:{local port}`;
- Do not use the OPL UID as a connection code; use the connection code generated by OPL;
- You can also build a network with EasyTier, then open `http://{host virtual IP}:3001`.

Detailed steps are in [OPL multiplayer guide](./OPL联机说明.en.md).

## Current Implementation Scope

- Map: `S = 3n` (`3n+1` if even), Pillars `floor(1.5n)`, random initial positions, the map structure is public.
- Actions: Hide/Observe/Attack/Slip; half-plane exposure, left/right gunshot counts, mutual attack arc length, Slip kills/Observe counter-kills, crowding by movement distance, 1 HP, bombardment/Ruins, straight pass-through from the Plain side of Ruins, observation/attack not blocked by Ruins, win/draw.
- Information isolation: the server filters `view` per player; the client only knows its own position, observation results, and half-plane clues, and never receives other players' positions.
- AI: built-in JS models in `ai/models/`, external JSON condition models in `ai/external/`; currently AI 2.3.3 (Adaptive/Hunter/Stalker/Ashes/Night Watchman + local GPU adapter). In 1v1, when it has locked onto a target with no movement, it is forced into a long-arc attack, but it prefers Slip when standing in an avoidable bombardment zone; in the endgame it corrects stale red dots with the nearest gunshot half-plane. AI only gets its own `view` and cannot see other players' positions.
- Room: LAN create/join, room code, human nicknames, host dynamically adds/removes AI, AI model or random, 20–180 second timer, all surviving humans continue + 10-second auto-continue.
- Timeout: humans who did not submit that round are automatically treated as Hide; Hide on a Plain is empty, hiding nothing and blocking no shots. AI and humans start reasoning at the same time; after all humans submit, the server waits for AI to finish before resolving.
- Replay: on a normal end, each online player saves the complete record locally; main-menu history list, deletion, round-slider review, round start/end toggle.
- Spectate: eliminated players automatically get god view; when only AI remain, the match is simulated straight to the end, the record is archived, and you return to the room without starting the next match.
- Fire feedback: players and AI only know their own target and arc length; there is no feedback on whether a shot was empty, blocked, a hit, or suppressed by a mutual attack; the full attack result only goes into the god-view replay.
- Assist settings: font size, high contrast, large board labels, reduced animations, keyboard 1–4/Enter, saved locally.

## AI Logic Folder

AI logic lives separately in `ai/`:

    ai/
      models/          built-in AI models (*.js)
      external/        external JSON condition models (provided by the host)
      lib/             shared inference utilities
      sim/             self-play simulation
      gpu.config.json  local GPU model config

- **Empty folder = AI not allowed**: if `ai/models/` is empty or missing, the server still starts, but the room shows "AI models missing" and you cannot start a match with AI.
- **Installing built-in models**: put the JS models into `ai/models/` and restart the server.
- **Installing external models**: put `model.json` into `ai/external/{id}/` and restart the server; only JSON is supported—arbitrary code cannot be executed. Full format in [ai/EXTERNAL-MODELS.en.md](./ai/EXTERNAL-MODELS.en.md).
- **Selection**: in the room, before the match officially starts, the host can switch the model for each AI seat; it is locked after the start.
- **Models only get their own information**: `ctx.players` has no positions; positions can only come from your own observation red dots, gunshots, and public information, and fire results are not fed back.
- **Local GPU model**: the `gpu` model (2.3.0) runs inference on a 7900 XTX through a local OpenAI-compatible service (Ollama / llama.cpp / vLLM); Node only sends a compressed position and receives a JSON action, without shoving inference into the game process. Config in [ai/README.en.md](./ai/README.en.md).
- **Verified locally**: Ollama 0.40.6 + `qwen2.5:3b`, `ollama ps` shows 100% GPU; preflight with `npm run gpu:check`.
- **Random pool**: `basic` (Night Watchman) only Hides/observes the whole ring and is set to `randomPool: false`, so it is not in the random pool but can be picked manually. The local `gpu` model version is 2.3.0.
- **Local model win rate**: `qwen2.5:3b` vs `adaptive` over 50 games is 15:31 (4 draws, 32.6% excluding draws), but 80.7% of actions fell back to Hunter; the pure-model group scored only 5% over 20 games. See [GPU vs AI 2 (Chinese)](./GPU-VS-AI2.md).
- **Training baseline**: iteration 1 in `ai/train/` used 92,521 decisions and 3 seeds; best validation action accuracy was 67.6%. See [ai/train/README.en.md](./ai/train/README.en.md).
- **Apprentice model**: `apex-safe` is the gatekeeper version for 4-player games, with student weights in JSON; over 500 four-player games it has a 27.2% seat win rate vs adaptive 20.0%, and falls back to adaptive in 2/8-player games. See [apex report](./ai/train/APEX-REPORT.en.md).
- **Simulation**:

    npm run sim -- --games=500 --players=2,4,8

Results are written to `ai/sim/results.json`. The current default `adaptive` (Adaptive) is more stable in multiplayer games, and in 2-player endgames it automatically reuses Hunter logic.

## Tests

    npm test          # 45 unit tests
    npm run verify    # zone/import boundary checks + unit tests

Coverage: map formulas, half-plane determination, attack damage conditions, mutual attack arc length, Slip kills/counter-kills, crowding resolution, bombardment schedule/Ruins, win/draw, gunshot half-planes, AI-only auto-resolution, AI loader/context isolation, and rejecting a start with an empty AI folder. For maintenance zones and the verification matrix, see [maintenance guide](./docs/维护指南.en.md).

## Multiplayer Interface (Reserved)

WebSocket: `/ws`, JSON messages.

Client -> server:

    { "type": "local", "name": "You" }
    { "type": "createRoom", "name": "Host" }
    { "type": "joinRoom", "roomId": "ABCD", "name": "Player" }
    { "type": "addAI" }
    { "type": "removeAI", "playerId": 100 }
    { "type": "setAI", "playerId": 100, "modelId": "hunter" }
    { "type": "setTimer", "seconds": 60 }
    { "type": "startRoom" }
    { "type": "action", "action": { "type": "attack", "target": 4, "dir": 1 } }
    { "type": "continue" }
    { "type": "restart" }
    { "type": "menu" }

Server -> client:

    { "type": "lobby", "roomId": "ABCD", "playerId": 0, "hostId": 0, "started": false, "maxTotal": 8, "total": 3, "turnSeconds": 60, "models": [], "humans": [], "aiSlots": [], "canAddAI": true, "canStart": true }
    { "type": "state", "view": { "...": "...", "room": { "deadline": 0, "resultDeadline": 0, "ready": [] } } }
    { "type": "gameover", "view": { "...": "..." }, "winnerId": 2 }
    { "type": "error", "message": "..." }

- `local` / `createRoom` / `joinRoom` first enter a room and do not start automatically; only the host's `startRoom` starts the match.
- A room holds at most 8 players (humans + AI); `addAI` / `removeAI` / `setAI` / `setTimer` can only be called by the host before the start; the AI model can be a specific id or `random`.
- `turnSeconds` is 20–180, default 60; a timeout is treated as Hide. `continue` is clicked by surviving humans; the next round starts when all are ready or after 10 seconds.
- Each client only receives its own `view`, which does not contain other players' positions.
- The first version does not do in-match reconnect/hosting or invite links; eliminated spectating and local replay are included.

## Directory Layout

    dark-forest/
      ai/
        models/         pluggable AI logic models (empty = AI disallowed)
        lib/            shared AI utilities
        sim/            self-play simulation (results.json)
        gpu.config.json local GPU model config
        README.en.md    AI plugin / GPU integration notes
      server/
        index.js        HTTP static server + WebSocket + room lifecycle
        rooms.js        Room (seats, AI models, client binding, lobby reset)
      src/engine/
        game.js         rules engine (state machine, resolution, view filtering, async AI actions)
        actions.js      action legality, exposed arc, attack arc length
        auto.js         AI-only auto-resolution when no humans remain
        aiLoader.js     scans ai/models/*.js
        aiRuntime.js    private context + model invocation
        map.js          map generation
        rng.js          seeded random
      shared/
        ring.js         ring geometry (shared by client and server)
      public/
        index.html      menu / room / match / rules quick reference
        app.js          client state and interaction
        board.js        SVG ring map rendering
        styles.css      dark visual theme
      test/
        engine.test.js  node:test rules and AI unit tests
      docs/
        README.en.md    documentation index
        维护指南.en.md  code zones, task routing, verification, and release
      AGENTS.en.md      entry point for code agents
      规则书.en.md
      设计笔记.md       Chinese-only design/changelog notes

Files with an `.en.md` suffix are English translations; the corresponding Chinese originals remain alongside them.

## Development Tips

- `npm run dev`: `node --watch` restarts the server automatically.
- `?auto=1&players=4`: starts a local match automatically after the page opens, handy for screenshots/smoke tests.
- `?debug=1`: exposes `window.__DF_DEBUG__`, which can force rendering the resolution UI (for development).
- `PORT=3010 npm start`: use a different port.
- Bombardment parameters of rulebook v1.0.0: the first is fixed—announced in round 2, exploding in round 4; afterwards it switches by survivor count between 3-round single zone / 2-round single zone / 3-round double zone; the whole segment is the target pool, indiscriminate, anyone on the target segment dies, Ruins cannot be entered, observation/attack are not blocked, and resolution happens at the start of the round.

## Known Limitations

- The host leaving closes the room; a non-host leaving during a match is handled as Hide + death + public broadcast; there is no in-match reconnect/hosting.
- AI is a mix of rule-based/external models: the default model is not guaranteed to be optimal, and `basic` is only a baseline. The GPU model needs a local inference service and is affected by VRAM/latency.
- No accounts, matchmaking, reconnect, spectating, sound effects, or dedicated mobile adaptation.
- Replays are only stored locally in each player's browser; switching computers, clearing site data, or private browsing will not sync/keep them. A player who disconnects before the end has no local replay of that match.
- Replays are sliced by round rather than by each resolution sub-step; the "Hide→Observe→Slip→Attack→Death" within a round is shown in sidebar event order.
- Bombardment parameters still marked "tentative" in the rulebook (Pillar-Pillar hard wall, consecutive Ruins, resolution timing, etc.) follow the current default implementation.
