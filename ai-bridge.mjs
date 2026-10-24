/**
 * Local external-AI bridge.
 *
 * One process per player. It never talks to the host game server directly:
 * the browser (which already has that player's filtered view) connects to the
 * control port and forwards only that view. External models connect to the
 * eight model ports.
 */
import { WebSocketServer } from 'ws';

function arg(name, fallback = '') {
  const pref = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

function parseLaunch() {
  const urlArg = arg('url');
  if (urlArg) {
    try {
      const u = new URL(urlArg);
      return {
        room: u.searchParams.get('room') || 'ROOM',
        player: u.searchParams.get('player') || '玩家',
        token: u.searchParams.get('token') || '',
      };
    } catch {
      // fall through
    }
  }
  return {
    room: arg('room', 'ROOM'),
    player: arg('player', '玩家'),
    token: arg('token', ''),
  };
}

const launch = parseLaunch();
const CONTROL_PORT = Number(arg('controlPort', 3210));
const MODEL_PORTS = Array.from({ length: 8 }, (_, i) => Number(arg(`p${i + 1}`, 3211 + i)));
process.title = `DF Bridge · ${launch.room} · ${launch.player}`;

console.log('==============================================');
console.log(' 黑暗森林 · 本机外部 AI Bridge');
console.log(` 房间：${launch.room}`);
console.log(` 玩家：${launch.player}`);
console.log(` 控制口：127.0.0.1:${CONTROL_PORT}`);
console.log(` 模型口：127.0.0.1:${MODEL_PORTS.join(', ')}`);
console.log(' 这个窗口只服务当前玩家；不要给其他玩家使用。');
console.log('==============================================');

let control = null;
let controlCloseTimer = null;
let controlToken = launch.token;
let latestSnapshot = null;
let roundNonce = 0;
let checkTimer = null;
let checkEndTimer = null;

const channels = new Map();
for (let i = 0; i < 8; i++) {
  channels.set(i + 1, {
    id: i + 1,
    port: MODEL_PORTS[i],
    socket: null,
    ready: false,
    lastAck: 0,
  });
}

function sendJson(ws, payload) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function controlSend(payload) {
  sendJson(control, payload);
}

function status() {
  return [...channels.values()].map((c) => ({
    channel: c.id,
    port: c.port,
    connected: Boolean(c.socket),
    ready: Boolean(c.ready),
    lastAck: c.lastAck,
  }));
}

function broadcast(payload) {
  for (const c of channels.values()) {
    if (c.socket && c.ready) sendJson(c.socket, payload);
  }
}

function startCheck(durationMs = 5000) {
  clearInterval(checkTimer);
  clearTimeout(checkEndTimer);
  const nonce = ++roundNonce;
  const send = () => {
    const payload = { v: 1, type: 'round_check', nonce, room: launch.room, player: launch.player };
    for (const c of channels.values()) if (c.socket) sendJson(c.socket, payload);
    controlSend({ v: 1, type: 'bridge_status', channels: status(), checking: true, nonce });
  };
  send();
  checkTimer = setInterval(send, 1000);
  checkEndTimer = setTimeout(() => {
    clearInterval(checkTimer);
    checkTimer = null;
    controlSend({ v: 1, type: 'bridge_status', channels: status(), checking: false, nonce });
  }, Math.max(1000, durationMs));
}

function finalRoundCheck() {
  const nonce = ++roundNonce;
  const payload = { v: 1, type: 'round_check', nonce, room: launch.room, player: launch.player, final: true };
  for (const c of channels.values()) if (c.socket) sendJson(c.socket, payload);
  setTimeout(() => {
    const ready = [...channels.values()].some((c) => c.ready);
    if (ready && latestSnapshot) broadcast({ v: 1, type: 'snapshot', snapshot: latestSnapshot });
    controlSend({
      v: 1,
      type: ready ? 'round_ready' : 'round_manual',
      channels: status(),
      nonce,
    });
  }, 1000);
}

const controlServer = new WebSocketServer({ host: '127.0.0.1', port: CONTROL_PORT });
controlServer.on('connection', (ws) => {
  ws.once('message', (raw) => {
    let hello;
    try { hello = JSON.parse(String(raw)); } catch { ws.close(); return; }
    if (hello.type !== 'hello' || hello.token !== controlToken) {
      sendJson(ws, { v: 1, type: 'error', message: 'token 不匹配' });
      ws.close();
      return;
    }
    if (control && control !== ws) {
      sendJson(ws, { v: 1, type: 'error', message: '已有网页连接这个 Bridge' });
      ws.close();
      return;
    }
    control = ws;
    clearTimeout(controlCloseTimer);
    controlCloseTimer = null;
    sendJson(ws, {
      v: 1,
      type: 'hello',
      room: launch.room,
      player: launch.player,
      controlPort: CONTROL_PORT,
      modelPorts: MODEL_PORTS,
    });
    controlSend({ v: 1, type: 'bridge_status', channels: status(), checking: false });
    console.log('[control] 网页已连接');

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(String(buf)); } catch { return; }
      if (msg.type === 'snapshot') {
        latestSnapshot = msg.snapshot ?? null;
        controlSend({ v: 1, type: 'bridge_status', channels: status(), checking: false });
      } else if (msg.type === 'result_start') {
        latestSnapshot = null;
        startCheck(5000);
      } else if (msg.type === 'round_start') {
        if (msg.snapshot) latestSnapshot = msg.snapshot;
        finalRoundCheck();
      } else if (msg.type === 'broadcast' && latestSnapshot) {
        broadcast({ v: 1, type: 'snapshot', snapshot: latestSnapshot });
      }
    });
    ws.on('close', () => {
      if (control === ws) control = null;
      console.log('[control] 网页断开，3 秒后关闭 Bridge');
      clearTimeout(controlCloseTimer);
      controlCloseTimer = setTimeout(() => {
        if (!control) {
          console.log('[control] 没有网页了，Bridge 退出');
          process.exit(0);
        }
      }, 3000);
    });
  });
});
controlServer.on('listening', () => console.log(`[control] listening 127.0.0.1:${CONTROL_PORT}`));
controlServer.on('error', (err) => console.error('[control]', err.message));

for (const channel of channels.values()) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: channel.port });
  server.on('connection', (ws) => {
    if (channel.socket) {
      try { channel.socket.close(4001, 'replaced'); } catch {}
    }
    channel.socket = ws;
    channel.ready = false;
    console.log(`[model ${channel.id}] connected on ${channel.port}`);
    sendJson(ws, {
      v: 1,
      type: 'hello',
      protocol: 1,
      channel: channel.id,
      port: channel.port,
      room: launch.room,
      player: launch.player,
      controlPort: CONTROL_PORT,
      modelPorts: MODEL_PORTS,
      rules: '发送 round_ack 后才会收到 snapshot；action 由网页/游戏校验。',
    });
    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(String(buf)); } catch { return; }
      if (msg.type === 'round_ack') {
        channel.ready = true;
        channel.lastAck = Date.now();
        sendJson(ws, { v: 1, type: 'ack_ok', nonce: msg.nonce ?? null });
        controlSend({ v: 1, type: 'bridge_status', channels: status(), checking: Boolean(checkTimer) });
        if (latestSnapshot) sendJson(ws, { v: 1, type: 'snapshot', snapshot: latestSnapshot });
      } else if (msg.type === 'action') {
        const payload = {
          v: 1,
          type: 'external_action',
          channel: channel.id,
          action: msg.action,
          requestId: msg.requestId ?? null,
        };
        controlSend(payload);
        sendJson(ws, { v: 1, type: 'action_received', requestId: msg.requestId ?? null, channel: channel.id });
      } else if (msg.type === 'ping') {
        sendJson(ws, { v: 1, type: 'pong', ts: Date.now() });
      }
    });
    ws.on('close', () => {
      if (channel.socket === ws) {
        channel.socket = null;
        channel.ready = false;
        console.log(`[model ${channel.id}] disconnected`);
        controlSend({ v: 1, type: 'bridge_status', channels: status(), checking: Boolean(checkTimer) });
      }
    });
  });
  server.on('error', (err) => console.error(`[model ${channel.id}]`, err.message));
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
