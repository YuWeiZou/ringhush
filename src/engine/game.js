import { createMap } from './map.js';
import { makeRng, randomSeed } from './rng.js';
import {
  buildLegalActions,
  validateAction,
  exposureArc,
  isHiding,
} from './actions.js';
import { halfPlane, observeSegments, steps } from '../../shared/ring.js';

export class Game {
  constructor({
    playerCount = 4,
    humanSeats = 1,
    seed = randomSeed(),
    map = null,
    players = null,
    round = 1,
    autoStart = true,
    aiRuntime = null,
  } = {}) {
    if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 8) {
      throw new Error('playerCount 必须是 2–8');
    }
    if (humanSeats < 0 || humanSeats > playerCount) {
      throw new Error('humanSeats 不合法');
    }

    this.n = playerCount;
    this.humanSeats = humanSeats;
    this.seed = String(seed);
    this.rng = makeRng(this.seed);
    this.aiRuntime = aiRuntime;

    const generated = map ?? createMap(playerCount, this.rng);
    this.S = generated.S;
    this.P = generated.P ?? generated.terrains.filter((t) => t === 'pillar').length;
    this.terrains = generated.terrains.slice();
    this.ruins = (generated.ruins ?? Array(this.S).fill(false)).slice();
    for (let i = 0; i < this.S; i++) {
      if (this.ruins[i]) this.terrains[i] = 'ruins';
    }

    const starts = generated.starts ?? [];
    this.players =
      players?.map((p) => ({ ...p })) ??
      Array.from({ length: playerCount }, (_, i) => ({
        id: i,
        name:
          i === 0
            ? '你'
            : i < humanSeats
              ? `玩家${i + 1}`
              : `AI-${i - humanSeats + 1}`,
        isAI: i >= humanSeats,
        alive: true,
        position: starts[i] ?? 0,
        action: null,
        deathCause: null,
        aiModel: i >= humanSeats ? (aiRuntime?.defaultModelId ?? null) : null,
        aiMemory: {},
      }));

    for (const p of this.players) {
      if (!p.isAI) continue;
      p.aiModel = p.aiModel ?? aiRuntime?.defaultModelId ?? null;
      p.aiMemory = p.aiMemory && typeof p.aiMemory === 'object' ? p.aiMemory : {};
    }

    this.round = round;
    this.phase = 'lobby';
    this.bomb = {
      target: null,
      targets: [],
      targetRound: null,
      mode: 'normal',
      announcedRound: null,
    };
    this.publicLog = [];
    this.privateEvents = new Map(this.players.map((p) => [p.id, []]));
    this.roundPublic = [];
    this.roundPrivate = new Map(this.players.map((p) => [p.id, []]));
    this.observations = new Map();
    this.winnerId = null;
    this.deathsThisRound = new Map();
    this.corpses = new Map();
    this.corpseKnowledge = new Map(this.players.map((p) => [p.id, new Map()]));
    this.replay = {
      version: 1,
      startedAt: Date.now(),
      map: this.terrains.slice(),
      rounds: [],
    };

    if (autoStart) this.start();
  }

  start() {
    if (this.phase !== 'lobby') return;
    const aiPlayers = this.players.filter((p) => p.isAI);
    if (aiPlayers.length > 0) {
      if (!this.aiRuntime) {
        throw new Error('AI 逻辑文件夹为空：不能添加 AI');
      }
      for (const p of aiPlayers) {
        const modelId = p.aiModel ?? this.aiRuntime.defaultModelId;
        if (!this.aiRuntime.hasModel(modelId)) {
          throw new Error(`AI 模型不可用：${modelId ?? '未选择'}`);
        }
        p.aiModel = modelId;
      }
    }

    this.phase = 'selecting';
    this.logPublic({
      type: 'start',
      n: this.n,
      S: this.S,
      P: this.P,
      seed: this.seed,
    });
    this.startRound();
  }

  startRound() {
    if (this.phase === 'over') return;
    this.roundPublic = [];
    this.roundPrivate = new Map(this.players.map((p) => [p.id, []]));
    this.observations = new Map();
    this.deathsThisRound = new Map();
    this.roundAttacks = [];
    this.players.forEach((p) => {
      p.action = null;
      p.hiding = false;
      p.attackArcLength = null;
    });
    this.aiPrep = null;

    this.handleBombardment();
    this.pushReplayRound();
    if (this.checkOver()) {
      this.finishReplayRound();
      return;
    }
    this.phase = 'selecting';
  }

  snapshotReplayPlayers() {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      aiModel: p.aiModel ?? null,
      alive: p.alive,
      position: p.position,
      terrain: this.terrains[p.position],
    }));
  }

  recordCorpse(player, cause) {
    if (!player || player.position == null) return;
    const segment = player.position;
    const death = {
      round: this.round,
      playerId: player.id,
      name: player.name,
      cause: cause ?? player.deathCause ?? 'unknown',
    };
    const existing = this.corpses.get(segment);
    if (existing) {
      existing.count += 1;
      existing.lastRound = this.round;
      existing.deaths.push(death);
    } else {
      this.corpses.set(segment, {
        segment,
        count: 1,
        firstRound: this.round,
        lastRound: this.round,
        deaths: [death],
      });
    }
  }

  snapshotCorpses() {
    return [...this.corpses.values()]
      .map((entry) => ({
        segment: entry.segment,
        count: entry.count,
        firstRound: entry.firstRound,
        lastRound: entry.lastRound,
        deaths: entry.deaths.map((d) => ({ ...d })),
      }))
      .sort((a, b) => a.segment - b.segment);
  }

  refreshCorpseKnowledge(player) {
    if (!player || !player.alive || player.position == null) return null;
    const pile = this.corpses.get(player.position);
    if (!pile) return null;
    const knownBySegment = this.corpseKnowledge.get(player.id);
    if (!knownBySegment) return null;
    const known = knownBySegment.get(player.position);
    if (!known) {
      const fresh = {
        segment: player.position,
        count: pile.count,
        firstRound: this.round,
        lastRound: this.round,
      };
      knownBySegment.set(player.position, fresh);
      return fresh;
    }
    if (pile.count > known.count) {
      known.count = pile.count;
      known.lastRound = this.round;
    }
    return known;
  }

  pushReplayRound() {
    this.replay.rounds.push({
      round: this.round,
      start: this.snapshotReplayPlayers(),
      terrains: this.terrains.slice(),
      corpses: this.snapshotCorpses(),
      bomb: { ...this.bomb },
      actions: [],
      attacks: [],
      observations: {},
      public: [],
      private: {},
      end: null,
      terrainsEnd: null,
      corpsesEnd: null,
      winnerId: null,
    });
  }

  finishReplayRound(actionsOverride = null) {
    const entry = this.replay.rounds[this.replay.rounds.length - 1];
    if (!entry || entry.round !== this.round) return;
    const actions =
      actionsOverride ??
      this.players
        .filter((p) => p.action)
        .map((p) => ({ id: p.id, name: p.name, action: { ...p.action } }));
    entry.actions = actions;
    entry.attacks = this.roundAttacks.map((a) => ({ ...a }));
    entry.observations = Object.fromEntries(
      [...this.observations.entries()].map(([id, segments]) => [id, [...segments]]),
    );
    entry.public = this.roundPublic.map((e) => ({ ...e }));
    entry.private = {};
    for (const [id, events] of this.roundPrivate.entries()) {
      entry.private[id] = events.map((e) => ({ ...e }));
    }
    entry.end = this.snapshotReplayPlayers();
    entry.terrainsEnd = this.terrains.slice();
    entry.corpsesEnd = this.snapshotCorpses();
    entry.winnerId = this.winnerId;
  }

  getReplayRecord(extra = {}) {
    return {
      version: 1,
      ...extra,
      seed: this.seed,
      n: this.n,
      S: this.S,
      P: this.P,
      map: this.replay.map,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        aiModel: p.aiModel ?? null,
      })),
      startedAt: this.replay.startedAt,
      finishedAt: Date.now(),
      winnerId: this.winnerId,
      corpses: this.snapshotCorpses(),
      rounds: this.replay.rounds,
    };
  }

  bombModeInfo() {
    const alive = this.players.filter((p) => p.alive).length;
    const half = Math.ceil(this.n / 2);
    const quarter = Math.ceil(this.n / 4);
    if (alive <= quarter) {
      return { alive, half, quarter, mode: 'double', interval: 3, targetCount: 2 };
    }
    if (alive <= half) {
      return { alive, half, quarter, mode: 'fast', interval: 2, targetCount: 1 };
    }
    return { alive, half, quarter, mode: 'normal', interval: 3, targetCount: 1 };
  }

  disconnectPlayer(playerId) {
    const player = this.players.find((p) => p.id === playerId);
    if (
      !player ||
      !player.alive ||
      this.phase === 'lobby' ||
      this.phase === 'over'
    ) {
      return false;
    }
    const wasSelecting = this.phase === 'selecting';
    if (wasSelecting) player.action = { type: 'hide' };
    player.alive = false;
    player.deathCause = 'disconnect';
    this.deathsThisRound.set(player.id, 'disconnect');
    this.recordCorpse(player, 'disconnect');
    const event = {
      type: 'death',
      playerId: player.id,
      name: player.name,
      cause: 'disconnect',
      round: this.round,
    };
    this.logPublic(event);
    const over = this.checkOver();
    if (wasSelecting && over) {
      this.finishReplayRound();
    } else {
      const entry = this.replay.rounds[this.replay.rounds.length - 1];
      if (entry && entry.round === this.round) {
        entry.public = this.roundPublic.map((e) => ({ ...e }));
        entry.end = this.snapshotReplayPlayers();
        entry.corpsesEnd = this.snapshotCorpses();
        entry.winnerId = this.winnerId;
      }
    }
    return true;
  }

  handleBombardment() {
    // The countdown is owned by this.bomb and is replaced only by
    // announceBomb(). Deaths during the countdown must not change the
    // current target, target round, mode, or visual urgency.
    // 首轮节奏不变：第 2 回合预告，第 4 回合轰炸。
    if (this.round === 2 && this.bomb.targets.length === 0) {
      this.announceBomb(4, 1, 'normal', this.bombModeInfo());
    }

    if (this.bomb.targets.length > 0 && this.round === this.bomb.targetRound) {
      const targets = [...this.bomb.targets];
      for (const target of targets) {
        const victims = this.players.filter((p) => p.alive && p.position === target);
        for (const p of victims) {
          p.alive = false;
          p.deathCause = 'bomb';
          this.private(p.id, { type: 'death', cause: 'bomb' });
          this.recordCorpse(p, 'bomb');
        }
        this.terrains[target] = 'ruins';
        this.ruins[target] = true;
        this.logPublic({
          type: 'bombed',
          target,
          targets,
          victims: victims.map((p) => ({ id: p.id, name: p.name })),
        });
      }
      this.bomb = {
        target: null,
        targets: [],
        targetRound: null,
        mode: 'normal',
        announcedRound: null,
      };
      if (this.players.filter((p) => p.alive).length > 1) {
        const info = this.bombModeInfo();
        this.announceBomb(this.round + info.interval, info.targetCount, info.mode, info);
      }
    }
  }

  announceBomb(targetRound, targetCount = 1, mode = 'normal', info = null) {
    const candidates = [];
    for (let i = 0; i < this.S; i++) {
      if (this.terrains[i] !== 'ruins') candidates.push(i);
    }
    if (candidates.length === 0) {
      this.logPublic({ type: 'noBombTargets' });
      return;
    }
    const count = Math.max(1, Math.min(targetCount, candidates.length));
    const targets = [];
    const pool = [...candidates];
    while (targets.length < count) {
      const index = Math.floor(this.rng() * pool.length);
      targets.push(pool.splice(index, 1)[0]);
    }
    const detail = info ?? this.bombModeInfo();
    this.bomb = {
      target: targets[0] ?? null,
      targets,
      targetRound,
      mode,
      announcedRound: this.round,
    };
    this.logPublic({
      type: 'bombWarning',
      target: targets[0] ?? null,
      targets,
      targetRound,
      mode,
      alive: detail.alive,
      thresholdHalf: detail.half,
      thresholdQuarter: detail.quarter,
    });
  }

  submitAction(playerId, raw) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { error: '玩家不存在' };
    const result = validateAction(this, player, raw);
    if (result.error) return result;
    player.action = result.action;
    return { action: result.action };
  }

  allHumansActed() {
    // An AI seat with an external bridge is driven like a human actor: the
    // round waits for its action (or the turn timeout).
    const actors = this.players.filter((p) => p.alive && (!p.isAI || p.aiExternal));
    return actors.every((p) => p.action !== null);
  }

  async fillAIActions() {
    const pending = this.players.filter(
      (p) => p.alive && p.isAI && !p.aiExternal && !p.action,
    );
    await Promise.all(
      pending.map(async (p) => {
        const chosen = await this.aiRuntime?.chooseAction(this, p);
        let raw = chosen?.action;
        if (!raw) {
          console.warn(
            `[ai] ${p.name} 没有可用行动${chosen?.error ? `：${chosen.error}` : ''}，使用保底行动`,
          );
          raw =
            this.terrains[p.position] === 'pillar'
              ? { type: 'hide' }
              : { type: 'observe', dir: 1, length: this.S, full: true };
        }
        const result = validateAction(this, p, raw);
        if (result.error) {
          p.action =
            this.terrains[p.position] === 'pillar'
              ? { type: 'hide' }
              : { type: 'observe', dir: 1, length: this.S, full: true };
        } else {
          p.action = result.action;
        }
      }),
    );
  }

  prepareAIActions() {
    if (this.phase !== 'selecting') return Promise.resolve();
    if (this.aiPrep) return this.aiPrep;
    const promise = this.fillAIActions().finally(() => {
      if (this.aiPrep === promise) this.aiPrep = null;
    });
    this.aiPrep = promise;
    return promise;
  }

  resolve() {
    if (this.phase !== 'selecting') return { error: '当前不是结算阶段' };
    const needsAI = this.players.some(
      (p) => p.alive && p.isAI && !p.aiExternal && !p.action,
    );
    if (!needsAI) return this.resolveRound();
    return this.resolveWithAI();
  }

  async resolveWithAI() {
    await this.prepareAIActions();
    return this.resolveRound();
  }

  resolveRound() {
    if (this.phase !== 'selecting') return { error: '当前不是结算阶段' };

    const alive = this.players.filter((p) => p.alive);
    const missing = alive.filter((p) => !p.action);
    if (missing.length > 0) {
      return { error: `还有玩家未行动：${missing.map((p) => p.name).join('、')}` };
    }

    const start = new Map();
    for (const p of alive) {
      start.set(p.id, {
        position: p.position,
        terrain: this.terrains[p.position],
        action: p.action,
      });
    }

    this.deathsThisRound = new Map();
    const kill = (player, cause) => {
      if (!player || !player.alive) return;
      player.alive = false;
      player.deathCause = cause;
      this.deathsThisRound.set(player.id, cause);
      this.recordCorpse(player, cause);
    };

    // 1. 藏身状态（观/攻判定会读取）
    for (const p of alive) {
      p.hiding = isHiding(this, p, p.action);
    }

    // 2. 观测
    for (const p of alive) {
      if (p.action.type !== 'observe') continue;
      const s = start.get(p.id);
      const arc = observeSegments(s.position, p.action.dir, p.action.length, this.S);
      const hits = [];
      for (const seg of arc) {
        if (seg === s.position) continue;
        const occ = alive.find((q) => start.get(q.id).position === seg);
        if (!occ) continue;
        const occStart = start.get(occ.id);
        const occHiding =
          occ.action.type === 'hide' && occStart.terrain === 'pillar';
        if (!occHiding) hits.push(seg);
      }
      this.observations.set(p.id, hits);
      this.private(p.id, {
        type: 'observe',
        segments: hits,
        dir: p.action.dir,
        length: p.action.length,
        from: s.position,
      });
    }

    // 3. 溜
    const moversByDest = new Map();
    for (const p of alive) {
      if (p.action.type !== 'slip') continue;
      const dest = p.action.destination;
      p.position = dest;
      this.private(p.id, {
        type: 'slipResult',
        destination: dest,
        cross: Boolean(p.action.cross),
      });
      if (!moversByDest.has(dest)) moversByDest.set(dest, []);
      moversByDest.get(dest).push(p);
    }

    const stayersBySegment = new Map();
    for (const p of alive) {
      if (p.action.type === 'slip') continue;
      const s = start.get(p.id);
      if (!stayersBySegment.has(s.position)) stayersBySegment.set(s.position, []);
      stayersBySegment.get(s.position).push(p);
    }

    for (const [dest, movers] of moversByDest) {
      const stayers = stayersBySegment.get(dest) ?? [];
      const all = [...movers, ...stayers];

      if (movers.length === 1 && stayers.length === 1) {
        const mover = movers[0];
        const occupant = stayers[0];
        const moverStart = start.get(mover.id);
        const occStart = start.get(occupant.id);
        const occAction = occupant.action;

        if (occAction.type === 'hide' || occAction.type === 'attack') {
          kill(occupant, 'slip');
        } else if (occAction.type === 'observe') {
          const occArc = observeSegments(
            occStart.position,
            occAction.dir,
            occAction.length,
            this.S,
          );
          if (occArc.includes(moverStart.position)) {
            kill(mover, 'slip');
            this.private(occupant.id, {
              type: 'slipSeen',
              moverStart: moverStart.position,
            });
          } else {
            kill(occupant, 'slip');
          }
        }
      } else if (movers.length >= 2) {
        const distanceOf = (p) =>
          p.action.type === 'slip' ? p.action.distance : 0;
        const min = Math.min(...all.map(distanceOf));
        const shortest = all.filter((p) => distanceOf(p) === min);

        if (shortest.length === 1) {
          const survivor = shortest[0];
          for (const p of all) {
            if (p.id !== survivor.id) kill(p, 'slip');
          }
        } else {
          for (const p of all) kill(p, 'slip');
        }
      } else if (movers.length === 1 && stayers.length === 0) {
        // 单独溜进空段，留下
      }
    }

    // 4. 攻
    const attackers = alive.filter(
      (p) => p.alive && p.action.type === 'attack',
    );
    const hits = [];
    const attackerResults = new Map();

    for (const attacker of attackers) {
      const s = start.get(attacker.id);
      const action = attacker.action;
      const arcLength = steps(s.position, action.target, action.dir, this.S);
      attacker.attackArcLength = arcLength;

      this.logPublic({ type: 'gunshot' });
      for (const other of this.players) {
        if (other.id === attacker.id || !other.alive) continue;
        this.private(other.id, {
          type: 'clue',
          kind: 'half',
          half: halfPlane(other.position, s.position, this.S),
          from: other.position,
        });
      }

      const occupant = this.players.find(
        (p) => p.alive && p.position === action.target,
      );
      if (!occupant) {
        attackerResults.set(attacker.id, 'empty');
        continue;
      }

      const occStart = start.get(occupant.id);
      const occAction = occupant.action;
      let damage = true;

      if (occAction.type === 'hide') {
        // 藏只有在柱上才隐身；原上藏是无效果空挂，不挡枪。
        if (occStart.terrain === 'pillar') damage = false;
      } else if (occAction.type === 'observe' || occAction.type === 'attack') {
        const occArc = exposureArc(
          this,
          { position: occStart.position, alive: true },
          occAction,
        );
        if (!occArc.includes(s.position)) damage = false;
      } else if (occAction.type === 'slip') {
        damage = true;
      }

      if (damage) {
        hits.push({
          attackerId: attacker.id,
          targetId: occupant.id,
          targetSegment: action.target,
        });
        attackerResults.set(attacker.id, 'hit');
      } else {
        attackerResults.set(attacker.id, 'avoided');
      }
    }

    // 互射：双方都在柱上，且互相攻击对方位置；弧长者免伤
    for (const a of attackers) {
      for (const b of attackers) {
        if (a.id >= b.id) continue;
        const aStart = start.get(a.id);
        const bStart = start.get(b.id);
        if (aStart.terrain !== 'pillar' || bStart.terrain !== 'pillar') continue;
        if (a.action.target !== bStart.position) continue;
        if (b.action.target !== aStart.position) continue;

        const aHitOnB = hits.find(
          (h) => h.attackerId === a.id && h.targetId === b.id,
        );
        const bHitOnA = hits.find(
          (h) => h.attackerId === b.id && h.targetId === a.id,
        );
        if (!aHitOnB || !bHitOnA) continue;

        if (a.attackArcLength > b.attackArcLength) {
          const idx = hits.indexOf(bHitOnA);
          if (idx >= 0) hits.splice(idx, 1);
          attackerResults.set(b.id, 'parried');
        } else if (b.attackArcLength > a.attackArcLength) {
          const idx = hits.indexOf(aHitOnB);
          if (idx >= 0) hits.splice(idx, 1);
          attackerResults.set(a.id, 'parried');
        }
      }
    }

    // 仅供上帝视角回放保存；玩家/AI 的 view/privateLog 不包含开火结果。
    this.roundAttacks = attackers.map((attacker) => ({
      attackerId: attacker.id,
      name: attacker.name,
      target: attacker.action.target,
      arcLength: attacker.attackArcLength,
      result: attackerResults.get(attacker.id) ?? 'empty',
    }));

    for (const attacker of attackers) {
      this.private(attacker.id, {
        type: 'attack',
        target: attacker.action.target,
        arcLength: attacker.attackArcLength,
      });
    }

    const damaged = new Set();
    for (const hit of hits) {
      const target = this.players.find((p) => p.id === hit.targetId);
      if (!target || !target.alive) continue;
      kill(target, 'attack');
      if (!damaged.has(target.id)) {
        damaged.add(target.id);
        this.private(target.id, { type: 'damage' });
      }
    }

    // 5. 死亡结算
    for (const [playerId, cause] of this.deathsThisRound) {
      const p = this.players.find((q) => q.id === playerId);
      if (!p) continue;
      this.private(p.id, { type: 'death', cause });
      this.logPublic({
        type: 'death',
        playerId: p.id,
        name: p.name,
        cause,
      });
    }

    const replayActions = this.players
      .filter((p) => p.action)
      .map((p) => ({ id: p.id, name: p.name, action: { ...p.action } }));

    this.players.forEach((p) => {
      p.action = null;
    });

    const over = this.checkOver();
    if (!over) this.phase = 'resolved';
    this.finishReplayRound(replayActions);

    return {
      ok: true,
      over,
      winnerId: this.winnerId,
    };
  }

  checkOver() {
    const alive = this.players.filter((p) => p.alive);
    if (alive.length <= 1) {
      this.phase = 'over';
      this.winnerId = alive.length === 1 ? alive[0].id : null;
      this.logPublic({
        type: 'gameOver',
        winnerId: this.winnerId,
      });
      return true;
    }
    return false;
  }

  advance() {
    if (this.phase !== 'resolved') return { error: '当前不能进入下一回合' };
    this.round += 1;
    this.startRound();
    return { ok: true, over: this.phase === 'over', winnerId: this.winnerId };
  }

  logPublic(event) {
    const e = { ...event, round: this.round };
    this.publicLog.push(e);
    this.roundPublic.push(e);
    if (this.publicLog.length > 2000) this.publicLog.shift();
  }

  private(playerId, event) {
    const e = { ...event, round: this.round };
    const list = this.privateEvents.get(playerId);
    if (list) {
      list.push(e);
      if (list.length > 400) list.shift();
    }
    const roundList = this.roundPrivate.get(playerId);
    if (roundList) roundList.push(e);
  }

  getView(playerId) {
    const you = this.players.find((p) => p.id === playerId);
    if (!you) throw new Error('玩家不存在');
    const spectator = !you.alive && this.phase !== 'lobby';

    const segments = this.terrains.map((terrain, i) => ({
      index: i,
      terrain,
      bomb: this.bomb.targets.includes(i),
    }));

    return {
      type: 'state',
      round: this.round,
      phase: this.phase,
      n: this.n,
      S: this.S,
      P: this.P,
      seed: this.seed,
      segments,
      spectator,
      corpses: spectator
        ? this.snapshotCorpses()
        : (() => {
            const known = this.refreshCorpseKnowledge(you);
            return known ? [known] : [];
          })(),
      bomb: {
        target: this.bomb.target,
        targets: this.bomb.targets,
        targetRound: this.bomb.targetRound,
        mode: this.bomb.mode,
      },
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        alive: p.alive,
        ...(spectator
          ? {
              position: p.position,
              terrain: this.terrains[p.position],
              aiModel: p.aiModel ?? null,
            }
          : {}),
      })),
      you: {
        id: you.id,
        name: you.name,
        isAI: you.isAI,
        alive: you.alive,
        position: you.position,
        terrain: this.terrains[you.position],
      },
      legal:
        this.phase === 'selecting' && you.alive
          ? buildLegalActions(this, you)
          : null,
      observations: this.observations.get(you.id) ?? [],
      log: this.publicLog.slice(-120),
      privateLog: (this.privateEvents.get(you.id) ?? []).slice(-120),
      lastResult:
        this.phase === 'resolved' || this.phase === 'over'
          ? {
              round: this.round,
              public: this.roundPublic,
              private: this.roundPrivate.get(you.id) ?? [],
              allPrivate: spectator
                ? Object.fromEntries(
                    [...this.roundPrivate.entries()].map(([id, events]) => [
                      id,
                      events,
                    ]),
                  )
                : undefined,
            }
          : null,
      winnerId: this.winnerId,
    };
  }
}
