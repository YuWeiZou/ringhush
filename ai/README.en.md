# AI Logic Models

> English | [中文](./README.md)

This folder is the AI logic plugin directory for **Dark Forest**. The main program **ships with no AI strategy built in**:

- `ai/models/` empty or missing → the server still starts, but AI cannot be added in a room, and `Start Match` (开始对局) is disabled.
- Put a model `.js` into `ai/models/` and restart the server to install it.
- Before a real match starts, the host can pick a model for each AI seat in the room.
- There is no chat/communication channel during a match; an AI model only gets its own `view`, and `ctx.players` does not contain other players' positions.

## Model API

`ai/models/*.js` must export:

    export const meta = {
      id: 'my-ai',
      name: 'My AI',
      version: '1.0.0',
      generation: 1,
      description: 'One-line description',
      default: false,   // optional: default model
      external: false,  // optional: needs an external inference service
    };

    export function chooseAction(ctx) {
      // May return a Promise (the local GPU model is asynchronous)
      return { type: 'hide' };
    }

Available actions:

    { type: 'hide' }
    { type: 'observe', dir: 1 | -1, length: 1..S }
    { type: 'attack', target: 0..S-1, dir: 1 | -1 } // 0-based inside the engine
    { type: 'slip', dir: 1 | -1, distance: 1 | 2 }

`ctx` includes:

- `round`, `S`, `P`, `map` (terrain/bombardment/ruins)
- `me`: own position/terrain
- `players`: name, whether AI, whether alive; **no position**
- `bomb`, `legal`
- `privateLog`: own observed red dots, gunshots on the left and right, damage taken/death; fire results are not fed back
- `publicLog`: public events
- `memory`: an object persisted across rounds
- `random()`: this AI's own deterministic random numbers
- `helpers`: `mod`, `steps`, `attackArc`, `observeSegments`, `halfPlane`

A model can only reason from this information; it cannot read other players' positions from the engine directly.

## External JSON models

External models go in `ai/external/{id}/model.json`; only declarative JSON is supported, not arbitrary JS. For the full format, conditions, style weights, limits and an LLM generation prompt, see [EXTERNAL-MODELS.en.md](./EXTERNAL-MODELS.en.md).

## Installed models

- id: `adaptive`; name: Adaptive; description: 2.3.3 default. 1v1 lock (yields to bombardment/single-layer ruins/old dots); when everything is known, searches only the reachable pool; gunshot correction.
- id: `hunter`; name: Hunter; description: 2.3.3: 1v1 lock (yields to bombardment/single-layer ruins/old dots); when everything is known, searches only the reachable pool.
- id: `survivor`; name: Stalker; description: 2.3: 1v1 lock guarantees a kill; staying alive comes first; low-probability point clearing/blind shots.
- id: `balanced`; name: Ashes; description: 2.3: 1v1 lock guarantees a kill; mid-game point clearing; zone switching and blind shots in the endgame.
- id: `basic`; name: Night Watchman; description: legacy baseline: hides on a pillar, observes on the plain, never moves and never attacks. **Not in the random pool**; can only be picked manually.
- id: `gpu`; name: Local GPU Model; description: 2.3.0: decides through a GPU inference service on the local machine (currently qwen2.5:3b); falls back to Hunter 2.3 when unavailable.
- id: `apex`; name: Apprentice · JSON; description: 0.1.0: a full-candidate ranker trained from adaptive self-play; experimental, not in the random pool.
- id: `apex-safe`; name: Apprentice · Gatekeeper; description: 0.2.0: uses the student action only in 4-player games with 3–4 players alive, falls back to adaptive otherwise.

### Random pool

- “Random” only draws from models with `randomPool !== false`;
- `basic` (Night Watchman) only hides/observes the full circle and is flagged `randomPool: false`, so it **is not in the random pool**, but it can still be picked manually;
- The other AI 2.2 models and `gpu` are still in the random pool.

### Local model vs AI 2.2 win rate

2-player games, alternating seats, GPU model `qwen2.5:3b` against `adaptive`:

    node ai/sim/h2h.mjs --games=50 --opponent=adaptive

This run, 50 games:

    gpu 15 : 31 adaptive, 4 draws
    gpu win rate (excluding draws): 32.6%
    average 4.6 rounds

But look at the cost:

    GPU calls 228
    legal moves 44
    fallbacks to Hunter 184 (80.7%)

This 32.6% **is not the pure local model's strength**.  
In another set of 20 games, the GPU produced legal moves 87/92 times with 5 fallbacks, yet actually won only 1 game (5%).

Conclusion: qwen2.5:3b is not suitable as a live-play AI for now; it needs 7B/14B, constrained decoding, or a smaller action-classification head.  
The behavior-cloning checkpoint has not been wired back into the game yet, so it cannot be counted into this win rate.

## AI 2.3 behavior

### Observation no longer defaults to the full circle

In older versions `observeAction()` defaulted `full` to `true`, so even AI on a pillar called for a full-circle observation; 2.0 changed that:

- **On the plain**: the rules force a full circle; there is no choice;
- **On a pillar**: the arc width is chosen by player count:
  - 2 players: about half a circle;
  - 3–4 players: about 1/3 of a circle;
  - 5+ players: about 1/4 of a circle;
  - with a recent red dot, it narrows toward the red dot so as not to expose the full circle.
- The observation direction covers recent known red dots first; with no red dots it alternates left and right.

So when you see an AI observe the full circle on the plain, that is forced by the rules/terrain; a full circle on a pillar was a bug in the old implementation, removed in 2.0.

### Attacks no longer always pick the short arc

The old `attackAction()` always picked `min(d1,d2)`; 2.0:

- **1v1 with both players on pillars**: pick the long arc; in a mutual shot the longer arc wins;
- **3–4 players**: long/short arc 50% each, so it cannot be read;
- **5+ players**: favors the short arc, to reduce exposure to third parties;
- **Target on the plain**: short arc (there is no mutual-shot protection on the plain);
- A model can also explicitly request `{ mode: 'long' | 'short' }`; `survivor` still sticks to the short arc to stay alive.

### 2.3.2 Locked kill / bombardment avoidance / gunshot correction

**1v1 locked kill**: when only two players remain, the last enemy has been observed, and the enemy's segment has no room to move at all, `lockedDuelTarget()` treats the enemy as a fixed coordinate. The runtime forces a long-arc attack via `lockAttack()`; but if the AI itself stands on the next round's bombardment target and a legal escape exists, it drops the lock and slips out of the bombardment zone first. `refreshKnown()` also uses the most recent gunshot half-plane to discard old red dots that contradict the sound, and `blindTargets()` narrows the candidate pool with the gunshot half-plane when there are no red dots.

**Mid-game point clearing**: `compartmentRisk()`/`compartmentGuard()` check the bombardment compartment the AI is in. If the compartment is small, there are still uncleared segments nearby, and it has stayed too long, it observes to clear points before hiding, so it is not slipped by someone in the same compartment. To avoid excessive observation, this logic only triggers probabilistically with 3+ players and when there really is an uncleared segment nearby.

**Endgame movement**: `rankedMoves()` counts “how many exits remain at the next step / the step after” and “how large the connected component it is in” into the move score when fewer than 3 players remain (or fewer than 5 and fast/double-zone bombardment has started). `endgameMove()` actively repositions in these cases:

- The component it is in is cut into a small pocket by the next round's ruins/bombardment forecast;
- The current segment is a dead end with only one exit;
- It has stayed in the same segment too long and may become the opponent's blind-shot target.

It does not read other players' positions; it only uses the public map, the current/next-round bombardment targets, its own private observations and public alive information.

**Blind shots by elimination**: `blindTargets()` starts from its own private `observe` records, expands candidate segments by “how many rounds have passed, how far the target can have moved at most”, and excludes ruins/current bombardment targets/its own segment. `blindAttack()` only fires when fewer than 3 players remain and the candidate pool has concentrated enough weight on one segment; it is both a blind shot and a response to being blind-shot by an enemy.

### Simulation behavior metrics

`ai/sim/run.js` reports for each bracket:

- `observeFullRate`: ratio of full-circle observations;
- `observePillarFull`: full circle on a pillar (should be 0 in 2.0);
- `observePlainForced`: forced full circle on the plain;
- `attackLongRate`: ratio of long-arc attacks.

AI 2.3.3 results at 500 games per bracket (5 models mixed, 2/4/8 players):

- Players: 2; full-circle observations: 17–100%; full circle on pillar: 0; long-arc attacks: 23–39%
- Players: 4; full-circle observations: 9–100%; full circle on pillar: 0; long-arc attacks: 38–100%
- Players: 8; full-circle observations: 8–100%; full circle on pillar: 0; long-arc attacks: 17–74%

All full-circle observations come from the forced full circle on the plain; full circles on pillars are 0. The long-arc ratio is low because many targets are on the plain, where attacks have no mutual-shot protection and the short arc is better.

### Running 2.3 simulations

    node ai/sim/run.js --games=1000 --players=2,4,8
    node ai/sim/run.js --games=1000 --players=2,4,8 --models=adaptive,hunter,survivor,balanced

## Local GPU model (7900 XTX)

The Node service **does no inference**. It compresses the AI's own situation into JSON and sends it to an inference service running on the local machine; the GPU picks the action. This keeps PyTorch/ROCm dependencies out of the game itself.

Config file: [gpu.config.json](./gpu.config.json)

    {
      "mode": "openai",
      "url": "http://127.0.0.1:11434/v1/chat/completions",
      "model": "qwen2.5:3b",
      "apiKey": "",
      "timeoutMs": 15000
    }

Verified on the local machine (2026-10-21):

- Ollama `0.40.6`, model `qwen2.5:3b`;
- `ollama ps` shows `100% GPU`;
- Preflight command:

    node ai/sim/gpu-check.mjs --load
    # loaded: qwen2.5:3b · vram=.../... (100% GPU)

- For the PyTorch/ROCm training baseline see [train/README.en.md](./train/README.en.md):
  - WSL2 + torch `2.8.0+rocm7.2.0`;
  - RX 7900 XTX, iteration 1: 92,521 decisions, 3 seeds, best validation action accuracy 67.6%.

Environment variable overrides are also supported:

    DARK_FOREST_GPU_URL=...
    DARK_FOREST_GPU_MODEL=...
    DARK_FOREST_GPU_KEY=...
    DARK_FOREST_GPU_TIMEOUT_MS=...
    DARK_FOREST_GPU_MODE=openai|decide

### Option A: Ollama (AMD ROCm / Vulkan)

    ollama serve
    ollama pull qwen2.5:3b

A 7900 XTX 24GB can run quantized models at the 14B level; this round only validates `qwen2.5:3b` (1.9GB), already confirmed at 100% GPU. Change the model name to whatever is in your local `ollama list`.

### Option B: llama.cpp server (Vulkan)

    llama-server -m your-model.gguf --host 127.0.0.1 --port 8080 -ngl 99

Then change `url` in `gpu.config.json` to `http://127.0.0.1:8080/v1/chat/completions`, and `model` to the name the service requires.

### Custom model service

With `mode: "decide"`, the game POSTs:

    { "state": { "...": "..." } }

The service returns:

    { "action": { "type": "attack", "target": 5, "dir": 1 } }

It may also return the action object directly. `gpu.js` validates legality; an illegal or timed-out response falls back to Hunter within 30 seconds, so the match does not stall.

## Running simulations

    node ai/sim/run.js --games=1000 --players=2,4,8

- `external` models are skipped by default (the GPU model infers on every step, which does not suit large batch simulations).
- Results are written to `ai/sim/results.json`.
- In the current mixed 500 games per bracket, `adaptive`'s per-seat win rate in 2/4/8-player games is about 62.3% / 30.3% / 15.0%; `hunter` about 58.5% / 24.5% / 8.9%; `survivor` about 17.2% in 8-player games.
- `external` is skipped by default; to run the GPU model: `node ai/sim/run.js --games=50 --players=2,4 --external --models=gpu`, but every step goes through the inference service, so the speed depends on the local GPU/model.

## Empty folder

    # Make AI unavailable
    mv ai/models ai/models.disabled
    # Restart the server

The server prints `AI models: 无` (“none”); on the local machine the start button shows “Missing AI model” (缺少 AI 模型) after entering a room, and a match with AI cannot start. If the room has purely human seats, the match can still start.

## Install / uninstall

- **Install**: put the whole `ai/` folder in the project root and restart the server.
- **Uninstall**: move `ai/models/` away and restart the server.
- You can also point `DARK_FOREST_AI_DIR=/path/to/models` at another model directory.
- No change to the main program code is needed; the loader is in `src/engine/aiLoader.js`, the runtime in `src/engine/aiRuntime.js`.
