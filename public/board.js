const CX = 300;
const CY = 300;
const R_OUT = 238;
const R_IN = 122;
const R_LABEL = 266;
const R_GLYPH = 148;
const R_CORPSE = 170;
const R_TOKEN = 196;
const R_OBS = 212;
const R_OBS_LABEL = 228;
const R_SOUND = 248;
const R_REPLAY_OBS = 244;
const R_REPLAY_OBS_STEP = 7.5;
const TOKEN_COLORS = ['#e3bd66', '#76c4e8', '#d66b5c', '#9fce7a', '#c79bdd', '#e2a35f', '#6fd0c2', '#d88db2'];

function polar(r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function wedgePath(a0, a1, rIn, rOut) {
  const [x1, y1] = polar(rOut, a0);
  const [x2, y2] = polar(rOut, a1);
  const [x3, y3] = polar(rIn, a1);
  const [x4, y4] = polar(rIn, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function outerArcPath(a0, a1, r) {
  const [x1, y1] = polar(r, a0);
  const [x2, y2] = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function midAngle(index, S) {
  return ((index + 0.5) * 360) / S;
}

function glyphFor(terrain) {
  if (terrain === 'pillar') return '柱';
  if (terrain === 'ruins') return '废';
  return '原';
}

export function renderBoard(container, view, opts = {}) {
  const S = view.S;
  const you = view.you;
  const gap = Math.min(1.6, 40 / S);
  const preview = new Set(opts.previewSegments ?? []);
  const observationMarks = opts.observationMarks ?? [];
  const sound = opts.soundSummary ?? { left: 0, right: 0, from: null, rounds: [] };
  const tokens = opts.tokens ?? null;
  const actionLines = opts.actionLines ?? [];
  const corpses = opts.corpses ?? [];
  const segAngle = 360 / S;
  const halfCount = Math.floor(S / 2);
  const bombRemain = Number.isFinite(Number(view.bomb?.targetRound))
    ? Number(view.bomb.targetRound) - Number(view.round)
    : null;
  const bombHurry = bombRemain == null
    ? ''
    : bombRemain <= 0
      ? 'bomb-now'
      : 'bomb-' + Math.min(5, bombRemain);

  const parts = [];
  parts.push(`<svg viewBox="0 0 600 600" class="board-svg" role="img" aria-label="黑暗森林环形地图">`);
  parts.push(`<defs>
    <radialGradient id="fog" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#0b100d" stop-opacity="0"/>
      <stop offset="70%" stop-color="#070a08" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#040605" stop-opacity="0.26"/>
    </radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="286" fill="url(#fog)"/>`);

  // 地形段
  for (let i = 0; i < S; i++) {
    const a0 = (i * 360) / S + gap / 2;
    const a1 = ((i + 1) * 360) / S - gap / 2;
    const seg = view.segments[i];
    const cls = [
      'seg',
      `terrain-${seg.terrain}`,
      seg.bomb ? 'bomb-target' : '',
      seg.bomb ? bombHurry : '',
      i === you.position ? 'own-seg' : '',    ]
      .filter(Boolean)
      .join(' ');
    const title = `${i + 1} 段 · ${seg.terrain === 'pillar' ? '柱' : seg.terrain === 'ruins' ? '废墟' : '原'}`;
    parts.push(
      `<path class="${cls}" data-seg="${i}" d="${wedgePath(a0, a1, R_IN, R_OUT)}"><title>${title}</title></path>`,
    );
  }

  // 预览弧（观/攻/溜）
  for (const i of preview) {
    if (i < 0 || i >= S) continue;
    const a0 = (i * 360) / S + gap / 2;
    const a1 = ((i + 1) * 360) / S - gap / 2;
    parts.push(
      `<path class="seg-overlay preview" pointer-events="none" d="${wedgePath(a0, a1, R_IN, R_OUT)}"/>`,
    );
  }

  // 历史观测：段内红色标记 + 回合标签（放在预览之后，避免被预览盖住）
  for (const mark of observationMarks) {
    const i = mark.segment;
    if (!Number.isInteger(i) || i < 0 || i >= S) continue;
    const a0 = (i * 360) / S + gap / 2;
    const a1 = ((i + 1) * 360) / S - gap / 2;
    const mid = midAngle(i, S);
    const [x, y] = polar(R_OBS, mid);
    const [lx, ly] = polar(R_OBS_LABEL, mid);
    parts.push(
      `<path class="seg-overlay observed" pointer-events="none" d="${wedgePath(a0, a1, R_IN, R_OUT)}"/>`,
    );
    parts.push(
      `<circle class="obs-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" pointer-events="none"/>`,
    );
    parts.push(
      `<text class="obs-label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none">R${mark.round}</text>`,
    );
  }

  // 段号 + 地形字
  for (let i = 0; i < S; i++) {
    const mid = midAngle(i, S);
    const [nx, ny] = polar(R_LABEL, mid);
    const [gx, gy] = polar(R_GLYPH, mid);
    parts.push(
      `<text class="seg-label" x="${nx.toFixed(1)}" y="${ny.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none">${i + 1}</text>`,
    );
    parts.push(
      `<text class="terrain-glyph" x="${gx.toFixed(1)}" y="${gy.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none">${glyphFor(view.segments[i].terrain)}</text>`,
    );
  }

  // 轰炸点
  for (let i = 0; i < S; i++) {
    if (!view.segments[i].bomb) continue;
    const mid = midAngle(i, S);
    const [bx, by] = polar(281, mid);
    parts.push(
      `<text class="bomb-label" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" pointer-events="none">炸</text>`,
    );
  }

  // 枪声层：只画左右两侧的外圈光弧；不显示精确点，次数在中心/情报面板
  if (sound.from != null && (sound.left > 0 || sound.right > 0)) {
    const from = sound.from;
    const roundText = sound.rounds.length ? `R${sound.rounds.join('/')}` : '';
    const drawSide = (side, count) => {
      const start = side === 'left' ? (from + 1) * segAngle : (from - halfCount) * segAngle;
      const end = side === 'left' ? (from + 1 + halfCount) * segAngle : from * segAngle;
      const width = 4 + Math.min(4, count);
      parts.push(
        `<path class="sound-arc" pointer-events="none" stroke-width="${width}" d="${outerArcPath(start, end, R_SOUND)}" filter="url(#glow)"><title>${side === 'left' ? '左' : '右'}侧 ${count} 次${roundText ? `（${roundText}）` : ''}</title></path>`,
      );
    };
    if (sound.left > 0) drawSide('left', sound.left);
    if (sound.right > 0) drawSide('right', sound.right);
  }

  // 回放：观测弧画在最外圈；重叠时按 layer 使用不同半径。
  for (const arc of opts.observationArcs ?? []) {
    if (!arc || arc.color == null) continue;
    const r = R_REPLAY_OBS + Math.max(0, Number(arc.layer) || 0) * R_REPLAY_OBS_STEP;
    const title = arc.name ? `${arc.name} 本回合观测` : '本回合观测';
    if (arc.full) {
      parts.push(
        `<circle class="replay-observation-arc" pointer-events="none" cx="${CX}" cy="${CY}" r="${r}" fill="none" stroke="${arc.color}" stroke-width="5" opacity="0.92" stroke-linecap="round"><title>${title}</title></circle>`,
      );
    } else {
      parts.push(
        `<path class="replay-observation-arc" pointer-events="none" d="${outerArcPath(arc.a0, arc.a1, r)}" fill="none" stroke="${arc.color}" stroke-width="5" opacity="0.92" stroke-linecap="round"><title>${title}</title></path>`,
      );
    }
  }

  // 回放：所有玩家的行动连线（移动/攻击）
  for (const line of actionLines) {
    if (line.from == null || line.to == null || line.from < 0) continue;
    const from = polar(R_TOKEN, midAngle(line.from, S));
    const to = polar(R_TOKEN, midAngle(line.to, S));
    const color = line.color ?? '#e3bd66';
    const dash = line.kind === 'slip' ? 'stroke-dasharray="5 5"' : '';
    parts.push(
      `<line class="replay-action-line" x1="${from[0].toFixed(1)}" y1="${from[1].toFixed(1)}" x2="${to[0].toFixed(1)}" y2="${to[1].toFixed(1)}" stroke="${color}" ${dash} pointer-events="none"/>`,
    );
    parts.push(
      `<circle class="replay-action-target" cx="${to[0].toFixed(1)}" cy="${to[1].toFixed(1)}" r="9" stroke="${color}" pointer-events="none"/>`,
    );
  }

  // 攻击预览线
  if (opts.attackTarget != null) {
    const from = polar(R_TOKEN, midAngle(you.position, S));
    const to = polar(R_TOKEN, midAngle(opts.attackTarget, S));
    parts.push(
      `<line class="attack-line" x1="${from[0].toFixed(1)}" y1="${from[1].toFixed(1)}" x2="${to[0].toFixed(1)}" y2="${to[1].toFixed(1)}" pointer-events="none"/>`,
    );
    parts.push(
      `<circle class="attack-target" cx="${to[0].toFixed(1)}" cy="${to[1].toFixed(1)}" r="11" pointer-events="none"/>`,
    );
  }

  for (const corpse of corpses) {
    if (corpse.segment == null) continue;
    const [x, y] = polar(R_CORPSE, midAngle(corpse.segment, S));
    const roundLabel =
      corpse.firstRound === corpse.lastRound
        ? `R${corpse.firstRound}`
        : `R${corpse.firstRound}/${corpse.lastRound}`;
    const detail = (corpse.deaths ?? [])
      .map((d) => `R${d.round} ${d.name}（${d.cause}）`)
      .join('；');
    parts.push(
      `<g class="corpse-marker" pointer-events="none">
        <title>${detail}</title>
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="15"/>
        <text class="corpse-count" x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">☠${corpse.count}</text>
        <text class="corpse-round" x="${x.toFixed(1)}" y="${(y + 7).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${roundLabel}</text>
      </g>`,
    );
  }

  if (tokens) {
    // 回放：上帝视角，所有玩家 token
    tokens.forEach((token, index) => {
      if (token.position == null || token.position < 0) return;
      const [x, y] = polar(R_TOKEN, midAngle(token.position, S));
      const color = token.color ?? TOKEN_COLORS[index % TOKEN_COLORS.length];
      const label = String(token.name ?? '').slice(0, 4) || String(index + 1);
      const hiding = Boolean(token.hiding);
      parts.push(
        `<g class="replay-token ${token.alive ? '' : 'dead'} ${hiding ? 'hiding' : ''}" pointer-events="none">
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${color}" stroke="${hiding ? '#ffffff' : '#0a0f0c'}" stroke-width="${hiding ? '3' : '2'}"/>
          <text x="${x.toFixed(1)}" y="${(y + 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">${label}</text>
        </g>`,
      );
    });
  } else {
    // 对局中：只画自己
    const [tx, ty] = polar(R_TOKEN, midAngle(you.position, S));
    parts.push(
      `<g class="own-token" pointer-events="none"><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="15"/><text x="${tx.toFixed(1)}" y="${(ty + 0.5).toFixed(1)}" text-anchor="middle" dominant-baseline="middle">你</text></g>`,
    );
  }

  parts.push(`</svg>`);
  container.innerHTML = parts.join('');

  const board = container.querySelector('.board-svg');
  board?.addEventListener('click', (event) => {
    const el = event.target.closest?.('[data-seg]');
    if (!el) return;
    opts.onSegmentClick?.(Number(el.dataset.seg));
  });
}
