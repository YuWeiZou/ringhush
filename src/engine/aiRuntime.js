import { buildLegalActions } from './actions.js';
import { lockAttack } from '../../ai/lib/common.js';
import { makeRng } from './rng.js';
import { mod, steps, attackArc, observeSegments, halfPlane } from '../../shared/ring.js';

/**
 * AI 运行时：只把“这个 AI 自己看得到的信息”交给模型。
 * 不传 game，也不传其他玩家的 position。
 */
export class AIRuntime {
  constructor(models = [], { onDecision = null } = {}) {
    this.allModels = models;
    this.models = new Map(
      models
        .filter((m) => m.usable !== false && typeof m.chooseAction === 'function')
        .map((m) => [m.id, m]),
    );
    this.defaultModelId =
      models.find((m) => m.usable !== false && m.default)?.id ??
      [...this.models.keys()][0] ??
      null;
    this.onDecision = typeof onDecision === 'function' ? onDecision : null;
  }

  get size() {
    return this.models.size;
  }

  hasModel(id) {
    return Boolean(id && this.models.has(id));
  }

  listModels() {
    return this.allModels.map((m) => ({
      id: m.id,
      name: m.name,
      version: m.version,
      generation: m.generation,
      description: m.description,
      default: Boolean(m.default),
      external: Boolean(m.external),
      randomPool: m.randomPool !== false,
      usable: m.usable !== false && typeof m.chooseAction === 'function',
      status: m.status ?? 'ok',
      reason: m.reason ?? null,
      file: m.file ?? null,
      style: m.style ?? null,
    }));
  }

  async chooseAction(game, player) {
    const modelId = player.aiModel ?? this.defaultModelId;
    const model = this.models.get(modelId);
    if (!model) {
      return { error: `AI 模型不存在：${modelId ?? '未选择'}` };
    }
    if (!player.aiMemory || typeof player.aiMemory !== 'object') {
      player.aiMemory = {};
    }
    if (typeof player.aiRandom !== 'function') {
      player.aiRandom = makeRng(`${game.seed}:ai:${player.id}`);
    }

    const ctx = buildAIContext(game, player, modelId);
    const remember = (action) => {
      player.aiMemory.lastAction = action?.type ?? 'unknown';
      player.aiMemory.lastActionRound = game.round;
      if (action?.type === 'attack') player.aiMemory.lastAttackRound = game.round;
      if (action?.type === 'slip') player.aiMemory.lastMoveRound = game.round;
    };
    const locked = lockAttack(ctx);
    if (locked) {
      remember(locked);
      this.onDecision?.(ctx, locked, { modelId, playerId: player.id, seed: game.seed, forced: 'duel-lock' });
      return { action: locked, model: modelId, forced: 'duel-lock' };
    }
    try {
      const action = await model.chooseAction(ctx);
      if (!action || typeof action !== 'object') {
        return { error: `AI 模型 ${modelId} 没有返回行动` };
      }
      remember(action);
      this.onDecision?.(ctx, action, {
        modelId,
        playerId: player.id,
        seed: game.seed,
      });
      return { action, model: modelId };
    } catch (err) {
      console.error(`[ai] ${modelId} 行动失败:`, err);
      return { error: `AI 模型 ${modelId} 行动失败` };
    }
  }
}

export function buildAIContext(game, player, modelId = player.aiModel) {
  const model = modelId ?? player.aiModel ?? null;
  return {
    version: 2,
    model,
    round: game.round,
    S: game.S,
    P: game.P,
    map: game.terrains.map((terrain, index) => ({
      index,
      terrain,
      bomb: game.bomb.targets.includes(index),
      ruins: terrain === 'ruins',
    })),
    me: {
      id: player.id,
      name: player.name,
      position: player.position,
      terrain: game.terrains[player.position],
      alive: player.alive,
    },
    // 公开的存活信息；刻意不包含 position。
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      isAI: p.isAI,
      alive: p.alive,
    })),
    bomb: {
      target: game.bomb.target,
      targets: [...game.bomb.targets],
      targetRound: game.bomb.targetRound,
      mode: game.bomb.mode,
    },
    legal: buildLegalActions(game, player),
    privateLog: (game.privateEvents.get(player.id) ?? []).map((e) => ({ ...e })),
    publicLog: game.publicLog.slice(-120).map((e) => ({ ...e })),
    memory: player.aiMemory ?? {},
    random: player.aiRandom ?? (() => 0.5),
    helpers: { mod, steps, attackArc, observeSegments, halfPlane },
  };
}
