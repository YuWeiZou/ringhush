# Local AI Bridge · Protocol and Usage

> English | [中文](./AI-BRIDGE.md)

This feature lets an external AI program play for the **local machine player**, but it only ever gets that player's own view.

    Web page (browser on the local machine)
       ↕ 127.0.0.1:3210/control
    Local Bridge terminal
       ↕ 127.0.0.1:3211–3218
    External AI program

The game server only receives the normal `action` that the web page finally submits; it does not know the Bridge exists.

## 1. Starting it

### First time

On the local machine, run:

    install-ai-bridge.bat

It registers, for the current Windows user:

    dfbridge://

After that you no longer have to find the folder and double-click.

### In the room

1. Open “Assist Settings” (辅助设置);
2. Tick “Enable external AI channel” (启用外部 AI 通道);
3. Choose a mode:
   - manually confirm the AI proposal;
   - the AI submits directly;
4. Back in the room, click `Bridge` or `AI Bridge` under the model/description of the corresponding seat;
5. The same button turns into “Close Bridge” (关闭 Bridge); click it again to close.

- The local machine player's own card shows their own Bridge;
- Every AI seat the host adds shows `AI Bridge`, so an external model can take over that AI;
- Ordinary LAN players only see the button for their own seat and do not see the host's AI buttons;
- After the Bridge is closed, the AI returns to the built-in model on the next round.

- Host: the server starts the Bridge directly on the local machine;
- Client machine: the browser opens `dfbridge://`, and the local Windows starts the Bridge;
- The Bridge terminal title/log shows the room and the player name.

You can also run it manually:

    start-ai-bridge.bat

## 2. Ports

    3210  web page ↔ Bridge control port
    3211  external AI channel 1
    3212  external AI channel 2
    ...
    3218  external AI channel 8

- Everything binds to `127.0.0.1`;
- Nothing leaves the LAN;
- One Bridge per machine per player;
- Each channel accepts only one external AI connection;
- The last legal action wins; a human can override it.

## 3. External AI handshake

After connecting to any external port, the Bridge sends:

    {
      "v": 1,
      "type": "hello",
      "protocol": 1,
      "channel": 1,
      "port": 3211,
      "room": "ABCD",
      "player": "<player name>",
      "controlPort": 3210,
      "modelPorts": [3211, 3212, 3213, 3214, 3215, 3216, 3217, 3218]
    }

### Connection confirmation

On the resolution screen the Bridge sends once per second:

    { "v": 1, "type": "round_check", "nonce": 12 }

The AI must reply:

    { "v": 1, "type": "round_ack", "nonce": 12 }

Only channels that have acked receive a `snapshot`.

It confirms once more before the next round starts; on failure, that round falls back to manual.

## 4. Snapshot

You receive:

    {
      "v": 1,
      "type": "snapshot",
      "snapshot": {
        "schema": 1,
        "round": 3,
        "phase": "selecting",
        "S": 13,
        "P": 5,
        "segments": [
          { "index": 0, "terrain": "pillar", "bomb": false }
        ],
        "bomb": { "targets": [4], "targetRound": 6, "mode": "fast" },
        "players": [
          { "id": 0, "name": "You", "alive": true, "isAI": false }
        ],
        "you": {
          "id": 0,
          "name": "You",
          "alive": true,
          "position": 2,
          "terrain": "pillar"
        },
        "legal": {
          "canHide": true,
          "canHideEffective": true,
          "observe": { "max": 6, "full": false },
          "moves": []
        },
        "corpses": [],
        "observations": [],
        "log": [],
        "privateLog": [],
        "lastResult": null
      }
    }

Constraints:

- `players` does not contain other players' positions;
- Other players' coordinates appear only in `spectator` (the local machine player is already out);
- The map, the bombardment, your own private log and the public log are all included;
- `legal` is the server's current legal actions.

## 5. Submitting an action

    {
      "v": 1,
      "type": "action",
      "requestId": "my-ai-1",
      "action": { "type": "hide" }
    }

Supported actions:

    { "type": "hide" }
    { "type": "observe", "dir": 1, "length": 3 }
    { "type": "attack", "target": 4, "dir": -1 }
    { "type": "slip", "dir": 1, "distance": 1 }

The Bridge only forwards it to the web page; the web page/service validates it with the normal rules.

## 6. Manual / automatic

### Manual

The AI's action is shown as:

    AI channel 1 proposes: attack segment 4
    [Accept] [Modify] [Ignore]

- Accept: submit as the human player;
- Modify: open the normal action panel, prefilled with the AI action;
- Ignore: discard;
- Timeout: treated as [Hide].

### Automatic

- A legal AI action is submitted directly;
- The server keeps a **1.5-second human override window**;
- The player can change the action or cancel within those 1.5 seconds;
- After 1.5 seconds it resolves with the AI action;
- A human can always override the AI.

## 7. Example client (Node.js)

    import WebSocket from 'ws';

    const ws = new WebSocket('ws://127.0.0.1:3211');
    let nonce = null;

    ws.on('open', () => {
      // The Bridge sends hello first; the client does not need to authenticate first.
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));

      if (msg.type === 'round_check') {
        nonce = msg.nonce;
        ws.send(JSON.stringify({ type: 'round_ack', nonce }));
      }

      if (msg.type === 'snapshot') {
        const s = msg.snapshot;
        if (s.phase !== 'selecting') return;

        // Simple example: hide if possible, otherwise observe.
        const action = s.legal.canHideEffective
          ? { type: 'hide' }
          : { type: 'observe', dir: 1, length: s.legal.observe.max };

        ws.send(JSON.stringify({
          type: 'action',
          requestId: `ai-${s.round}`,
          action,
        }));
      }
    });

## 8. Security boundary

- The Bridge only listens on `127.0.0.1`;
- It does not leave the LAN;
- The web page only passes the local machine player's view to the Bridge;
- The server does not touch the Bridge;
- If two browsers / two Bridges run on the same machine, the “one player per machine” rule can technically be bypassed; that is local-machine cheating and is handled by the LAN's friendly-play convention.

## 9. Troubleshooting

- Status: not connected to the local Bridge; check: did you run `start-ai-bridge.bat` / `install-ai-bridge.bat`
- Status: connected but no channel; check: is the external AI connected to 3211–3218
- Status: channel not ready; check: did it reply `round_ack`
- Status: no snapshot; check: did you ack on the resolution screen and keep the connection until the next round starts
- Status: action rejected; check: the server's rule validation failed; see the web page prompt
- Status: the Bridge window closes immediately; check: are ports 3210–3218 occupied

## 10. Time to view results

- “Continue to next round” can be clicked only after at least **5 seconds** on the resolution screen;
- After at most **20 seconds** it enters the next round automatically;
- Once all living humans are ready, it enters the next round immediately;
- The Bridge's connection check uses this time and does not slow it down any further.
