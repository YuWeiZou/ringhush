import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './rooms.js';
import { randomSeed } from '../src/engine/rng.js';
import { autoResolveAIOnly } from '../src/engine/auto.js';
import { loadAIModels } from '../src/engine/aiLoader.js';
import { AIRuntime } from '../src/engine/aiRuntime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SHARED = path.join(ROOT, 'shared');
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';

const aiModels = await loadAIModels();
const aiRuntime = new AIRuntime(aiModels);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function send(ws, payload) {
  if (ws.readyState === 1) ws.send(JSON.stringify(payload));
}

function error(ws, message) {
  send(ws, { type: 'error', message });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        rooms: rooms.size,
        uptime: process.uptime(),
        aiModels: aiModels.length,
        aiModelIds: aiModels.map((m) => m.id),
      }),
    );
    return;
  }
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (pathname === '/') pathname = '/index.html';

  let base = PUBLIC;
  if (pathname.startsWith('/shared/')) {
    base = SHARED;
    pathname = pathname.slice('/shared'.length);
  }

  const filePath = path.resolve(base, '.' + pathname);
  if (filePath !== base && !filePath.startsWith(base + path.sep)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();

const SHUTDOWN_GRACE_MS = 5000;
let hadClient = false;
let shutdownTimer = null;
let shuttingDown = false;

function cancelShutdown() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}

function scheduleShutdown() {
  if (!hadClient || shuttingDown || wss.clients.size > 0) return;
  cancelShutdown();
  shutdownTimer = setTimeout(() => {
    shutdownTimer = null;
    if (wss.clients.size > 0) return;
    shuttingDown = true;
    console.log('浏览器已全部关闭，服务端退出。');
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
}


function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function currentRoom(ws) {
  const session = ws.session;
  if (!session?.roomId) return null;
  return rooms.get(session.roomId) ?? null;
}

function broadcast(room, payloadForPlayer) {
  for (const [playerId, client] of room.clients) {
    const payload = payloadForPlayer(playerId);
    if (payload) send(client, payload);
  }
}

function viewFor(room, playerId) {
  const view = room.game.getView(playerId);
  view.room = {
    id: room.id,
    hostId: room.hostId,
    turnSeconds: room.turnSeconds,
    serverNow: Date.now(),
    deadline: room.turnDeadline,
    resultDeadline: room.resultDeadline,
    resultMinUntil: room.resultMinUntil,
    externalActionUntil: room.externalActionPlayerId === playerId ? room.externalActionUntil : null,
    autoNextAt: room.autoNextAt,
    ready: [...room.continueReady].filter((id) =>
      room.game.players.some((p) => p.id === id && p.alive && !p.isAI),
    ),
    aliveHumans: room
      .aliveHumans()
      .map((p) => p.id),
  };
  return view;
}

function broadcastState(room) {
  broadcast(room, (playerId) => ({
    type: 'state',
    view: viewFor(room, playerId),
  }));
  sendBridgeViews(room);
}

function sendBridgeViews(room) {
  if (!room.game) return;
  for (const [playerId, client] of room.clients) {
    if (!client.bridgeSeat) continue;
    const seat = room.game.players.find((p) => p.id === client.bridgeSeat);
    if (!seat) continue;
    send(client, {
      type: 'bridgeState',
      playerId: seat.id,
      view: viewFor(room, seat.id),
    });
  }
}

function canBridgeSeat(ws, room, seatId) {
  const player = room.game?.players.find((p) => p.id === seatId);
  if (!player) {
    if (!room.isHost(ws.session.playerId)) return seatId === ws.session.playerId;
    return room.aiSlots.some((s) => s.id === seatId);
  }
  if (seatId === ws.session.playerId) return true;
  return room.isHost(ws.session.playerId) && player.isAI;
}

function subscribeBridge(ws, msg = {}) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  const seatId = Number(msg.playerId ?? ws.session.playerId);
  if (!Number.isInteger(seatId)) return error(ws, '座位不合法');
  if (!canBridgeSeat(ws, room, seatId)) return error(ws, '不能控制这个座位');
  ws.bridgeSeat = seatId;
  const player = room.game?.players.find((p) => p.id === seatId);
  if (player?.isAI) {
    player.aiExternal = true;
    room.externalAISeats.add(seatId);
  }
  if (room.game) {
    send(ws, { type: 'bridgeState', playerId: seatId, view: viewFor(room, seatId) });
  } else {
    send(ws, { type: 'bridgeState', playerId: seatId, view: null });
  }
  return { ok: true };
}

function unsubscribeBridge(ws) {
  const room = currentRoom(ws);
  const seatId = ws.bridgeSeat;
  if (room && seatId != null) {
    room.externalAISeats.delete(seatId);
    const player = room.game?.players.find((p) => p.id === seatId);
    if (player?.isAI) player.aiExternal = false;
  }
  ws.bridgeSeat = null;
  return { ok: true };
}

function broadcastGameOver(room) {
  if (!room.game || room.game.phase !== 'over') return;
  if (!room.replayRecord) {
    const record = room.game.getReplayRecord({
      roomId: room.id,
      hostId: room.hostId,
      turnSeconds: room.turnSeconds,
    });
    record.id = `${room.id}-${record.finishedAt}-${room.game.seed}`;
    room.replayRecord = record;
  }
  const replay = room.replayRecord;
  const winnerId = room.game.winnerId;
  const winnerName =
    winnerId == null
      ? null
      : room.game.players.find((p) => p.id === winnerId)?.name ?? null;
  // 对局结束直接回房间；不自动开下一局。保留人类/AI 座位和计时设置。
  room.resetLobby();
  for (const [playerId, client] of room.clients) {
    send(client, {
      type: 'gameover',
      winnerId,
      winnerName,
      replay,
      lobby: room.lobbyFor(playerId),
      returnToRoom: true,
    });
  }
}

function broadcastLobby(room) {
  broadcast(room, (playerId) => room.lobbyFor(playerId));
}

function aliveHumans(room) {
  return room.game.players.filter((p) => p.alive && !p.isAI);
}

async function startTurn(room) {
  const game = room.game;
  if (!game) return;
  if (game.phase === 'over') {
    broadcastGameOver(room);
    return;
  }
  if (game.phase !== 'selecting') return;
  if (aliveHumans(room).length === 0) {
    await autoResolveAIOnly(game);
    broadcastGameOver(room);
    return;
  }
  room.clearTimers();
  room.continueReady.clear();
  room.turnDeadline = Date.now() + room.turnSeconds * 1000;
  room.resultDeadline = null;
  room.externalActionPending = false;
  room.externalActionPlayerId = null;
  room.externalActionUntil = null;
  for (const player of game.players) player.externalAction = false;
  broadcastState(room);

  // AI 和人类同时开始思考；人类全部提交时，finishRound 会等这个 promise。
  room.aiPrep = game.prepareAIActions().catch((err) => {
    console.error('[ai] prepare failed', err);
  });

  room.turnTimer = setTimeout(() => {
    onTurnTimeout(room).catch((err) => console.error(err));
  }, room.turnSeconds * 1000);
}

async function onTurnTimeout(room) {
  const game = room.game;
  if (!game || game.phase !== 'selecting') return;
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.externalActionPending = false;
  room.externalActionPlayerId = null;
  room.externalActionUntil = null;
  clearTimeout(room.externalActionTimer);
  room.externalActionTimer = null;

  for (const player of room.aliveActors()) {
    if (player.action) continue;
    let result = game.submitAction(player.id, { type: 'hide' });
    if (result.error) {
      result = game.submitAction(player.id, {
        type: 'observe',
        dir: 1,
        length: game.S,
        full: true,
      });
    }
    game.logPublic({
      type: 'timeout',
      playerId: player.id,
      name: player.name,
      round: game.round,
    });
  }

  await finishRound(room);
}

async function finishRound(room) {
  if (room.resolving) return;
  room.resolving = true;
  try {
    const game = room.game;
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    if (room.aiPrep) {
      await room.aiPrep;
      room.aiPrep = null;
    }

    const result = await game.resolve();
    if (result.error) {
      broadcast(room, () => ({ type: 'error', message: result.error }));
      return;
    }
    room.turnDeadline = null;

    if (game.phase === 'over') {
      room.clearTimers();
      broadcastGameOver(room);
      return;
    }

    room.continueReady.clear();
    room.resultDeadline = Date.now() + 20_000;
    room.resultMinUntil = Date.now() + 5_000;
    broadcastState(room);

    if (aliveHumans(room).length === 0) {
      room.clearTimers();
      await autoResolveAIOnly(game);
      broadcastGameOver(room);
      return;
    }

    room.resultTimer = setTimeout(() => {
      onResultTimeout(room).catch((err) => console.error(err));
    }, 20_000);
  } finally {
    room.resolving = false;
  }
}

async function advanceResult(room) {
  if (!room.game || room.game.phase !== 'resolved' || room.advancing) return;
  room.advancing = true;
  try {
    const result = room.game.advance();
    if (result.error) {
      broadcast(room, () => ({ type: 'error', message: result.error }));
      return;
    }
    await startTurn(room);
  } finally {
    room.advancing = false;
  }
}

async function onResultTimeout(room) {
  if (!room.game || room.game.phase !== 'resolved') return;
  clearTimeout(room.resultTimer);
  room.resultTimer = null;
  await advanceResult(room);
}

function createLocalGame(ws, msg = {}) {
  const room = new Room({ id: roomCode(), aiRuntime, seed: randomSeed() });
  rooms.set(room.id, room);
  const added = room.addClient(ws, msg.name || '你');
  if (added.error) {
    rooms.delete(room.id);
    return error(ws, added.error);
  }
  ws.session = { roomId: room.id, playerId: added.playerId };
  // ?auto=1 的测试钩子：允许一次性预填 AI；正常本地开局由房主在房间里添加。
  const wanted = Number(msg.playerCount);
  if (Number.isInteger(wanted) && wanted >= 2 && wanted <= 8) {
    for (let i = 1; i < wanted; i++) room.addAI('random');
  }
  broadcastLobby(room);
}

function createRoom(ws, msg = {}) {
  const room = new Room({ id: roomCode(), aiRuntime, seed: randomSeed() });
  rooms.set(room.id, room);
  const added = room.addClient(ws, msg.name || '房主');
  if (added.error) {
    rooms.delete(room.id);
    return error(ws, added.error);
  }
  ws.session = { roomId: room.id, playerId: added.playerId };
  broadcastLobby(room);
}

function joinRoom(ws, msg) {
  const room = rooms.get(String(msg.roomId || '').toUpperCase());
  if (!room) return error(ws, '房间不存在');
  if (room.started) return error(ws, '对局已经开始了');
  const added = room.addClient(ws, msg.name || '玩家');
  if (added.error) return error(ws, added.error);
  ws.session = { roomId: room.id, playerId: added.playerId };
  broadcastLobby(room);
}

function addAI(ws) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.isHost(ws.session.playerId)) return error(ws, '只有房主可以添加 AI');
  const result = room.addAI('random');
  if (result.error) return error(ws, result.error);
  broadcastLobby(room);
}

function removeAI(ws, msg) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.isHost(ws.session.playerId)) return error(ws, '只有房主可以删除 AI');
  const result = room.removeAI(Number(msg.playerId));
  if (result.error) return error(ws, result.error);
  broadcastLobby(room);
}

function setAI(ws, msg) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.isHost(ws.session.playerId)) return error(ws, '只有房主可以调整 AI');
  const result = room.setAI(Number(msg.playerId), msg.modelId);
  if (result.error) return error(ws, result.error);
  broadcastLobby(room);
}

function setTimer(ws, msg) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.isHost(ws.session.playerId)) return error(ws, '只有房主可以设置计时');
  const result = room.setTurnSeconds(msg.seconds);
  if (result.error) return error(ws, result.error);
  broadcastLobby(room);
}

async function startRoom(ws) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.isHost(ws.session.playerId)) return error(ws, '只有房主可以开始对局');
  const result = room.start();
  if (result.error) return error(ws, result.error);
  broadcastLobby(room);
  await startTurn(room);
}

async function submitAction(ws, msg) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  return applyAction(ws, room, ws.session.playerId, msg.action, false);
}

async function applyAction(ws, room, playerId, rawAction, external) {
  if (!room) return error(ws, '你不在房间里');
  if (!room.game || room.game.phase !== 'selecting') return error(ws, '当前不能行动');
  const player = room.game.players.find((p) => p.id === playerId);
  const result = room.game.submitAction(playerId, rawAction);
  if (result.error) return error(ws, result.error);
  if (player) player.externalAction = external;
  if (!external && room.externalActionPending) {
    room.externalActionPending = false;
    room.externalActionPlayerId = null;
    room.externalActionUntil = null;
    clearTimeout(room.externalActionTimer);
    room.externalActionTimer = null;
  }
  if (room.game.allHumansActed()) {
    if (external) {
      // Give the human 1.5s to overwrite an external auto action before
      // resolving. The action is already valid; this is only a final window.
      clearTimeout(room.externalActionTimer);
      room.externalActionPending = true;
      room.externalActionPlayerId = playerId;
      room.externalActionUntil = Date.now() + 1500;
      broadcastState(room);
      room.externalActionTimer = setTimeout(() => {
        if (!room.game || room.game.phase !== 'selecting') return;
        room.externalActionPending = false;
        room.externalActionPlayerId = null;
        room.externalActionUntil = null;
        room.externalActionTimer = null;
        finishRound(room).catch((err) => console.error('external finish failed', err));
      }, 1500);
      return;
    }
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    await finishRound(room);
  } else {
    broadcastState(room);
  }
}

async function bridgeAction(ws, msg) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  const seatId = Number(msg.playerId ?? ws.bridgeSeat);
  if (!Number.isInteger(seatId)) return error(ws, 'Bridge 没有绑定座位');
  if (!canBridgeSeat(ws, room, seatId)) return error(ws, '不能控制这个座位');
  const player = room.game?.players.find((p) => p.id === seatId);
  if (!player) return error(ws, '座位不存在');
  if (player.isAI) player.aiExternal = true;
  return applyAction(ws, room, seatId, msg.action, Boolean(msg.external));
}

async function cancelExternalAction(ws) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.game || room.game.phase !== 'selecting') return error(ws, '当前不能取消');
  const seatId = Number(ws.bridgeSeat ?? ws.session.playerId);
  if (!canBridgeSeat(ws, room, seatId)) return error(ws, '不能取消这个座位');
  const player = room.game.players.find((p) => p.id === seatId);
  if (!player) return error(ws, '玩家不存在');
  if (!room.externalActionPending && !player.externalAction) return error(ws, '没有可取消的外部行动');
  player.action = null;
  player.externalAction = false;
  room.externalActionPending = false;
  room.externalActionPlayerId = null;
  room.externalActionUntil = null;
  clearTimeout(room.externalActionTimer);
  room.externalActionTimer = null;
  broadcastState(room);
}

async function continueGame(ws) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (!room.game || room.game.phase !== 'resolved') return error(ws, '当前不能继续');
  if (Date.now() < (room.resultMinUntil ?? 0)) return error(ws, '结算查看至少 5 秒后才能继续');
  room.continueReady.add(ws.session.playerId);
  if (room.allAliveHumansReady()) {
    clearTimeout(room.resultTimer);
    room.resultTimer = null;
    await advanceResult(room);
  } else {
    broadcastState(room);
  }
}

function openBridge(ws, msg = {}) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  if (room.hostId !== ws.session.playerId) return error(ws, '只有房主能在本机直接启动 Bridge');
  const token = String(msg.token ?? '');
  if (!token) return error(ws, '缺少 Bridge token');
  const seatId = Number(msg.seatId ?? ws.session.playerId);
  if (!canBridgeSeat(ws, room, seatId)) return error(ws, '不能给这个座位启动 Bridge');
  const gameSeat = room.game?.players.find((p) => p.id === seatId);
  const aiSlot = room.aiSlots.find((s) => s.id === seatId);
  const player = room.humans.get(seatId) ?? gameSeat ?? { name: aiSlot ? 'AI 座位' : '玩家' };
  const script = path.join(ROOT, 'start-ai-bridge.bat');
  if (!fs.existsSync(script)) return error(ws, '找不到 start-ai-bridge.bat');
  try {
    const child = spawn('cmd.exe', [
      '/c', 'start', '', script,
      '--player=' + (player?.name ?? '玩家'),
      '--room=' + room.id,
      '--token=' + token,
    ], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    send(ws, { type: 'bridgeLaunch', ok: true, controlPort: 3210, modelPorts: Array.from({ length: 8 }, (_, i) => 3211 + i) });
  } catch (err) {
    error(ws, 'Bridge 启动失败：' + err.message);
  }
}

function restartGame(ws) {
  const room = currentRoom(ws);
  if (!room) return error(ws, '你不在房间里');
  room.resetLobby();
  broadcastLobby(room);
}

function closeRoom(room, reason) {
  room.clearTimers();
  for (const [, client] of room.clients) {
    send(client, { type: 'error', message: reason });
    send(client, { type: 'menu' });
    client.session = null;
  }
  room.clients.clear();
  room.humans.clear();
  rooms.delete(room.id);
}

async function handlePlayerDisconnect(room, playerId) {
  const game = room.game;
  if (!game || game.phase === 'lobby' || game.phase === 'over') return;
  if (!game.disconnectPlayer(playerId)) return;

  if (game.phase === 'over') {
    room.clearTimers();
    broadcastGameOver(room);
    return;
  }

  if (aliveHumans(room).length === 0) {
    room.clearTimers();
    await autoResolveAIOnly(game);
    broadcastGameOver(room);
    return;
  }

  if (game.phase === 'selecting') {
    if (game.allHumansActed()) {
      await finishRound(room);
      return;
    }
    broadcastState(room);
    return;
  }

  broadcastState(room);
}

async function leaveRoom(ws) {
  const room = currentRoom(ws);
  if (!room) return;
  const info = room.removeClient(ws);
  ws.session = null;
  if (!info) return;
  if (info.hostLeft) {
    closeRoom(room, '房主离开，房间关闭');
    return;
  }
  await handlePlayerDisconnect(room, info.playerId);
  if (room.clients.size === 0) {
    room.clearTimers();
    rooms.delete(room.id);
  } else if (!room.started) {
    broadcastLobby(room);
  }
}

wss.on('connection', (ws) => {
  ws.session = null;
  ws.bridgeSeat = null;
  hadClient = true;
  cancelShutdown();
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return error(ws, '消息不是合法 JSON');
    }
    if (!msg || typeof msg.type !== 'string') return;

    try {
      switch (msg.type) {
        case 'local':
          createLocalGame(ws, msg);
          break;
        case 'createRoom':
          createRoom(ws, msg);
          break;
        case 'joinRoom':
          joinRoom(ws, msg);
          break;
        case 'addAI':
          addAI(ws);
          break;
        case 'removeAI':
          removeAI(ws, msg);
          break;
        case 'setAI':
          setAI(ws, msg);
          break;
        case 'setTimer':
          setTimer(ws, msg);
          break;
        case 'startRoom':
          await startRoom(ws);
          break;
        case 'action':
          await submitAction(ws, msg);
          break;
        case 'continue':
          await continueGame(ws);
          break;
        case 'cancelExternal':
          await cancelExternalAction(ws);
          break;
        case 'openBridge':
          openBridge(ws, msg);
          break;
        case 'subscribeBridge':
          subscribeBridge(ws, msg);
          break;
        case 'unsubscribeBridge':
          unsubscribeBridge(ws);
          break;
        case 'bridgeAction':
          await bridgeAction(ws, msg);
          break;
        case 'restart':
          restartGame(ws);
          break;
        case 'menu':
          await leaveRoom(ws);
          send(ws, { type: 'menu' });
          break;
        case 'ping':
          send(ws, { type: 'pong' });
          break;
        default:
          error(ws, '未知消息类型');
      }
    } catch (err) {
      console.error(err);
      error(ws, '服务器处理失败');
    }
  });

  ws.on('close', () => {
    leaveRoom(ws)
      .catch((err) => console.error('leaveRoom failed', err))
      .finally(scheduleShutdown);
  });
});

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) lan.push(info.address);
    }
  }
  console.log(`黑暗森林 v2.6.1a19 server: http://localhost:${PORT}`);
  for (const ip of lan) console.log(`LAN: http://${ip}:${PORT}`);
  if (aiModels.length) {
    console.log(`AI models (${aiModels.length}): ${aiModels.map((m) => `${m.name}(${m.id})`).join(', ')}`);
  } else {
    console.log('AI models: 无（ai/models 为空，房间内不能添加 AI）');
  }
  console.log('WebSocket: /ws');
});

export { server };
