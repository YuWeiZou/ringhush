/**
 * 没有存活人类时，用 AI 行动把对局跑完，得到一个正常结束。
 * 占位 AI 只会藏/观，不攻击；真正的死亡来自轰炸。
 */
export async function autoResolveAIOnly(game, { maxRounds = 600 } = {}) {
  let guard = 0;
  while (guard++ < maxRounds) {
    if (game.phase === 'over') break;

    if (game.phase === 'resolved') {
      const result = game.advance();
      if (result.error) break;
      continue;
    }

    if (game.phase === 'selecting') {
      const aliveHumans = game.players.filter((p) => p.alive && !p.isAI);
      if (aliveHumans.length > 0) break;
      const result = await game.resolve();
      if (result.error) break;
      continue;
    }

    break;
  }

  if (game.phase !== 'over') {
    game.phase = 'over';
    game.winnerId = null;
    game.logPublic({ type: 'gameOver', winnerId: null });
  }

  return {
    over: game.phase === 'over',
    winnerId: game.winnerId,
    rounds: guard,
  };
}
