import {
  CW,
  CCW,
  mod,
  observeSegments,
  attackArc,
  steps,
} from '../../shared/ring.js';

export const DIRECTIONS = [CW, CCW];

export function maxObserveLength(S, terrain) {
  return terrain === 'plain' ? S : Math.max(1, Math.floor(S / 2));
}

export function terrainAt(game, index) {
  return game.terrains[index];
}

export function isRuins(game, index) {
  return game.terrains[index] === 'ruins';
}

/**
 * 返回客户端可用的行动范围；不包含任何其他玩家位置。
 */
export function buildLegalActions(game, player) {
  const pos = player.position;
  const terrain = game.terrains[pos];
  const S = game.S;
  const moves = [];

  for (const dir of DIRECTIONS) {
    const first = mod(pos + dir, S);
    const firstTerrain = game.terrains[first];

    if (firstTerrain !== 'ruins') {
      moves.push({
        dir,
        distance: 1,
        destination: first,
        cross: false,
        label: `${dir === CW ? '顺时针' : '逆时针'} 1 段 → ${first + 1} 段`,
      });
    }

    if (terrain === 'plain') {
      const second = mod(pos + dir * 2, S);
      const secondTerrain = game.terrains[second];
      if (firstTerrain === 'plain' && secondTerrain !== 'ruins') {
        moves.push({
          dir,
          distance: 2,
          destination: second,
          cross: false,
          label: `${dir === CW ? '顺时针' : '逆时针'} 2 段 → ${second + 1} 段`,
        });
      } else if (firstTerrain === 'ruins' && secondTerrain !== 'ruins') {
        moves.push({
          dir,
          distance: 2,
          destination: second,
          cross: true,
          label: `${dir === CW ? '顺时针' : '逆时针'} 穿越废墟 → ${second + 1} 段`,
        });
      }
    }
  }

  return {
    terrain,
    canHide: terrain !== 'ruins',
    canHideEffective: terrain === 'pillar',
    canObserve: true,
    canAttack: true,
    canSlip: moves.length > 0,
    moves,
    observe: {
      full: terrain === 'plain',
      max: maxObserveLength(S, terrain),
    },
  };
}

export function validateAction(game, player, raw) {
  if (!player) return { error: '玩家不存在' };
  if (!player.alive) return { error: '你已经死亡' };
  if (game.phase !== 'selecting') return { error: '当前不是行动阶段' };
  if (!raw || typeof raw !== 'object') return { error: '行动格式错误' };

  const terrain = game.terrains[player.position];
  if (terrain === 'ruins') return { error: '废墟区不能行动' };

  if (raw.type === 'hide') {
    return { action: { type: 'hide' } };
  }

  if (raw.type === 'observe') {
    const dir = raw.dir === -1 ? -1 : 1;
    let length = Number.isFinite(Number(raw.length)) ? Math.floor(Number(raw.length)) : 1;
    if (terrain === 'plain') {
      // 原上观看到所有段；方向无关紧要，统一按顺时针整圈表示。
      return { action: { type: 'observe', dir: 1, length: game.S, full: true } };
    }
    length = Math.max(1, Math.min(maxObserveLength(game.S, terrain), length));
    return { action: { type: 'observe', dir, length } };
  }

  if (raw.type === 'attack') {
    const target = Number(raw.target);
    if (!Number.isInteger(target) || target < 0 || target >= game.S) {
      return { error: '目标段不合法' };
    }
    if (target === player.position) return { error: '不能攻击自己所在的段' };
    const dir = raw.dir === -1 ? -1 : 1;
    return { action: { type: 'attack', target, dir } };
  }

  if (raw.type === 'slip') {
    const dir = raw.dir === -1 ? -1 : 1;
    const distance = Number(raw.distance) === 2 ? 2 : 1;
    const legal = buildLegalActions(game, player);
    const move = legal.moves.find((m) => m.dir === dir && m.distance === distance);
    if (!move) return { error: '这个移动不合法' };
    return {
      action: {
        type: 'slip',
        dir,
        distance,
        destination: move.destination,
        cross: Boolean(move.cross),
      },
    };
  }

  return { error: '未知行动' };
}

/** 观测/攻击产生的“暴露弧”，用于攻击伤害判定和溜的“看到来路”判定。 */
export function exposureArc(game, player, action) {
  if (!action) return [];
  if (action.type === 'observe') {
    return observeSegments(player.position, action.dir, action.length, game.S);
  }
  if (action.type === 'attack') {
    const terrain = game.terrains[player.position];
    if (terrain === 'plain') return [...Array(game.S).keys()];
    return attackArc(player.position, action.target, action.dir, game.S);
  }
  return [];
}

export function attackArcLength(game, player, action) {
  // 攻击弧始终按指定方向计算；原上只是“暴露”为全圈，不是攻击弧变成全圈。
  return steps(player.position, action.target, action.dir, game.S);
}

export function isHiding(game, player, action) {
  return Boolean(
    player &&
      player.alive &&
      action &&
      action.type === 'hide' &&
      game.terrains[player.position] === 'pillar',
  );
}
