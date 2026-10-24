import { Game } from '../src/engine/game.js';
import { createMap } from '../src/engine/map.js';
import { makeRng, randomSeed } from '../src/engine/rng.js';

const MAX_TOTAL = 8;
const MIN_TURN = 20;
const MAX_TURN = 180;
const DEFAULT_TURN = 60;

export class Room {
  constructor({ id, aiRuntime = null, seed = randomSeed() }) {
    this.id = id;
    this.aiRuntime = aiRuntime;
    this.seed = seed;
    this.humans = new Map(); // playerId -> { id, name, host }
    this.clients = new Map(); // playerId -> ws
    this.aiSlots = []; // { id, modelId }
    this.externalAISeats = new Set();
    this.nextAIId = 100;
    this.hostId = 0;
    this.turnSeconds = DEFAULT_TURN;
    this.started = false;
    this.game = null;
    this.turnTimer = null;
    this.resultTimer = null;
    this.autoNextTimer = null;
    this.autoNextAt = null;
    this.resolving = false;
    this.advancing = false;
    this.turnDeadline = null;
    this.resultDeadline = null;
    this.resultMinUntil = null;
    this.externalActionPending = false;
    this.externalActionUntil = null;
    this.externalActionPlayerId = null;
    this.externalActionTimer = null;
    this.continueReady = new Set();
    this.replayRecord = null;
    this.createdAt = Date.now();
  }

  get total() {
    return this.humans.size + this.aiSlots.length;
  }

  isHost(playerId) {
    return playerId === this.hostId;
  }

  addClient(ws, name = '玩家') {
    if (this.started) return { error: '对局已经开始了' };
    if (this.total >= MAX_TOTAL) return { error: '房间已满（最多 8 人，含 AI）' };
    let id = -1;
    for (let i = 0; i < MAX_TOTAL; i++) {
      if (!this.humans.has(i)) {
        id = i;
        break;
      }
    }
    if (id < 0) return { error: '没有空座位' };
    const cleanName = String(name || '').trim().slice(0, 16) || `玩家${id + 1}`;
    this.humans.set(id, { id, name: cleanName, host: id === this.hostId });
    this.clients.set(id, ws);
    if (id === this.hostId) this.humans.get(id).host = true;
    return { playerId: id };
  }

  addAI(modelId = 'random') {
    if (this.started) return { error: '对局已经开始了' };
    if (this.total >= MAX_TOTAL) return { error: '最多 8 人（含 AI）' };
    if (!this.aiRuntime?.size) return { error: 'AI 逻辑文件夹为空：不能添加 AI' };
    const id = this.nextAIId++;
    const clean = this.aiRuntime.hasModel(modelId) ? modelId : 'random';
    this.aiSlots.push({ id, modelId: clean });
    return { ok: true, id };
  }

  removeAI(playerId) {
    if (this.started) return { error: '对局已经开始了' };
    const before = this.aiSlots.length;
    this.aiSlots = this.aiSlots.filter((s) => s.id !== playerId);
    this.externalAISeats.delete(playerId);
    return this.aiSlots.length === before ? { error: 'AI 座位不存在' } : { ok: true };
  }

  setAI(playerId, modelId) {
    if (this.started) return { error: '对局已经开始了' };
    const slot = this.aiSlots.find((s) => s.id === playerId);
    if (!slot) return { error: 'AI 座位不存在' };
    const id = String(modelId ?? '');
    if (id !== 'random' && !this.aiRuntime?.hasModel(id)) {
      return { error: 'AI 模型不存在' };
    }
    slot.modelId = id;
    return { ok: true };
  }

  setTurnSeconds(seconds) {
    if (this.started) return { error: '对局已经开始了' };
    const value = Math.max(MIN_TURN, Math.min(MAX_TURN, Math.round(Number(seconds) || DEFAULT_TURN)));
    this.turnSeconds = value;
    return { ok: true, turnSeconds: value };
  }

  resolveAIModels() {
    const allModels = this.aiRuntime?.listModels?.() ?? [];
    const usableModels = allModels.filter((m) => m.usable !== false);
    const randomModels = usableModels.filter((m) => m.randomPool !== false);
    const ids = (randomModels.length ? randomModels : usableModels).map((m) => m.id);
    if (this.aiSlots.length && !ids.length) {
      return { error: 'AI 逻辑文件夹为空：不能添加 AI' };
    }
    const rng = makeRng(`${this.seed}:ai-seats`);
    const resolved = [];
    for (const slot of this.aiSlots) {
      const modelId =
        slot.modelId === 'random'
          ? ids[Math.floor(rng() * ids.length)]
          : slot.modelId;
      if (!this.aiRuntime?.hasModel(modelId)) {
        return { error: `AI 模型不可用：${modelId}` };
      }
      resolved.push({ ...slot, modelId });
    }
    return { slots: resolved };
  }

  start() {
    if (this.started) return { error: '对局已经开始了' };
    if (this.total < 2) return { error: '至少需要 2 人（人类或 AI）' };
    if (this.total > MAX_TOTAL) return { error: '最多 8 人（含 AI）' };
    const ai = this.resolveAIModels();
    if (ai.error) return ai;

    const humans = [...this.humans.values()].sort((a, b) => a.id - b.id);
    const total = humans.length + ai.slots.length;
    const map = createMap(total, makeRng(`${this.seed}:map`));
    const players = [];

    humans.forEach((h, index) => {
      players.push({
        id: h.id,
        name: h.name,
        isAI: false,
        alive: true,
        position: map.starts[index],
        action: null,
        deathCause: null,
        aiModel: null,
        aiMemory: {},
      });
    });
    ai.slots.forEach((slot, index) => {
      players.push({
        id: slot.id,
        name: `AI-${index + 1}`,
        isAI: true,
        alive: true,
        position: map.starts[humans.length + index],
        action: null,
        deathCause: null,
        aiModel: slot.modelId,
        aiMemory: {},
        aiExternal: this.externalAISeats.has(slot.id),
      });
    });

    this.game = new Game({
      playerCount: total,
      humanSeats: humans.length,
      seed: this.seed,
      map,
      players,
      autoStart: false,
      aiRuntime: this.aiRuntime,
    });

    try {
      this.game.start();
    } catch (err) {
      this.game = null;
      return { error: err.message };
    }
    this.started = true;
    return { ok: true };
  }

  lobbyFor(playerId) {
    const models = this.aiRuntime?.listModels() ?? [];
    const humans = [...this.humans.values()]
      .sort((a, b) => a.id - b.id)
      .map((h) => ({
        id: h.id,
        name: h.name,
        host: h.id === this.hostId,
        you: h.id === playerId,
      }));
    const aiSlots = this.aiSlots.map((slot, index) => {
      const model = models.find((m) => m.id === slot.modelId) ?? null;
      return {
        id: slot.id,
        name: `AI-${index + 1}`,
        modelId: slot.modelId,
        modelName: slot.modelId === 'random' ? '随机' : model?.name ?? slot.modelId,
      };
    });
    const host = playerId === this.hostId;
    const usableModels = models.filter((m) => m.usable !== false);
    const allModelsOk = this.aiSlots.every(
      (s) => s.modelId === 'random' || usableModels.some((m) => m.id === s.modelId),
    );
    return {
      type: 'lobby',
      roomId: this.id,
      playerId,
      hostId: this.hostId,
      started: this.started,
      maxTotal: MAX_TOTAL,
      total: this.total,
      turnSeconds: this.turnSeconds,
      models,
      humans,
      aiSlots,
      canAddAI: host && !this.started && this.total < MAX_TOTAL && usableModels.length > 0,
      canStart:
        host && !this.started && this.total >= 2 && this.total <= MAX_TOTAL && allModelsOk,
    };
  }

  resetLobby() {
    this.clearTimers();
    this.game = null;
    this.started = false;
    this.resolving = false;
    this.advancing = false;
    this.replayRecord = null;
    this.continueReady.clear();
    this.seed = randomSeed();
    return { ok: true };
  }

  clearTimers() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.resultTimer);
    clearTimeout(this.autoNextTimer);
    this.turnTimer = null;
    this.resultTimer = null;
    this.autoNextTimer = null;
    this.autoNextAt = null;
    this.turnDeadline = null;
    this.resultDeadline = null;
    this.resultMinUntil = null;
    this.externalActionPending = false;
    this.externalActionUntil = null;
    this.externalActionPlayerId = null;
    clearTimeout(this.externalActionTimer);
    this.externalActionTimer = null;
  }

  aliveHumans() {
    if (!this.game) return [];
    return this.game.players.filter((p) => p.alive && !p.isAI);
  }

  aliveActors() {
    if (!this.game) return [];
    return this.game.players.filter((p) => p.alive && (!p.isAI || p.aiExternal));
  }

  allAliveHumansReady() {
    const alive = this.aliveHumans();
    return alive.length > 0 && alive.every((p) => this.continueReady.has(p.id));
  }

  removeClient(ws) {
    for (const [playerId, client] of this.clients) {
      if (client === ws) {
        this.clients.delete(playerId);
        const human = this.humans.get(playerId);
        this.humans.delete(playerId);
        return { playerId, hostLeft: playerId === this.hostId, human };
      }
    }
    return null;
  }
}
