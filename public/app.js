import { renderBoard } from '/board.js';
import { observeSegments, attackArc, steps } from '/shared/ring.js';
import { saveReplay, listReplays, getReplay, deleteReplay } from '/history.js';
import { BgmPlayer, MUSIC_PACKS } from '/audio-player.js';
import { BridgeClient } from '/bridge-client.js';
import { AmbientLight } from '/ambient-light.js';

/*
 * 分区索引：改哪块就搜哪个标记，不要从头读到尾。
 *   ---------- 设置：Bridge ----------
 *   ---------- 设置：显示 / 音频 ----------
 *   ---------- 设置：Bridge 面板 ----------
 *   ---------- 设置页 ----------
 *   ---------- 连接 / 状态 ----------
 *   ---------- menu ----------
 *   ---------- lobby ----------
 *   ---------- history / replay ----------
 *   ---------- BGM / 对局渲染 ----------
 *   ---------- action panel ----------
 *   ---------- intel / log ----------
 *   ---------- result / gameover ----------
 *   ---------- overlays / toast ----------
 *   ---------- wire ----------
 * 完整路由见 docs/维护指南.md §3/§4。
 */

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = {
  screen: 'menu',
  view: null,
  lobby: null,
  playerCount: 4,
  connected: false,
  busy: false,
  draft: null,
  roundFilter: 'all',
  resultDismissed: false,
  continueReady: false,
  serverOffset: 0,
  replay: null,
  replayIndex: 0,
  replayPhase: 'start',
  replayReturn: 'history',
  autoStarted: false,
  lobbyAutoStarted: false,
  aiProposal: null,
  bridge: { token: '', room: '', player: '', activeSeat: null, view: null, sentRound: null, resultSent: null },
};

const params = new URLSearchParams(location.search);
const autoStart = params.get('auto') === '1';
if (autoStart) {
  const n = Number(params.get('players'));
  if (Number.isInteger(n) && n >= 2 && n <= 8) state.playerCount = n;
}

const SETTINGS_KEY = 'df-display-settings-v1';
const DEFAULT_DISPLAY_SETTINGS = {
  font: 1,
  contrast: false,
  largeLabels: false,
  reduceMotion: false,
  ambient: 25,
  glass: 35,
  diffusion: 50,
  ripple: 50,
  rippleDecay: 0.009,
  rippleIncident: 50,
  rippleReflect: 50,
  range: 60,
  quality: 50,
  hideCursor: false,
  tintThreshold: 50,
};
let displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };

const AUDIO_KEY = 'df-audio-settings-v1';
const DEFAULT_AUDIO_SETTINGS = { volume: 0.35, pack: 'new' };
let audioSettings = { ...DEFAULT_AUDIO_SETTINGS };
const bgm = new BgmPlayer();
const ambient = new AmbientLight();
if (params.get('debug') === '1') window.__DF_AMBIENT__ = ambient;
if (params.get('debug') === '1') window.__DF_BGM__ = bgm;

/* ---------- 设置：Bridge ---------- */
const BRIDGE_KEY = 'df-bridge-settings-v1';
const DEFAULT_BRIDGE_SETTINGS = { enabled: false, mode: 'manual' };
let bridgeSettings = { ...DEFAULT_BRIDGE_SETTINGS };
const bridge = new BridgeClient({
  onStatus: () => { renderBridgePanel(); if (bridge.status === 'connected') syncBridgeView(); },
  onAction: handleBridgeAction,
  onReady: () => { showToast('外部 AI 已连接，本回合可以行动'); renderBridgePanel(); },
  onManual: () => { showToast('外部 AI 未应答，本回合回退手动'); renderBridgePanel(); },
});

/* ---------- 设置：显示 / 音频 ---------- */
function loadDisplaySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    displaySettings = {
      ...DEFAULT_DISPLAY_SETTINGS,
      ...saved,
      font: [1, 1.15, 1.3, 1.45].includes(Number(saved.font)) ? Number(saved.font) : 1,
      contrast: Boolean(saved.contrast),
      largeLabels: Boolean(saved.largeLabels),
      reduceMotion: Boolean(saved.reduceMotion),
      glass: Number.isFinite(Number(saved.glass))
        ? Math.max(0, Math.min(100, Number(saved.glass)))
        : 35,
      diffusion: Number.isFinite(Number(saved.diffusion))
        ? Math.max(0, Math.min(100, Number(saved.diffusion)))
        : 50,
      ripple: Number.isFinite(Number(saved.ripple))
        ? Math.max(0, Math.min(100, Number(saved.ripple)))
        : 50,
      rippleDecay: Number.isFinite(Number(saved.rippleDecay))
        ? Math.max(0.009, Math.min(0.1, Number(saved.rippleDecay)))
        : 0.009,
      rippleIncident: Number.isFinite(Number(saved.rippleIncident))
        ? Math.max(0, Math.min(100, Number(saved.rippleIncident)))
        : 50,
      rippleReflect: Number.isFinite(Number(saved.rippleReflect))
        ? Math.max(0, Math.min(100, Number(saved.rippleReflect)))
        : 50,
      range: Number.isFinite(Number(saved.range))
        ? Math.max(0, Math.min(100, Number(saved.range)))
        : 60,
      quality: Number.isFinite(Number(saved.quality))
        ? Math.max(0, Math.min(100, Number(saved.quality)))
        : 50,
      hideCursor: Boolean(saved.hideCursor),
      tintThreshold: Number.isFinite(Number(saved.tintThreshold))
        ? Math.max(0, Math.min(100, Number(saved.tintThreshold)))
        : 50,
      ambient: saved.ambient === true
        ? 25
        : Number.isFinite(Number(saved.ambient))
          ? Math.max(0, Math.min(100, Number(saved.ambient)))
          : saved.ambient === false ? 0 : 25,
    };
  } catch {
    displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
  }
  applyDisplaySettings();
}

function renderTintPreview(value) {
  const el = $('setting-tint-threshold-value');
  if (!el) return;
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  const l = Math.round((n / 100) * 255);
  el.style.background = 'rgb(' + l + ',' + l + ',' + l + ')';
  el.innerHTML = '<span class="tint-preview-black">黑</span><span class="tint-preview-white">白</span>';
  el.title = '文字反色阈值 ' + Math.round(n) + '%';
  el.setAttribute('aria-label', '文字反色阈值预览 ' + Math.round(n) + '%');
}

let lightPreviewFrame = 0;

function renderLightPreview() {
  if (lightPreviewFrame) return;
  lightPreviewFrame = requestAnimationFrame(() => {
    lightPreviewFrame = 0;
    drawLightPreview();
  });
}

function drawLightPreview() {
  const canvas = $('light-preview-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width;
  const H = canvas.height;
  const image = ctx.createImageData(W, H);
  const data = image.data;
  const peak = Math.max(0, Math.min(1, Number(displaySettings.ambient) / 100));
  const range = Math.max(0, Math.min(1, Number(displaySettings.range) / 100));
  const t = Math.max(0, Math.min(1, (Number(displaySettings.rippleDecay) - 0.009) / 0.091));
  const k = 2.0 + t * 3.0;
  const radius = Math.max(16, Math.min(W, H) * 0.5 * (0.18 + 0.72 * range));
  const cx = W / 2;
  const cy = H / 2;
  const bg = [7, 10, 8];
  const green = [49, 73, 54];
  const white = [255, 251, 242];
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy) / radius;
      const fall = 1 / (1 + Math.pow(k * d, 2));
      const raw = peak * fall;
      const wm = Math.max(0, Math.min(1, (raw - 0.06) / 0.22));
      const idx = (y * W + x) * 4;
      const alpha = Math.min(1, raw * 1.55);
      data[idx] = Math.round(bg[0] + (green[0] * (1 - wm) + white[0] * wm - bg[0]) * alpha);
      data[idx + 1] = Math.round(bg[1] + (green[1] * (1 - wm) + white[1] * wm - bg[1]) * alpha);
      data[idx + 2] = Math.round(bg[2] + (green[2] * (1 - wm) + white[2] * wm - bg[2]) * alpha);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const g = Math.max(0, Math.min(1, Number(displaySettings.glass) / 100));
  for (let i = 0; i < 3; i += 1) {
    const size = Math.min(W, H) * (0.86 - i * 0.18);
    const left = cx - size / 2;
    const top = cy - size / 2;
    ctx.fillStyle = 'rgba(11, 13, 12, ' + (0.10 + g * 0.08) + ')';
    ctx.fillRect(left, top, size, size);
    ctx.strokeStyle = 'rgba(190, 214, 190, ' + (0.10 - i * 0.02) + ')';
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
  }
}

function resetLightPreviewPosition() {
  const el = $('light-preview');
  if (!el) return;
  el.style.left = '24px';
  el.style.top = '24px';
  el.style.right = 'auto';
}

function updateLightPreviewVisibility() {
  const el = $('light-preview');
  if (!el) return;
  const overlay = $('settings-overlay');
  const visible = settingsPage === 'light' && overlay && !overlay.classList.contains('hidden');
  el.classList.toggle('hidden', !visible);
  if (visible) renderLightPreview();
}

function applyDisplaySettings() {
  document.documentElement.style.setProperty('--ui-zoom', String(displaySettings.font));
  document.body.classList.toggle('high-contrast', displaySettings.contrast);
  document.body.classList.toggle('large-board-labels', displaySettings.largeLabels);
  document.body.classList.toggle('reduce-motion', displaySettings.reduceMotion);
  document.body.classList.toggle('ui-zoomed', Math.abs(displaySettings.font - 1) > 0.001);
  const fontSelect = $('setting-font');
  const contrast = $('setting-contrast');
  const labels = $('setting-labels');
  const motion = $('setting-motion');
  const ambientToggle = $('setting-ambient');
  const ambientValue = $('setting-ambient-value');
  const glass = $('setting-glass');
  const glassValue = $('setting-glass-value');
  const diffusion = $('setting-diffusion');
  const diffusionValue = $('setting-diffusion-value');
  const ripple = $('setting-ripple');
  const rippleValue = $('setting-ripple-value');
  const rippleDecay = $('setting-ripple-decay');
  const rippleDecayValue = $('setting-ripple-decay-value');
  const rippleIncident = $('setting-ripple-incident');
  const rippleIncidentValue = $('setting-ripple-incident-value');
  const rippleReflect = $('setting-ripple-reflect');
  const rippleReflectValue = $('setting-ripple-reflect-value');
  const range = $('setting-range');
  const rangeValue = $('setting-range-value');
  const quality = $('setting-quality');
  const qualityValue = $('setting-quality-value');
  const tintThreshold = $('setting-tint-threshold');
  const tintThresholdValue = $('setting-tint-threshold-value');
  if (fontSelect) fontSelect.value = String(displaySettings.font);
  if (contrast) contrast.checked = displaySettings.contrast;
  if (labels) labels.checked = displaySettings.largeLabels;
  if (motion) motion.checked = displaySettings.reduceMotion;
  if (ambientToggle) ambientToggle.value = String(displaySettings.ambient);
  if (ambientValue) ambientValue.textContent = Math.round(displaySettings.ambient) + '%';
  const g = Math.max(0, Math.min(100, Number(displaySettings.glass))) / 100;
  document.documentElement.style.setProperty('--glass-tint', (0.30 * (1 - g)).toFixed(3));
  ambient.setGlass(displaySettings.glass);
  if (glass) glass.value = String(displaySettings.glass);
  if (glassValue) glassValue.textContent = Math.round(displaySettings.glass) + '%';
  const diff = Math.max(0, Math.min(100, Number(displaySettings.diffusion))) / 100;
  document.documentElement.style.setProperty('--ambient-blur', (36 * diff).toFixed(1) + 'px');
  if (diffusion) diffusion.value = String(displaySettings.diffusion);
  if (diffusionValue) diffusionValue.textContent = Math.round(displaySettings.diffusion) + '%';
  ambient.setRippleStrength(displaySettings.ripple);
  if (ripple) ripple.value = String(displaySettings.ripple);
  if (rippleValue) rippleValue.textContent = Math.round(displaySettings.ripple) + '%';
  ambient.setRippleDecay(displaySettings.rippleDecay);
  if (rippleDecay) rippleDecay.value = String(displaySettings.rippleDecay);
  if (rippleDecayValue) rippleDecayValue.textContent = Number(displaySettings.rippleDecay).toFixed(3);
  ambient.setRippleIncident(displaySettings.rippleIncident);
  ambient.setRippleReflect(displaySettings.rippleReflect);
  if (rippleIncident) rippleIncident.value = String(displaySettings.rippleIncident);
  if (rippleIncidentValue) rippleIncidentValue.textContent = Math.round(displaySettings.rippleIncident) + '%';
  if (rippleReflect) rippleReflect.value = String(displaySettings.rippleReflect);
  if (rippleReflectValue) rippleReflectValue.textContent = Math.round(displaySettings.rippleReflect) + '%';
  if (range) range.value = String(displaySettings.range);
  if (rangeValue) rangeValue.textContent = Math.round(displaySettings.range) + '%';
  if (quality) quality.value = String(displaySettings.quality);
  if (qualityValue) qualityValue.textContent = displaySettings.quality >= 90 ? '极高' : displaySettings.quality >= 70 ? '高' : displaySettings.quality >= 20 ? '中' : '低';
  ambient.setRange(displaySettings.range);
  ambient.setQuality(displaySettings.quality);
  ambient.setTintThreshold(displaySettings.tintThreshold);
  if (tintThreshold) tintThreshold.value = String(displaySettings.tintThreshold);
  renderTintPreview(displaySettings.tintThreshold);
  const hideCursor = $('setting-hide-cursor');
  const forceShow = displaySettings.ambient <= 0;
  if (hideCursor) {
    hideCursor.checked = Boolean(displaySettings.hideCursor);
    hideCursor.disabled = forceShow;
  }
  document.body.classList.toggle('hide-cursor', Boolean(displaySettings.hideCursor) && !forceShow);
  ambient.setLevel(displaySettings.ambient);
  renderLightPreview();
}

function saveDisplaySettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(displaySettings));
  } catch {
    // 浏览器拒绝本地存储时，设置只在本次页面生效。
  }
  applyDisplaySettings();
}

function loadAudioSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}');
    const v = Number(saved.volume);
    audioSettings.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : DEFAULT_AUDIO_SETTINGS.volume;
    audioSettings.pack = saved.pack === 'original' ? 'original' : 'new';
  } catch {
    audioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  }
  applyAudioSettings();
}

let musicPackPromise = null;
function loadMusicPackOptions() {
  const select = $('setting-music-pack');
  if (!select) return;
  if (!musicPackPromise) {
    musicPackPromise = (async () => {
      const available = [];
      for (const [id, pack] of Object.entries(MUSIC_PACKS)) {
        try {
          const res = await fetch(pack.tracks.menu, { method: 'HEAD' });
          if (res.ok) available.push({ id, pack });
        } catch {
          // Missing albums are simply not offered.
        }
      }
      if (!available.length) return [];
      return available;
    })();
  }
  musicPackPromise.then((available) => {
    if (!select.isConnected) return;
    if (!available.length) {
      const label = select.closest('label');
      if (label) label.classList.add('hidden');
      const volume = $('setting-volume')?.closest('label');
      if (volume) volume.classList.add('hidden');
      return;
    }
    select.innerHTML = available
      .map(({ id, pack }) => `<option value="${id}">${pack.name}</option>`)
      .join('');
    const ids = available.map((a) => a.id);
    if (!ids.includes(audioSettings.pack)) audioSettings.pack = ids[0];
    select.value = audioSettings.pack;
    bgm.setPack(audioSettings.pack);
  });
}

function applyAudioSettings() {
  const v = Math.round(audioSettings.volume * 100);
  const input = $('setting-volume');
  const output = $('setting-volume-value');
  if (input) input.value = String(v);
  if (output) output.textContent = v + '%';
  bgm.setVolume(audioSettings.volume);
  loadMusicPackOptions();
}

function saveAudioSettings() {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(audioSettings));
  } catch {
    // 浏览器拒绝本地存储时，本次页面仍然生效。
  }
  applyAudioSettings();
}

function loadBridgeSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(BRIDGE_KEY) || '{}');
    bridgeSettings.enabled = Boolean(saved.enabled);
    bridgeSettings.mode = saved.mode === 'auto' ? 'auto' : 'manual';
  } catch {
    bridgeSettings = { ...DEFAULT_BRIDGE_SETTINGS };
  }
  applyBridgeSettings();
}

function applyBridgeSettings() {
  const enabled = $('setting-bridge-enabled');
  const mode = $('setting-bridge-mode');
  if (enabled) enabled.checked = bridgeSettings.enabled;
  if (mode) mode.value = bridgeSettings.mode;
  if (!bridgeSettings.enabled) {
    if (state.bridge.activeSeat != null) closeBridge();
    else bridge.stop();
  }
  renderBridgePanel();
}

function saveBridgeSettings() {
  try {
    localStorage.setItem(BRIDGE_KEY, JSON.stringify(bridgeSettings));
  } catch {
    // 只在本页生效
  }
  applyBridgeSettings();
}

/* ---------- 设置：Bridge 面板 ---------- */
function bridgeStatusLabel() {
  if (!bridgeSettings.enabled) return '未启用';
  if (bridge.status === 'connected') {
    const ready = bridge.channels.filter((c) => c.ready).length;
    return ready ? `已连接 · ${ready} 个通道` : '已连接 · 等待 AI';
  }
  if (bridge.status === 'connecting') return '连接中…';
  if (bridge.status === 'disconnected') return '未连接本机 Bridge';
  return '未启用';
}

function renderBridgePanel() {
  const status = $('bridge-status');
  const channels = $('bridge-channels');
  const btn = $('lobby-bridge-open');
  if (status) status.textContent = bridgeStatusLabel();
  if (channels) {
    const ready = bridge.channels.filter((c) => c.ready).length;
    channels.textContent = bridgeSettings.enabled
      ? (bridge.status === 'connected'
          ? `模型口 3211–3218 · 已应答 ${ready} 个`
          : '请点“打开本机 Bridge”，或检查 install-ai-bridge.bat。')
      : '在辅助设置里启用后可连接。';
  }
  if (btn) btn.disabled = !bridgeSettings.enabled;
}

function bridgeSnapshot() {
  const v = state.bridge.view ?? state.view;
  if (!v) return null;
  return {
    schema: 1,
    round: v.round,
    phase: v.phase,
    S: v.S,
    P: v.P,
    segments: v.segments,
    bomb: v.bomb,
    players: v.players,
    you: v.you,
    legal: v.legal,
    corpses: v.corpses,
    observations: v.observations,
    log: v.log,
    privateLog: v.privateLog,
    lastResult: v.lastResult,
    room: {
      turnSeconds: v.room?.turnSeconds,
      deadline: v.room?.deadline,
      resultDeadline: v.room?.resultDeadline,
      resultMinUntil: v.room?.resultMinUntil,
    },
  };
}

function syncBridgeView() {
  if (!bridgeSettings.enabled || bridge.status !== 'connected' || !state.bridge.activeSeat) return;
  const v = state.bridge.view;
  if (!v) return;
  if (v.phase === 'selecting') {
    if (state.bridge.sentRound === v.round) return;
    state.bridge.sentRound = v.round;
    state.bridge.resultSent = null;
    bridge.sendRoundStart(bridgeSnapshot());
  } else if (v.phase === 'resolved') {
    if (state.bridge.resultSent === v.round) return;
    state.bridge.resultSent = v.round;
    state.bridge.sentRound = null;
    bridge.sendResultStart();
  }
}

function handleBridgeAction(msg) {
  const v = state.bridge.view;
  if (!msg?.action || !v || v.phase !== 'selecting' || !state.bridge.activeSeat) return;
  const action = msg.action;
  if (bridgeSettings.mode === 'auto') {
    const ok = send({ type: 'bridgeAction', playerId: state.bridge.activeSeat, action, external: true });
    if (ok) {
      state.aiProposal = { ...action, channel: msg.channel, auto: true };
      showToast(`AI ${msg.channel} 号通道已提交：${replayActionText(action)}`);
    }
  } else {
    state.aiProposal = { ...action, channel: msg.channel, auto: false };
    showToast(`AI ${msg.channel} 号通道提议：${replayActionText(action)}`);
  }
  render();
}

function closeBridge() {
  if (state.bridge.activeSeat == null) return;
  send({ type: 'unsubscribeBridge' });
  bridge.stop();
  state.bridge.activeSeat = null;
  state.bridge.view = null;
  state.bridge.sentRound = null;
  state.bridge.resultSent = null;
  showToast('本机 Bridge 已关闭');
  render();
}

function toggleBridgeSeat(seatId) {
  if (!bridgeSettings.enabled) {
    showToast('请先在辅助设置中启用外部 AI 通道', 'error');
    return;
  }
  const lobby = state.lobby;
  if (!lobby) {
    showToast('需要先进入房间');
    return;
  }
  if (state.bridge.activeSeat === seatId) {
    closeBridge();
    return;
  }
  const isSelf = seatId === lobby.playerId;
  const isHost = lobby.hostId === lobby.playerId;
  const aiSlot = (lobby.aiSlots ?? []).find((s) => s.id === seatId);
  if (!isSelf && !(isHost && aiSlot)) {
    showToast('只能给自己或自己的 AI 座位开 Bridge', 'error');
    return;
  }
  const hadActive = state.bridge.activeSeat != null;
  if (hadActive) send({ type: 'unsubscribeBridge' });

  const token = state.bridge.token || crypto.randomUUID();
  state.bridge.token = token;
  state.bridge.room = lobby.roomId;
  state.bridge.player = seatId;
  state.bridge.activeSeat = seatId;
  state.bridge.view = null;
  state.bridge.sentRound = null;
  state.bridge.resultSent = null;
  const playerName = isSelf
    ? (lobby.humans.find((h) => h.id === seatId)?.name ?? '玩家')
    : (aiSlot?.name ?? 'AI 座位');
  send({ type: 'subscribeBridge', playerId: seatId });
  if (!hadActive || bridge.status !== 'connected') {
    if (isSelf && !isHost) {
      const q = new URLSearchParams({ room: lobby.roomId, player: playerName, token });
      window.location.href = `dfbridge://open?${q.toString()}`;
    } else {
      send({ type: 'openBridge', token, seatId });
    }
    setTimeout(() => {
      if (state.bridge.activeSeat === seatId) {
        bridge.start({ token, room: lobby.roomId, player: playerName });
      }
    }, 350);
  }
  showToast(`正在为 ${playerName} 启动本机 Bridge…`);
  render();
}

function openBridge() {
  const lobby = state.lobby;
  if (!lobby) {
    showToast('需要先进入房间');
    return;
  }
  toggleBridgeSeat(lobby.playerId);
}

/* ---------- 设置页 ---------- */
const SETTINGS_PAGES = {
  audio: ['setting-volume', 'setting-music-pack'],
  light: ['setting-ambient', 'setting-glass', 'setting-diffusion', 'setting-ripple', 'setting-ripple-decay', 'setting-ripple-incident', 'setting-ripple-reflect', 'setting-range', 'setting-quality', 'setting-hide-cursor', 'setting-tint-threshold', 'setting-font', 'setting-contrast', 'setting-labels', 'setting-motion'],
  ai: ['setting-bridge-enabled', 'setting-bridge-mode'],
};
let settingsPage = 'audio';

function showSettingsPage(page) {
  if (!SETTINGS_PAGES[page]) page = 'audio';
  const previousPage = settingsPage;
  settingsPage = page;
  if (page === 'light' && previousPage !== 'light') resetLightPreviewPosition();
  for (const [name, ids] of Object.entries(SETTINGS_PAGES)) {
    const show = name === page;
    for (const id of ids) {
      const label = $(id)?.closest('label');
      if (label) label.classList.toggle('hidden', !show);
    }
  }
  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.settingsPage === page);
  });
  document.querySelectorAll('.settings-light-group').forEach((group) => {
    group.classList.toggle('hidden', page !== 'light');
  });
  document.querySelector('.setting-note')?.classList.toggle('hidden', page !== 'light');
  requestAnimationFrame(() => ambient.refresh());
  updateLightPreviewVisibility();
}

function openSettings() {
  applyDisplaySettings();
  applyAudioSettings();
  applyBridgeSettings();
  showSettingsPage(settingsPage);
  if (settingsPage === 'light') resetLightPreviewPosition();
  $('settings-overlay')?.classList.remove('hidden');
  document.body.classList.add('settings-open');
  updateLightPreviewVisibility();
  ambient.setPaused(true);
  syncBgmScene();
}

function closeSettings() {
  $('settings-overlay')?.classList.add('hidden');
  document.body.classList.remove('settings-open');
  updateLightPreviewVisibility();
  ambient.setPaused(false);
  syncBgmScene();
}

loadDisplaySettings();
loadAudioSettings();
loadBridgeSettings();

/* ---------- 连接 / 状态 ---------- */
let ws = null;
let toastTimer = null;
let reconnectTimer = null;
let reconnectAttempts = 0;

const DIR = (d) => (d === 1 ? '顺时针' : '逆时针');
const TERRAIN = (t) => (t === 'pillar' ? '柱' : t === 'ruins' ? '废墟' : '原');

function playerName(view, id) {
  return view?.players?.find((p) => p.id === id)?.name ?? `玩家${id + 1}`;
}

function intelRounds(view) {
  const rounds = new Set();
  for (const e of view?.privateLog ?? []) {
    if (e.type === 'observe' || e.type === 'clue') rounds.add(e.round);
  }
  return [...rounds].sort((a, b) => a - b);
}

/**
 * 把私密日志整理成“可画在地图上”的层：
 * - 观测层：红点 + 回合标签，默认每个段保留最近一次；选中回合则只看该回合。
 * - 枪声层：只按左/右统计次数，不画精确点；默认显示最近一轮的枪声。
 */
function getIntelLayers(view) {
  const filter = state.roundFilter;
  const observations = new Map();
  const clues = [];

  for (const e of view?.privateLog ?? []) {
    if (filter !== 'all' && e.round !== filter) continue;
    if (e.type === 'observe') {
      for (const segment of e.segments ?? []) {
        const prev = observations.get(segment);
        if (!prev || e.round >= prev.round) {
          observations.set(segment, { segment, round: e.round });
        }
      }
    } else if (e.type === 'clue') {
      clues.push({ ...e });
    }
  }

  let sound = clues;
  if (filter === 'all' && clues.length > 0) {
    const latest = Math.max(...clues.map((c) => c.round));
    sound = clues.filter((c) => c.round === latest);
  }

  return { observations: [...observations.values()], clues: sound };
}

function summarizeSound(clues) {
  const halfClues = clues.filter((c) => c.kind === 'half');
  const left = halfClues.filter((c) => c.half === 'left').length;
  const right = halfClues.filter((c) => c.half === 'right').length;
  return {
    left,
    right,
    total: left + right,
    from: halfClues[0]?.from ?? null,
    rounds: [...new Set(halfClues.map((c) => c.round))],
  };
}

function showConnectionOverlay(title, message) {
  const overlay = $('connection-overlay');
  if (!overlay) return;
  if (title) $('connection-title').textContent = title;
  if (message) $('connection-message').textContent = message;
  overlay.classList.remove('hidden');
}

function hideConnectionOverlay() {
  $('connection-overlay')?.classList.add('hidden');
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    state.connected = true;
    state.busy = false;
    reconnectAttempts = 0;
    hideConnectionOverlay();
    renderMenu();
    setStartLabel();
    if (autoStart && !state.autoStarted && state.screen === 'menu') {
      state.autoStarted = true;
      state.busy = true;
      setStartLabel();
      send({ type: 'local', playerCount: state.playerCount });
    }
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    state.connected = false;
    state.busy = false;
    state.view = null;
    state.screen = 'menu';
    state.draft = null;
    state.roundFilter = 'all';
    hideOverlay('result');
    hideOverlay('gameover');
    render();
    reconnectAttempts += 1;
    if (reconnectAttempts >= 3) {
      showConnectionOverlay(
        '连接已断开',
        '服务器可能已停止或重启。请刷新页面重试；如果反复出现，查看启动窗口和 logs\\server-errors.log。',
      );
    } else {
      showToast('连接断开，正在重连…', 'error');
    }
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 1500);
  });

  ws.addEventListener('error', () => {
    // close 会负责重连
  });
}

function send(payload) {
  if (!ws || ws.readyState !== 1) {
    showToast('还没连上服务器', 'error');
    return false;
  }
  ws.send(JSON.stringify(payload));
  return true;
}

function handleMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'state') {
    applyView(msg.view);
    return;
  }
  if (msg.type === 'bridgeState') {
    state.bridge.view = msg.view;
    state.bridge.seat = msg.playerId;
    syncBridgeView();
    return;
  }
  if (msg.type === 'gameover') {
    if (msg.returnToRoom && msg.lobby) {
      state.lobby = msg.lobby;
      state.view = null;
      state.screen = 'lobby';
      state.busy = false;
      state.draft = null;
      state.continueReady = false;
      state.resultDismissed = true;
      hideOverlay('result');
      hideOverlay('gameover');
      render();
      const winnerText = msg.winnerId == null ? '平局' : `胜者：${msg.winnerName ?? '未知'}`;
      const saved = msg.replay ? saveReplay(msg.replay) : Promise.resolve();
      saved
        .then(() => showToast(`对局结束（${winnerText}），已回到房间；回放已保存`))
        .catch(() => showToast(`对局结束（${winnerText}），已回到房间；回放保存失败`, 'error'));
      return;
    }
    applyView(msg.view);
    state.screen = 'over';
    state.busy = false;
    state.resultDismissed = true;
    if (msg.replay) {
      saveReplay(msg.replay)
        .then(() => showToast('完整回放已保存到本机历史对局'))
        .catch(() => showToast('回放保存失败，可在设置中检查浏览器存储', 'error'));
    }
    render();
    return;
  }
  if (msg.type === 'error') {
    state.busy = false;
    showToast(msg.message || '操作失败', 'error');
    render();
    return;
  }
  if (msg.type === 'room') {
    if (msg.waiting) showToast(`房间 ${msg.roomId} 已创建，等待其他玩家…`);
    return;
  }
  if (msg.type === 'lobby') {
    state.lobby = msg;
    state.view = null;
    state.screen = 'lobby';
    state.busy = false;
    state.draft = null;
    state.continueReady = false;
    hideOverlay('result');
    hideOverlay('gameover');
    render();
    if (
      autoStart &&
      !state.lobbyAutoStarted &&
      !msg.started &&
      msg.canStart
    ) {
      state.lobbyAutoStarted = true;
      state.busy = true;
      send({ type: 'startRoom' });
      render();
    }
    return;
  }
  if (msg.type === 'menu') {
    resetToMenu();
  }
}

function applyView(view) {
  if (!view) return;
  const prev = state.view;
  const sameResolved =
    prev?.phase === 'resolved' &&
    view.phase === 'resolved' &&
    prev.round === view.round;
  state.view = view;
  state.lobby = null;
  state.busy = false;
  state.continueReady = Boolean(
    view.phase === 'resolved' &&
      view.room?.ready?.includes(view.you?.id),
  );
  state.serverOffset = Date.now() - (view.room?.serverNow ?? Date.now());
  state.screen = view.phase === 'over' ? 'over' : 'game';
  if (!sameResolved) state.resultDismissed = true;
  const rounds = intelRounds(view);
  if (state.roundFilter !== 'all' && !rounds.includes(state.roundFilter)) {
    state.roundFilter = 'all';
  }
  if (view.phase !== 'selecting') state.draft = null;
  render();
}

function resetToMenu() {
  state.screen = 'menu';
  state.view = null;
  state.lobby = null;
  state.busy = false;
  state.draft = null;
  state.roundFilter = 'all';
  state.resultDismissed = false;
  state.continueReady = false;
  state.serverOffset = 0;
  state.replay = null;
  state.replayIndex = 0;
  state.replayPhase = 'start';
  hideOverlay('result');
  hideOverlay('gameover');
  hideOverlay('online');
  hideOverlay('history');
  render();
}

/* ---------- menu ---------- */

function renderMenu() {
  setStartLabel();
}

function setStartLabel() {
  const btn = $('start-local');
  if (!btn) return;
  if (!state.connected) {
    btn.textContent = '连接中…';
    btn.disabled = true;
  } else if (state.busy) {
    btn.textContent = '进入房间…';
    btn.disabled = true;
  } else {
    btn.textContent = '开始本地对局';
    btn.disabled = false;
  }
}

/* ---------- lobby ---------- */

function bridgeToggleHtml(seatId, label = 'Bridge') {
  if (!bridgeSettings.enabled) return '';
  const active = state.bridge.activeSeat === seatId;
  return `<button class="mini bridge-toggle${active ? ' active' : ''}" data-bridge-seat="${seatId}" title="${active ? '关闭本机 Bridge' : '为这个座位打开本机 Bridge'}">${active ? '关闭 Bridge' : label}</button>`;
}

function renderLobby() {
  const l = state.lobby;
  if (!l) {
    state.screen = 'menu';
    render();
    return;
  }
  const models = l.models ?? [];
  const humans = l.humans ?? [];
  const aiSlots = l.aiSlots ?? [];
  const host = l.playerId === l.hostId;
  const usableModels = models.filter((m) => m.usable !== false);
  const total = l.total ?? humans.length + aiSlots.length;

  $('lobby-meta').textContent = `房间 ${l.roomId} · ${total} / ${l.maxTotal ?? 8} 人`;
  $('lobby-room-code').textContent = `房间码 ${l.roomId}`;

  const holder = $('lobby-slots');
  const humanHtml = humans
    .map(
      (h) => `
        <div class="lobby-slot human">
          <div class="lobby-slot-head">
            <strong>${esc(h.name)}</strong>
            <span>人类${h.you ? ' · 你' : ''}</span>
          </div>
          <div class="lobby-slot-foot">
            <span class="model-desc">${h.host ? '房主' : '已加入'}</span>
            ${h.you ? bridgeToggleHtml(h.id) : ''}
          </div>
        </div>
      `,
    )
    .join('');

  const aiHtml = aiSlots
    .map((s) => {
      const options = [
        `<option value="random" ${s.modelId === 'random' ? 'selected' : ''}>随机</option>`,
        ...models.map((m) => {
          const badge =
            m.usable === false
              ? m.status === 'overflow'
                ? ' · 模型溢出'
                : ' · 模型无法读取'
              : '';
          const title = m.usable === false
            ? `${m.status === 'overflow' ? '模型溢出' : '模型无法读取'}${m.file ? ` · ${m.file}` : ''}${m.reason ? ` · ${m.reason}` : ''}`
            : '';
          return `<option value="${esc(m.id)}" ${m.id === s.modelId ? 'selected' : ''} ${m.usable === false ? 'disabled' : ''} title="${esc(title)}">${esc(m.name)} · v${esc(m.version)}${badge}</option>`;
        }),
      ].join('');
      const selected = models.find((m) => m.id === s.modelId);
      return `
        <div class="lobby-slot">
          <div class="lobby-slot-head">
            <strong>${esc(s.name)}</strong>
            <span>AI</span>
          </div>
          <select data-ai-slot="${s.id}" ${!host ? 'disabled' : ''}>${options}</select>
          <div class="lobby-slot-foot">
            <span class="model-desc">${
              s.modelId === 'random'
                ? '开局时从随机池里随机（不含守夜人基线）'
                : selected
                  ? selected.usable === false
                    ? `${selected.status === 'overflow' ? '模型溢出' : '模型无法读取'}${selected.file ? `（${selected.file}）` : ''}${selected.reason ? `：${selected.reason}` : ''}`
                    : esc(selected.description)
                  : '型号不可用'
            }</span>
            ${host ? bridgeToggleHtml(s.id, 'AI Bridge') : ''}
            ${
              host
                ? `<button class="mini danger" data-remove-ai="${s.id}" title="删除 AI">×</button>`
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  holder.innerHTML =
    humanHtml + aiHtml || '<div class="lobby-empty">房间里还没有座位。</div>';

  for (const sel of holder.querySelectorAll('[data-ai-slot]')) {
    sel.addEventListener('change', () => {
      if (state.busy) return;
      send({
        type: 'setAI',
        playerId: Number(sel.dataset.aiSlot),
        modelId: sel.value,
      });
    });
  }
  for (const btn of holder.querySelectorAll('[data-remove-ai]')) {
    btn.addEventListener('click', () => {
      if (state.busy) return;
      send({ type: 'removeAI', playerId: Number(btn.dataset.removeAi) });
    });
  }
  for (const btn of holder.querySelectorAll('[data-bridge-seat]')) {
    btn.addEventListener('click', () => toggleBridgeSeat(Number(btn.dataset.bridgeSeat)));
  }

  const addBtn = $('lobby-add-ai');
  addBtn.disabled = !l.canAddAI || state.busy;
  addBtn.title = usableModels.length ? '添加一个 AI 座位' : 'AI 逻辑文件夹为空';
  addBtn.onclick = () => {
    if (state.busy || !l.canAddAI) return;
    send({ type: 'addAI' });
  };

  const timer = $('lobby-timer');
  const timerRead = $('lobby-timer-read');
  timer.value = String(l.turnSeconds ?? 60);
  timer.disabled = !host;
  timerRead.textContent = `${l.turnSeconds ?? 60} 秒`;
  timer.oninput = () => {
    timerRead.textContent = `${timer.value} 秒`;
  };
  timer.onchange = () => {
    if (!host || state.busy) return;
    send({ type: 'setTimer', seconds: Number(timer.value) });
  };

  const note = $('lobby-note');
  const start = $('lobby-start');
  let label = host ? '开始对局' : '等待房主开始';
  let disabled = !host || !l.canStart;

  if (!host) {
    note.textContent = '房主可以添加/删除 AI、选择型号、设置计时；开始后锁定。';
    note.className = 'hint';
  } else if (total < 2) {
    note.textContent = '至少需要 2 人（人类或 AI）才能开始。点“+ 添加 AI”补一个。';
    note.className = 'hint';
  } else if (!usableModels.length) {
    note.textContent = 'AI 逻辑文件夹为空，当前只能等人类加入；AI 座位不可添加。';
    note.className = 'hint danger';
  } else {
    const broken = models.filter((m) => m.usable === false).length;
    note.textContent =
      '不要求满人。人类加入或房主添加 AI，达到 2–8 人即可开始；开局后型号/计时锁定。' +
      (broken ? ' 有 ' + broken + ' 个外部模型无法使用，详情见型号列表。' : '');
    note.className = 'hint';
  }

  start.textContent = label;
  start.disabled = disabled || state.busy;
  renderBridgePanel();
}


/* ---------- history / replay ---------- */

const REPLAY_COLORS = ['#e3bd66', '#76c4e8', '#d66b5c', '#9fce7a', '#c79bdd', '#e2a35f', '#6fd0c2', '#d88db2'];

function replayColor(index) {
  return REPLAY_COLORS[index % REPLAY_COLORS.length];
}

function replayActionText(action) {
  if (!action) return '未行动';
  if (action.type === 'hide') return '藏';
  if (action.type === 'observe') {
    return `观 ${action.dir === 1 ? '顺' : '逆'} ${action.length} 段`;
  }
  if (action.type === 'attack') {
    return `攻 ${action.target + 1} 段（${action.dir === 1 ? '顺' : '逆'}）`;
  }
  if (action.type === 'slip') {
    return `溜 → ${action.destination + 1} 段`;
  }
  return action.type;
}

function replayTime(ms) {
  try {
    return new Date(ms).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

function replayWinner(record) {
  if (record.winnerId == null) return '平局';
  return record.players.find((p) => p.id === record.winnerId)?.name ?? `玩家${record.winnerId}`;
}

function historyRowsHtml(records) {
  if (!records.length) {
    return '<p class="empty-note">这台电脑上还没有完整对局记录。打完一局后会自动保存。</p>';
  }
  return records
    .map((r) => {
      const players = (r.players ?? []).map((p) => p.name).join('、');
      return `
        <div class="history-row">
          <div class="history-main">
            <div class="history-title">${esc(r.roomId ?? '对局')} · ${esc(replayWinner(r))}</div>
            <div class="history-sub">${esc(replayTime(r.finishedAt))} · ${r.rounds?.length ?? 0} 回合 · ${esc(players)}</div>
          </div>
          <div class="history-actions">
            <button class="ghost" data-history-view="${esc(r.id)}">复盘</button>
            <button class="ghost danger" data-history-delete="${esc(r.id)}">删除</button>
          </div>
        </div>
      `;
    })
    .join('');
}

function wireHistoryRows(holder, source) {
  for (const btn of holder.querySelectorAll('[data-history-view]')) {
    btn.addEventListener('click', () => openReplay(btn.dataset.historyView, source));
  }
  for (const btn of holder.querySelectorAll('[data-history-delete]')) {
    btn.addEventListener('click', async () => {
      if (!window.confirm('删除这台电脑上的这条回放？')) return;
      await deleteReplay(btn.dataset.historyDelete);
      if (source === 'lobby') await renderLobbyHistory();
      else await openHistory();
    });
  }
}

function renderHistoryList(records) {
  const holder = $('history-list');
  holder.innerHTML = historyRowsHtml(records);
  wireHistoryRows(holder, 'history');
}

async function renderLobbyHistory() {
  const holder = $('lobby-history-list');
  if (!holder) return;
  const records = await listReplays();
  holder.innerHTML = historyRowsHtml(records);
  wireHistoryRows(holder, 'lobby');
}

function openLobbyHistory() {
  $('lobby-history-panel')?.classList.remove('hidden');
  renderLobbyHistory();
}

function closeLobbyHistory() {
  $('lobby-history-panel')?.classList.add('hidden');
}

async function openHistory() {
  const rows = await listReplays();
  renderHistoryList(rows);
  $('history-overlay').classList.remove('hidden');
}

function closeHistory() {
  $('history-overlay')?.classList.add('hidden');
}

async function openReplay(id, source = 'history') {
  const record = await getReplay(id);
  if (!record) {
    showToast('这条回放不存在或已删除', 'error');
    if (source === 'lobby') await renderLobbyHistory();
    else await openHistory();
    return;
  }
  state.replay = record;
  state.replayIndex = 1;
  state.replayPhase = 'start';
  state.replayReturn = source;
  state.screen = 'replay';
  closeHistory();
  hideOverlay('result');
  hideOverlay('gameover');
  render();
}

function replayCorpses(entry, snap, phase) {
  const stored = phase === 'end' ? entry.corpsesEnd : entry.corpses;
  if (Array.isArray(stored)) return stored;
  // 兼容 1.2.2 之前的回放：没有尸体快照时，把该阶段已死玩家按段聚合。
  const bySegment = new Map();
  for (const p of snap ?? []) {
    if (p.alive || p.position == null) continue;
    const item = bySegment.get(p.position) ?? {
      segment: p.position,
      count: 0,
      firstRound: entry.round,
      lastRound: entry.round,
      deaths: [],
    };
    item.count += 1;
    item.firstRound = Math.min(item.firstRound, entry.round);
    item.lastRound = Math.max(item.lastRound, entry.round);
    item.deaths.push({
      round: entry.round,
      playerId: p.id,
      name: p.name,
      cause: 'unknown',
    });
    bySegment.set(p.position, item);
  }
  return [...bySegment.values()];
}

function renderReplay() {
  const r = state.replay;
  if (!r || !r.rounds?.length) {
    state.screen = 'menu';
    render();
    return;
  }
  const index = Math.max(1, Math.min(r.rounds.length, state.replayIndex || 1));
  state.replayIndex = index;
  const entry = r.rounds[index - 1];
  const phase = state.replayPhase === 'end' && entry.end ? 'end' : 'start';
  state.replayPhase = phase;
  const snap = phase === 'end' ? entry.end : entry.start;
  const terrains = (phase === 'end' ? entry.terrainsEnd : entry.terrains) ?? entry.terrains;
  const replayBombTargets =
    entry.bomb?.targets ?? (entry.bomb?.target != null ? [entry.bomb.target] : []);
  const replayBombLabel = replayBombTargets.map((t) => `${t + 1} 段`).join(' / ');
  const segments = terrains.map((terrain, i) => ({
    index: i,
    terrain,
    bomb: replayBombTargets.includes(i),
  }));

  const backHistory = $('replay-back-history');
  if (backHistory) backHistory.textContent = state.replayReturn === 'lobby' ? '返回房间' : '历史';
  $('replay-round-chip').textContent = `第 ${entry.round} 回合`;
  $('replay-phase-chip').textContent = phase === 'end' ? '回合结束' : '回合开始';
  $('replay-room-chip').textContent = r.roomId ?? '回放';
  $('replay-round-label').textContent = `${index} / ${r.rounds.length}`;
  $('replay-players-count').textContent = `${snap.filter((p) => p.alive).length} 存活`;
  $('replay-slider').max = String(r.rounds.length);
  $('replay-slider').value = String(index);
  $('replay-toggle-phase').textContent = phase === 'end' ? '看回合开始' : '看回合结束';
  $('replay-prev').disabled = index <= 1;
  $('replay-next').disabled = index >= r.rounds.length;

  const playerColor = new Map(r.players.map((p, i) => [p.id, replayColor(i)]));
  const actionById = new Map((entry.actions ?? []).map((row) => [row.id, row]));
  const tokens = snap
    .filter((p) => p.alive)
    .map((p) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      alive: true,
      color: playerColor.get(p.id),
      hiding: actionById.get(p.id)?.action?.type === 'hide',
    }));
  const corpses = replayCorpses(entry, snap, phase);
  const actionLines = [];
  const observationArcs = [];
  for (const row of entry.actions ?? []) {
    const start = entry.start?.find((p) => p.id === row.id);
    if (!start || start.position < 0) continue;
    const action = row.action;
    if (action?.type === 'attack') {
      actionLines.push({ from: start.position, to: action.target, kind: 'attack', color: playerColor.get(row.id) });
    } else if (action?.type === 'slip') {
      actionLines.push({ from: start.position, to: action.destination, kind: 'slip', color: playerColor.get(row.id) });
    } else if (action?.type === 'observe') {
      const dir = action.dir === -1 ? -1 : 1;
      const length = Math.max(1, Math.min(r.S, Number(action.length) || 1));
      const full = Boolean(action.full) || start.terrain === 'plain' || length >= r.S;
      const segments = full
        ? [...Array(r.S).keys()]
        : observeSegments(start.position, dir, length, r.S);
      const segAngle = 360 / r.S;
      const a0 = dir === 1 ? start.position * segAngle : (start.position - length + 1) * segAngle;
      const a1 = dir === 1 ? (start.position + length) * segAngle : (start.position + 1) * segAngle;
      observationArcs.push({
        segments,
        full,
        a0,
        a1,
        color: playerColor.get(row.id),
        name: row.name ?? r.players.find((p) => p.id === row.id)?.name ?? '',
      });
    }
  }
  // 观测弧按是否有重叠段分层；同层共用半径，交叉时换到更外一圈。
  const obsLayers = [];
  for (const arc of observationArcs) {
    let layer = 0;
    while (
      obsLayers[layer]?.some((other) =>
        other.segments.some((segment) => arc.segments.includes(segment)),
      )
    ) {
      layer += 1;
    }
    (obsLayers[layer] ??= []).push(arc);
    arc.layer = layer;
  }

  renderBoard(
    $('replay-board'),
    {
      S: r.S,
      P: r.P,
      segments,
      you: { position: -1, terrain: 'plain' },
    },
    { tokens, actionLines, corpses, observationArcs },
  );

  $('replay-center').innerHTML = `
    <div class="round">第 ${entry.round} 回合</div>
    <div class="sub">${r.S} 段 · ${r.P} 柱<br>${phase === 'end' ? '行动结束' : '行动开始'}</div>
    ${
      replayBombTargets.length
        ? `<div class="bomb">第 ${entry.bomb.targetRound} 回合<br>轰炸 ${replayBombLabel}${entry.bomb.mode === 'double' ? '<br>双区' : entry.bomb.mode === 'fast' ? '<br>加速' : ''}</div>`
        : ''
    }
  `;

  const meta = [
    `房间 ${r.roomId ?? '—'}`,
    `${r.n} 人`,
    `胜者：${replayWinner(r)}`,
    `结束：${replayTime(r.finishedAt)}`,
    `种子：${r.seed}`,
  ];
  $('replay-meta').innerHTML = meta.map((x) => `<div>${esc(x)}</div>`).join('');
  const deathMap = new Map();
  for (const pile of corpses) {
    for (const death of pile.deaths ?? []) {
      if (!deathMap.has(death.playerId)) deathMap.set(death.playerId, death);
    }
  }

  $('replay-players').innerHTML = snap
    .map((p) => {
      const color = playerColor.get(p.id);
      const ai = p.isAI ? ` · ${p.aiModel ?? 'AI'}` : '';
      const death = deathMap.get(p.id);
      const state = p.alive ? '存活' : death ? `阵亡 R${death.round}` : '死亡';
      return `
        <div class="replay-player ${p.alive ? '' : 'dead'}">
          <i style="background:${color}"></i>
          <span class="name">${esc(p.name)}</span>
          <span class="pos">${p.position + 1} 段 · ${TERRAIN(p.terrain)}${ai}</span>
          <span class="state">${state}</span>
        </div>
      `;
    })
    .join('');

  $('replay-corpses-count').textContent = `${corpses.reduce((sum, c) => sum + c.count, 0)} 具`;
  $('replay-corpses').innerHTML = corpses.length
    ? corpses
        .map((pile) => {
          const names = (pile.deaths ?? [])
            .map((d) => `${d.name} R${d.round}`)
            .join('、');
          return `<div class="corpse-row">
            <strong>${pile.segment + 1} 段</strong>
            <span>×${pile.count}</span>
            <small>${esc(names)}</small>
          </div>`;
        })
        .join('')
    : '<p class="empty-note">本阶段还没有尸体。</p>';

  $('replay-actions').innerHTML = r.players
    .map((p) => {
      const action = (entry.actions ?? []).find((a) => a.id === p.id)?.action;
      return `<div class="replay-action-row"><i style="background:${playerColor.get(p.id)}"></i><span>${esc(p.name)}</span><strong>${esc(replayActionText(action))}</strong></div>`;
    })
    .join('');

  const logRows = [];
  for (const e of entry.public ?? []) {
    logRows.push(
      `<div class="event ${e.type === 'death' || e.type === 'bombed' || e.type === 'timeout' ? 'danger' : ''}">
        <span class="round-tag">公开</span>${esc(eventText(e, r, false))}
      </div>`,
    );
  }
  for (const p of r.players) {
    for (const e of entry.private?.[p.id] ?? []) {
      logRows.push(
        `<div class="event private ${e.type === 'damage' || e.type === 'death' ? 'danger' : ''}">
          <span class="round-tag">${esc(p.name)}</span>${esc(eventText(e, r, true))}
        </div>`,
      );
    }
  }
  const attackResultText = {
    hit: '命中',
    empty: '无人',
    avoided: '被闪避',
    parried: '被更长弧压制',
  };
  for (const attack of entry.attacks ?? []) {
    logRows.push(
      `<div class="event">
        <span class="round-tag">攻击</span>${esc(attack.name)} → ${attack.target + 1} 段（弧长 ${attack.arcLength}）：${esc(attackResultText[attack.result] ?? '未知')}
      </div>`,
    );
  }
  $('replay-log').innerHTML = logRows.length
    ? logRows.join('')
    : '<p class="empty-note">本回合没有事件。</p>';
}



/* ---------- BGM / 对局渲染 ---------- */
function desiredBgmScene() {
  if (!$('settings-overlay')?.classList.contains('hidden')) return 'settings';
  if (state.screen === 'replay') return 'replay';
  if (state.screen === 'lobby') return 'room';
  if (state.screen === 'game' || state.screen === 'over') {
    const mode = state.view?.bomb?.mode;
    if (mode === 'double') return 'phase3';
    if (mode === 'fast') return 'phase2';
    return 'phase1';
  }
  return 'menu';
}

function syncBgmScene() {
  bgm.setScene(desiredBgmScene());
}

function render() {
  const menu = $('menu-screen');
  const lobby = $('lobby-screen');
  const game = $('game-screen');
  const replay = $('replay-screen');
  const isMenu = state.screen === 'menu';
  const isLobby = state.screen === 'lobby';
  const isReplay = state.screen === 'replay';

  menu.classList.toggle('hidden', !isMenu);
  lobby.classList.toggle('hidden', !isLobby);
  game.classList.toggle('hidden', isMenu || isLobby || isReplay);
  replay.classList.toggle('hidden', !isReplay);
  syncBgmScene();
  syncBridgeView();
  requestAnimationFrame(() => ambient.refresh());
  if (isMenu) {
    renderMenu();
    hideOverlay('result');
    hideOverlay('gameover');
    return;
  }
  if (isLobby) {
    renderLobby();
    hideOverlay('result');
    hideOverlay('gameover');
    return;
  }
  if (isReplay) {
    renderReplay();
    hideOverlay('result');
    hideOverlay('gameover');
    return;
  }

  if (!state.view) {
    resetToMenu();
    return;
  }

  renderGame();
  renderAiProposal();
}

function renderAiProposal() {
  const box = $('ai-proposal');
  if (!box) return;
  const v = state.bridge.view ?? state.view;
  if (!v || v.phase !== 'selecting') {
    state.aiProposal = null;
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  const pendingUntil = v?.room?.externalActionUntil ?? 0;
  const pending = pendingUntil > Date.now() - state.serverOffset;
  const proposal = state.aiProposal;
  if (!pending && !proposal) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  if (pending) {
    box.innerHTML =
      '<div>AI 已提交行动，1.5 秒内可以覆盖或取消。</div>' +
      '<div class="proposal-actions"><button class="ghost" id="ai-cancel">取消 AI 行动</button></div>';
    $('ai-cancel')?.addEventListener('click', () => send({ type: 'cancelExternal', playerId: state.bridge.activeSeat }));
    return;
  }
  box.innerHTML =
    '<div><strong>AI ' + esc(proposal.channel) + ' 号通道提议：</strong>' +
    esc(replayActionText(proposal)) + '</div>' +
    '<div class="proposal-actions">' +
    '<button class="primary" id="ai-approve">同意</button>' +
    '<button class="ghost" id="ai-edit">修改</button>' +
    '<button class="ghost" id="ai-ignore">忽略</button></div>';
  $('ai-approve')?.addEventListener('click', () => {
    if (!state.aiProposal) return;
    const action = { ...state.aiProposal };
    delete action.channel;
    delete action.auto;
    state.aiProposal = null;
    if (state.bridge.activeSeat) send({ type: 'bridgeAction', playerId: state.bridge.activeSeat, action, external: false });
    else send({ type: 'action', action });
    render();
  });
  $('ai-edit')?.addEventListener('click', () => {
    if (!state.aiProposal) return;
    const action = state.aiProposal;
    if (action.type === 'hide') startDraft('hide');
    else if (action.type === 'observe') {
      startDraft('observe');
      if (state.draft) {
        state.draft.dir = action.dir ?? 1;
        state.draft.length = action.length ?? 1;
        state.draft.full = Boolean(action.full);
      }
    } else if (action.type === 'attack') {
      startDraft('attack');
      if (state.draft) {
        state.draft.target = action.target;
        state.draft.dir = action.dir ?? 1;
      }
    } else if (action.type === 'slip') {
      startDraft('slip');
      if (state.draft) {
        const idx = (v?.legal?.moves ?? []).findIndex(
          (m) => m.dir === action.dir && m.distance === action.distance,
        );
        if (idx >= 0) state.draft.moveIndex = idx;
      }
    }
    state.aiProposal = null;
    render();
  });
  $('ai-ignore')?.addEventListener('click', () => {
    state.aiProposal = null;
    render();
  });
}

function renderGame() {
  const v = state.view;
  if (!v) return;

  $('round-chip').textContent = `第 ${v.round} 回合`;
  const phaseText =
    v.phase === 'selecting'
      ? '行动选择'
      : v.phase === 'resolved'
        ? '回合结算'
        : '对局结束';
  $('phase-chip').textContent = phaseText;
  $('spectator-chip').classList.toggle('hidden', !v.spectator);
  if (v.spectator) $('spectator-chip').textContent = '上帝视角 · 观战';

  const bombTargets = v.bomb?.targets ?? (v.bomb?.target != null ? [v.bomb.target] : []);
  const bombLabel = bombTargets.map((t) => `${t + 1} 段`).join(' / ');
  const bombModeLabel = v.bomb?.mode === 'fast' ? '加速' : v.bomb?.mode === 'double' ? '双区' : '';
  const bombChip = $('bomb-chip');
  if (bombTargets.length) {
    bombChip.classList.remove('hidden');
    bombChip.textContent = `第 ${v.bomb.targetRound} 回合 · 轰炸 ${bombLabel}${bombModeLabel ? ` · ${bombModeLabel}` : ''}`;
  } else {
    bombChip.classList.add('hidden');
  }

  $('terrain-chip').textContent = v.you.alive
    ? `你在 ${v.you.position + 1} 段 · ${TERRAIN(v.you.terrain)}`
    : v.spectator
      ? '已退场 · 观战中'
      : '你已死亡';

  const pile = !v.spectator ? v.corpses?.[0] : null;
  $('corpse-chip').classList.toggle('hidden', !pile);
  if (pile) {
    const rounds =
      pile.firstRound === pile.lastRound
        ? `R${pile.firstRound}`
        : `R${pile.firstRound}/R${pile.lastRound}`;
    $('corpse-chip').textContent = `脚下尸体 ×${pile.count} · 发现 ${rounds}`;
  }

  $('you-name').textContent = v.you.name;
  const aliveCount = v.players.filter((p) => p.alive).length;
  $('you-grid').innerHTML = `
    <div><div class="label">位置</div><div class="value amber">${v.you.position + 1} 段</div></div>
    <div><div class="label">地形</div><div class="value">${TERRAIN(v.you.terrain)}</div></div>
    <div><div class="label">生命</div><div class="value ${v.you.alive ? '' : 'danger'}">${v.you.alive ? '1 / 1' : '已死亡'}</div></div>
    <div><div class="label">存活</div><div class="value">${aliveCount} / ${v.n}</div></div>
  `;

  const center = $('board-center');
  const layers = getIntelLayers(v);
  const sound = summarizeSound(layers.clues);
  const soundRound =
    state.roundFilter !== 'all'
      ? `R${state.roundFilter}`
      : sound.rounds.length
        ? `R${sound.rounds.join('/')}`
        : '';
  const soundLabel = `枪声：左 ${sound.left} · 右 ${sound.right}${soundRound ? `（${soundRound}）` : ''}`;
  const filterLabel = state.roundFilter === 'all' ? '全部' : `R${state.roundFilter}`;

  center.innerHTML = `
    <div class="round">第 ${v.round} 回合</div>
    <div class="sub">${v.S} 段 · ${v.P} 柱<br>${v.spectator ? '上帝视角 · 观战' : v.you.alive ? '你还活着' : '你已出局'}</div>
    ${
      bombTargets.length
        ? `<div class="bomb">第 ${v.bomb.targetRound} 回合<br>轰炸 ${bombLabel}${bombModeLabel ? `<br>${bombModeLabel}` : ''}</div>`
        : '<div class="sub" style="margin-top:10px">无轰炸预告</div>'
    }
    <div class="sub" style="margin-top:8px">情报层：${esc(filterLabel)}</div>
    <div class="sub" style="margin-top:4px">${esc(soundLabel)}</div>
  `;

  renderTimeline(v);
  renderAction();
  renderIntel();
  renderLog();
  renderBoardOnly();
  renderResult();
  renderGameOver();
  updateTimer();
}

function formatRemain(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function updateTimer() {
  const chip = $('timer-chip');
  const v = state.view;
  if (!chip) return;
  if (state.screen !== 'game' || !v?.room) {
    chip.classList.add('hidden');
    return;
  }
  const room = v.room;
  const deadline = v.phase === 'selecting' ? room.deadline : room.resultDeadline;
  if (!deadline) {
    chip.classList.add('hidden');
    return;
  }
  const now = Date.now() - state.serverOffset;
  const remain = Math.max(0, deadline - now);
  chip.classList.remove('hidden');
  chip.classList.toggle('danger', remain <= 10_000);
  chip.textContent =
    v.phase === 'resolved'
      ? `结算 ${Math.ceil(remain / 1000)}s`
      : `行动 ${formatRemain(remain)}`;

  const resultCountdown = document.getElementById('result-countdown');
  if (resultCountdown && v.phase === 'resolved') {
    const minUntil = v.room?.resultMinUntil ?? 0;
    const minRemain = Math.max(0, minUntil - now);
    resultCountdown.textContent =
      minRemain > 0
        ? `至少等待 ${Math.ceil(minRemain / 1000)} 秒 · ${Math.ceil(remain / 1000)} 秒后自动继续`
        : `${Math.ceil(remain / 1000)} 秒后自动继续`;
    const btn = document.getElementById('result-continue');
    if (btn && minRemain > 0) btn.disabled = true;
    if (btn && minRemain <= 0 && !btn.dataset.wired) {
      btn.disabled = false;
      btn.dataset.wired = '1';
      btn.addEventListener('click', continueGame);
    }
  }
}

function getPreview() {
  const v = state.view;
  const d = state.draft;
  if (!v || !d || !v.you?.alive || v.phase !== 'selecting') return [];
  const p = v.you.position;
  if (d.type === 'observe') {
    const len = d.full ? v.S : d.length;
    return observeSegments(p, d.dir, len, v.S);
  }
  if (d.type === 'attack') {
    if (d.target == null) return [];
    // 攻击弧始终按方向计算；原上只是“暴露”为全圈。
    return attackArc(p, d.target, d.dir, v.S);
  }
  if (d.type === 'slip') {
    const move = v.legal?.moves?.[d.moveIndex];
    return move ? [move.destination] : [];
  }
  return [];
}

function renderBoardOnly() {
  const v = state.view;
  if (!v) return;
  const d = state.draft;
  const layers = getIntelLayers(v);
  const tokens = v.spectator
    ? v.players
        .map((p, index) => ({ ...p, color: REPLAY_COLORS[index % REPLAY_COLORS.length] }))
        .filter((p) => p.alive && p.position != null)
        .map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          alive: true,
          color: p.color,
        }))
    : null;
  const boardView = v.spectator
    ? { ...v, you: { ...v.you, position: -1 } }
    : v;

  renderBoard($('board'), boardView, {
    previewSegments: v.spectator ? [] : getPreview(),
    observationMarks: v.spectator ? [] : layers.observations,
    soundSummary: summarizeSound(v.spectator ? [] : layers.clues),
    attackTarget: !v.spectator && d?.type === 'attack' ? d.target : null,
    tokens,
    corpses: v.corpses ?? [],
    onSegmentClick: handleSegmentClick,
  });
}

function handleSegmentClick(seg) {
  const v = state.view;
  if (!v || v.phase !== 'selecting' || !v.you?.alive) return;
  if (state.draft?.type !== 'attack') {
    showToast('先选【攻】，再点地图选目标段');
    return;
  }
  if (seg === v.you.position) {
    showToast('不能攻击自己所在的段', 'error');
    return;
  }
  state.draft.target = seg;
  render();
}

/* ---------- action panel ---------- */

function renderAction() {
  const v = state.view;
  const body = $('action-body');
  const label = $('action-state');
  if (!v) return;

  if (!v.you.alive) {
    label.textContent = v.phase === 'over' ? '对局结束' : '观战中';
    const rows = v.spectator
      ? v.players
          .map((p, index) => ({ p, color: REPLAY_COLORS[index % REPLAY_COLORS.length] }))
          .filter(({ p }) => p.position != null)
          .map(({ p, color }) => {
            return `<div class="row ${p.alive ? '' : 'dead'}"><i style="background:${color}"></i><span>${esc(p.name)}${p.isAI ? ` · ${esc(p.aiModel ?? 'AI')}` : ''}</span><span class="pos">${p.position + 1} 段 · ${TERRAIN(p.terrain)}</span></div>`;
          })
          .join('')
      : '';
    body.innerHTML = `
      <p class="note">你已退场，正在以上帝视角观战；可以看到所有人的位置和公开事件。</p>
      ${rows ? `<div class="spectator-list">${rows}</div>` : ''}
    `;
    return;
  }

  if (v.phase === 'resolved') {
    label.textContent = '已结算';
    const ready = state.continueReady;
    body.innerHTML = `
      <p class="note">${ready ? '已准备，等待其他存活玩家…' : '本回合已经结算。查看结算面板，或继续下一回合。'}</p>
      <div class="draft-actions">
        <button class="ghost" id="reopen-result">看结算</button>
        <button class="primary" id="continue-btn" ${ready ? 'disabled' : ''}>${ready ? '已准备' : '继续下一回合'}</button>
      </div>
    `;
    $('reopen-result')?.addEventListener('click', () => {
      state.resultDismissed = false;
      renderResult();
    });
    $('continue-btn')?.addEventListener('click', continueGame);
    return;
  }

  if (v.phase === 'over') {
    label.textContent = '结束';
    body.innerHTML = '<p class="note">对局结束。</p>';
    return;
  }

  if (state.busy) {
    label.textContent = '提交中';
    body.innerHTML = '<p class="note">已提交，等待结算…</p>';
    return;
  }

  const legal = v.legal;
  if (!legal) {
    label.textContent = '等待';
    body.innerHTML = '<p class="note">当前不能行动。</p>';
    return;
  }

  if (!state.draft) {
    label.textContent = '选择';
    body.innerHTML = `
      <div class="actions-grid">
        <button class="action-btn" data-action="hide" ${legal.canHide ? '' : 'disabled'}>
          <strong>藏</strong><span>柱上隐身；原上空挂，不挡观测/枪。</span>
        </button>
        <button class="action-btn" data-action="observe">
          <strong>观</strong><span>照一段弧，拿红点情报。</span>
        </button>
        <button class="action-btn" data-action="attack">
          <strong>攻</strong><span>向一个段开枪，暴露半区。</span>
        </button>
        <button class="action-btn" data-action="slip" ${legal.canSlip ? '' : 'disabled'}>
          <strong>溜</strong><span>移动 1 段；原上可 2 段。</span>
        </button>
      </div>
      <p class="hint">所有存活玩家同时行动；提交后立即结算。</p>
    `;
    for (const btn of body.querySelectorAll('[data-action]')) {
      btn.addEventListener('click', () => startDraft(btn.dataset.action));
    }
    return;
  }

  renderDraft(body, label, v, legal);
}

function startDraft(type) {
  const v = state.view;
  if (!v?.legal) return;
  if (type === 'hide') state.draft = { type: 'hide' };
  if (type === 'observe') {
    state.draft = {
      type: 'observe',
      dir: 1,
      length: v.legal.observe.full ? v.S : 1,
      full: Boolean(v.legal.observe.full),
    };
  }
  if (type === 'attack') state.draft = { type: 'attack', dir: 1, target: null };
  if (type === 'slip') {
    if (!v.legal.moves?.length) return;
    state.draft = { type: 'slip', moveIndex: 0 };
  }
  render();
}

function renderDraft(body, label, v, legal) {
  const d = state.draft;
  label.textContent =
    d.type === 'hide' ? '藏' : d.type === 'observe' ? '观' : d.type === 'attack' ? '攻' : '溜';

  if (d.type === 'hide') {
    const effective = legal.canHideEffective;
    body.innerHTML = `
      <div class="draft">
        <div class="draft-title">藏 · 保持不动</div>
        <p class="note">${
          effective
            ? '你会在本回合隐藏：观看不到你，攻打不中你；但单人溜进你所在段会击杀你。'
            : '你在平原上：藏是无效果空挂。观测仍会看到你，攻击仍能命中你，没有任何掩体效果。'
        }</p>
        <div class="draft-actions">
          <button class="ghost" data-cancel>返回</button>
          <button class="primary" data-submit>提交【藏】</button>
        </div>
      </div>
    `;
    wireDraft(body, () => ({ type: 'hide' }));
    return;
  }

  if (d.type === 'observe') {
    const full = Boolean(legal.observe.full);
    body.innerHTML = `
      <div class="draft">
        <div class="draft-title">观 · 从你所在的 ${v.you.position + 1} 段开始</div>
        ${
          full
            ? '<p class="note">你在原上：观测整圈。情报很多，但你的暴露弧也是全圈——更容易被攻命中。</p>'
            : `
          <div class="control-row">
            <span class="control-label">方向</span>
            <div class="dir-toggle">
              <button data-dir="1" class="${d.dir === 1 ? 'active' : ''}">顺时针</button>
              <button data-dir="-1" class="${d.dir === -1 ? 'active' : ''}">逆时针</button>
            </div>
          </div>
          <div class="control-row">
            <span class="control-label">长度</span>
            <input id="obs-length" type="range" min="1" max="${legal.observe.max ?? v.S}" value="${d.length}">
            <span id="obs-length-read" class="target-read"><strong>${d.length}</strong> 段</span>
          </div>
          <p class="note">范围含自己所在段；柱上最多 ${legal.observe.max} 段（不超过半圈）；只显示“有人/无人”，不显示身份。</p>
        `
        }
        <div class="draft-actions">
          <button class="ghost" data-cancel>返回</button>
          <button class="primary" data-submit>提交【观】</button>
        </div>
      </div>
    `;
    for (const b of body.querySelectorAll('[data-dir]')) {
      b.addEventListener('click', () => {
        d.dir = Number(b.dataset.dir);
        render();
      });
    }
    const range = body.querySelector('#obs-length');
    if (range) {
      range.addEventListener('input', () => {
        d.length = Math.max(1, Math.min(legal.observe.max ?? v.S, Number(range.value) || 1));
        const read = body.querySelector('#obs-length-read');
        if (read) read.innerHTML = `<strong>${d.length}</strong> 段`;
        renderBoardOnly();
      });
    }
    wireDraft(body, () => ({
      type: 'observe',
      dir: d.full ? 1 : d.dir,
      length: d.full ? v.S : d.length,
    }));
    return;
  }

  if (d.type === 'attack') {
    const target = d.target;
    const arcLength =
      target == null ? null : steps(v.you.position, target, d.dir, v.S);
    body.innerHTML = `
      <div class="draft">
        <div class="draft-title">攻 · 指定一个段</div>
        <p class="note">点击地图上的段选择目标。攻击弧按方向计算；枪声只暴露左右侧和次数，不暴露精确段。</p>
        <div class="control-row">
          <span class="control-label">方向</span>
          <div class="dir-toggle">
            <button data-dir="1" class="${d.dir === 1 ? 'active' : ''}">顺时针</button>
            <button data-dir="-1" class="${d.dir === -1 ? 'active' : ''}">逆时针</button>
          </div>
        </div>
        <div class="control-row">
          <span class="control-label">目标</span>
          <span class="target-read">${target == null ? '未选择' : `<strong>${target + 1} 段</strong>`}</span>
          ${arcLength != null ? `<span class="badge">弧长 ${arcLength}</span>` : ''}
        </div>
        <div class="draft-actions">
          <button class="ghost" data-cancel>返回</button>
          <button class="primary" data-submit ${target == null ? 'disabled' : ''}>提交【攻】</button>
        </div>
      </div>
    `;
    for (const b of body.querySelectorAll('[data-dir]')) {
      b.addEventListener('click', () => {
        d.dir = Number(b.dataset.dir);
        render();
      });
    }
    wireDraft(body, () =>
      d.target == null ? null : { type: 'attack', dir: d.dir, target: d.target },
    );
    return;
  }

  if (d.type === 'slip') {
    const moves = legal.moves ?? [];
    const selected = moves[d.moveIndex] ?? moves[0];
    body.innerHTML = `
      <div class="draft">
        <div class="draft-title">溜 · 选择落点</div>
        <div class="move-list">
          ${moves
            .map(
              (m, i) => `
            <button class="move-btn ${i === d.moveIndex ? 'selected' : ''}" data-move="${i}">
              ${esc(m.label)}${m.cross ? ' <span class="badge">穿越废墟</span>' : ''}
            </button>`,
            )
            .join('')}
        </div>
        <p class="note">落点有人时：藏/攻会被击杀；观若看到你的出发段则你死，否则观死。2 人以上同段按移动距离结算。</p>
        <div class="draft-actions">
          <button class="ghost" data-cancel>返回</button>
          <button class="primary" data-submit ${selected ? '' : 'disabled'}>提交【溜】</button>
        </div>
      </div>
    `;
    for (const b of body.querySelectorAll('[data-move]')) {
      b.addEventListener('click', () => {
        d.moveIndex = Number(b.dataset.move);
        render();
      });
    }
    wireDraft(body, () => {
      const move = moves[d.moveIndex] ?? moves[0];
      return move
        ? { type: 'slip', dir: move.dir, distance: move.distance }
        : null;
    });
  }
}

function wireDraft(container, buildAction) {
  container.querySelector('[data-cancel]')?.addEventListener('click', () => {
    state.draft = null;
    render();
  });
  container.querySelector('[data-submit]')?.addEventListener('click', () => {
    const action = buildAction();
    if (!action) return;
    state.aiProposal = null;
    state.busy = true;
    if (!send({ type: 'action', action })) {
      state.busy = false;
      render();
      return;
    }
    render();
  });
}

function continueGame() {
  if (state.busy || state.continueReady) return;
  const minUntil = state.view?.room?.resultMinUntil ?? 0;
  if (Date.now() - state.serverOffset < minUntil) {
    showToast('结算查看至少 5 秒后才能继续');
    return;
  }
  state.busy = true;
  state.continueReady = true;
  if (!send({ type: 'continue' })) {
    state.busy = false;
    state.continueReady = false;
  }
  render();
}

/* ---------- intel / log ---------- */

function eventText(e, view, priv = false) {
  if (!e) return '';
  if (e.type === 'start') {
    return `对局开始：${e.n} 人 · ${e.S} 段 · ${e.P} 柱`;
  }
  if (e.type === 'bombWarning') {
    const targets = e.targets ?? (e.target == null ? [] : [e.target]);
    const label = targets.map((t) => `${t + 1} 段`).join(' / ');
    const mode = e.mode === 'fast' ? '（加速）' : e.mode === 'double' ? '（双区）' : '';
    return `预告：第 ${e.targetRound} 回合轰炸 ${label}${mode}`;
  }
  if (e.type === 'bombed') {
    const names = (e.victims ?? []).map((v) => v.name).join('、');
    return `${e.target + 1} 段被轰炸${names ? `：${names}` : ''}`;
  }
  if (e.type === 'noBombTargets') return '没有可轰炸的段了';
  if (e.type === 'gunshot') {
    return '有人开枪';
  }
  if (e.type === 'timeout') {
    return `${e.name ?? '玩家'} 超时，按藏处理`;
  }
  if (e.type === 'death') {
    if (priv) {
      const cause =
        e.cause === 'bomb' ? '轰炸' : e.cause === 'slip' ? '近身' : '中弹';
      return `你死亡（${cause}）`;
    }
    if (e.cause === 'disconnect') {
      return `${playerName(view, e.playerId)} 因断线死亡`;
    }
    return `${playerName(view, e.playerId)} 死亡`;
  }
  if (e.type === 'gameOver') return '对局结束';

  if (!priv) return e.type;

  if (e.type === 'observe') {
    const hits = (e.segments ?? []).map((s) => `${s + 1} 段`).join('、');
    return `你从 ${e.from + 1} 段${DIR(e.dir)}观测 ${e.length} 段：${hits ? `${hits}有红点` : '没有发现'}`;
  }
  if (e.type === 'clue') {
    return e.kind === 'half'
      ? `枪声：他在你的${e.half === 'left' ? '左半' : '右半'}`
      : '枪声：方向未知';
  }
  if (e.type === 'attack') {
    return `你向 ${e.target + 1} 段开枪（弧长 ${e.arcLength}）`;
  }
  if (e.type === 'damage') return '你被击中';
  if (e.type === 'slipSeen') return '你看到了来路：溜入者被击杀';
  if (e.type === 'slipResult') {
    return `你溜到 ${e.destination + 1} 段${e.cross ? '（穿越废墟）' : ''}`;
  }
  return e.type;
}

function renderSoundSummary(layers) {
  const el = $('sound-summary');
  if (!el) return;
  const sound = summarizeSound(layers.clues);
  const round =
    state.roundFilter !== 'all'
      ? `R${state.roundFilter}`
      : sound.rounds.length
        ? `R${sound.rounds.join('/')}`
        : '';
  el.innerHTML = `
    <span class="sound-count"><i class="sound-mark"></i>左 <b>${sound.left}</b></span>
    <span class="sound-count"><i class="sound-mark"></i>右 <b>${sound.right}</b></span>
    ${round ? `<span class="sound-round">${round}</span>` : ''}
  `;
}

function renderIntel() {
  const v = state.view;
  const holder = $('intel-list');
  if (!v) return;
  const layers = getIntelLayers(v);
  renderSoundSummary(layers);
  const entries = (v.privateLog ?? [])
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => state.roundFilter === 'all' || e.round === state.roundFilter);
  if (!entries.length) {
    holder.innerHTML =
      state.roundFilter === 'all'
        ? '<p class="empty-note">还没有情报。观测、枪声和你的行动结果会出现在这里。</p>'
        : `<p class="empty-note">第 ${state.roundFilter} 回合没有情报记录。</p>`;
    return;
  }

  const rows = [];
  for (let k = entries.length - 1; k >= 0; k--) {
    const { e, index } = entries[k];
    const clickable = e.type === 'observe' || e.type === 'clue';
    const cls = [
      'event',
      'private',
      clickable ? 'clue' : '',
      e.type === 'damage' || e.type === 'death' ? 'danger' : '',
    ]
      .filter(Boolean)
      .join(' ');
    rows.push(
      `<div class="${cls}" ${clickable ? `data-clue-index="${index}"` : ''}>
        <span class="round-tag">R${e.round}</span>${esc(eventText(e, v, true))}
      </div>`,
    );
  }
  const hasClickable = entries.some(({ e }) => e.type === 'observe' || e.type === 'clue');
  holder.innerHTML =
    (hasClickable
      ? '<p class="hint" style="margin:0 0 8px">点击观测/枪声条目，只看那一回合；用地图下方的时间条回到“全部”。</p>'
      : '') + rows.join('');

  holder.querySelectorAll('[data-clue-index]').forEach((el) => {
    el.addEventListener('click', () => {
      const e = v.privateLog[Number(el.dataset.clueIndex)];
      if (!e) return;
      state.roundFilter = e.round;
      render();
    });
  });
}

function renderTimeline(view) {  const el = $('timeline');
  if (!el) return;
  const rounds = intelRounds(view);
  if (!rounds.length) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML =
    '<span class="timeline-label">情报回溯</span>' +
    `<button data-round="all" class="${state.roundFilter === 'all' ? 'active' : ''}">全部</button>` +
    rounds
      .map(
        (r) =>
          `<button data-round="${r}" class="${state.roundFilter === r ? 'active' : ''}">R${r}</button>`,
      )
      .join('');

  for (const btn of el.querySelectorAll('[data-round]')) {
    btn.addEventListener('click', () => {
      state.roundFilter = btn.dataset.round === 'all' ? 'all' : Number(btn.dataset.round);
      render();
    });
  }
}

function renderLog() {
  const v = state.view;
  const holder = $('log-list');
  if (!v) return;
  const log = v.log ?? [];
  $('log-round').textContent = `R${v.round}`;
  if (!log.length) {
    holder.innerHTML = '<p class="empty-note">还没有公开事件。</p>';
    return;
  }
  const rows = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    const danger =
      e.type === 'death' || e.type === 'bombed' || e.type === 'gameOver';
    rows.push(
      `<div class="event ${danger ? 'danger' : ''}">
        <span class="round-tag">R${e.round}</span>${esc(eventText(e, v, false))}
      </div>`,
    );
  }
  holder.innerHTML = rows.join('');
}

/* ---------- result / gameover ---------- */

function renderResult() {
  const v = state.view;
  if (!v || v.phase !== 'resolved' || state.resultDismissed) {
    hideOverlay('result');
    return;
  }
  const result = v.lastResult;
  if (!result) {
    hideOverlay('result');
    return;
  }

  const privateRows = (result.private ?? [])
    .map(
      (e) =>
        `<div class="event private ${e.type === 'damage' || e.type === 'death' ? 'danger' : ''}">
          <span class="round-tag">R${e.round}</span>${esc(eventText(e, v, true))}
        </div>`,
    )
    .join('');
  const publicRows = (result.public ?? [])
    .map(
      (e) =>
        `<div class="event ${e.type === 'death' || e.type === 'bombed' ? 'danger' : ''}">
          <span class="round-tag">R${e.round}</span>${esc(eventText(e, v, false))}
        </div>`,
    )
    .join('');

  const room = v.room ?? {};
  const ready = room.ready?.length ?? 0;
  const alive = room.aliveHumans?.length ?? 1;
  const youAlive = Boolean(v.you?.alive);
  const now = Date.now() - state.serverOffset;
  const minWait = v.room?.resultMinUntil ? Math.max(0, v.room.resultMinUntil - now) : 0;
  const readyText = youAlive
    ? `已准备 ${ready} / ${alive} · <span id="result-countdown">${minWait > 0 ? `至少等待 ${Math.ceil(minWait / 1000)} 秒` : '可继续'}</span>`
    : '你已出局，观战中；存活玩家继续后进入下一回合。';
  const canContinue = youAlive && !state.continueReady && minWait <= 0;
  const continueLabel = !youAlive
    ? '观战中'
    : state.continueReady
      ? '已准备'
      : '继续下一回合';

  $('result-modal').innerHTML = `
    <h2>第 ${result.round} 回合复盘</h2>
    <div class="subtitle">藏 → 观 → 溜 → 攻 → 死亡。下面是本回合你看到的情报与公开事件。</div>
    <div class="result-columns">
      <div class="result-column">
        <h3>你的情报</h3>
        ${privateRows || '<p class="empty-note">没有新的私密情报。</p>'}
      </div>
      <div class="result-column">
        <h3>公开结算</h3>
        ${publicRows || '<p class="empty-note">没有公开事件。</p>'}
      </div>
    </div>
    <div class="result-ready">${readyText}</div>
    <div class="modal-actions">
      <button class="ghost" id="result-dismiss">先看地图</button>
      <button class="primary" id="result-continue" ${canContinue ? '' : 'disabled'}>${continueLabel}</button>
    </div>
  `;
  $('result-overlay').classList.remove('hidden');
  $('result-dismiss')?.addEventListener('click', () => {
    state.resultDismissed = true;
    hideOverlay('result');
  });
  if (canContinue) {
    const btn = $('result-continue');
    if (btn) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', continueGame);
    }
  }
}

function renderGameOver() {
  const v = state.view;
  if (!v || v.phase !== 'over') {
    hideOverlay('gameover');
    return;
  }
  hideOverlay('result');

  const winner = v.winnerId == null ? null : playerName(v, v.winnerId);
  const youWon = v.winnerId != null && v.winnerId === v.you.id;
  const draw = v.winnerId == null;
  const boxClass = youWon ? '' : draw ? 'draw' : 'lost';
  const message = draw
    ? '同归于尽，平局。'
    : youWon
      ? '你活到了最后。'
      : `你被淘汰。胜者：${esc(winner)}`;

  const players = v.players
    .map(
      (p) =>
        `<span class="badge">${esc(p.name)}${p.alive ? ' · 存活' : ' · 死亡'}</span>`,
    )
    .join(' ');

  const tail = (v.log ?? [])
    .slice(-10)
    .map(
      (e) =>
        `<div class="event ${e.type === 'death' || e.type === 'bombed' ? 'danger' : ''}">
          <span class="round-tag">R${e.round}</span>${esc(eventText(e, v, false))}
        </div>`,
    )
    .join('');

  const autoNextAt = Number(v.room?.autoNextAt) || 0;
  const autoNextSec = autoNextAt
    ? Math.max(0, Math.ceil((autoNextAt - (Date.now() - state.serverOffset)) / 1000))
    : 0;

  $('gameover-modal').innerHTML = `
    <h2>对局结束</h2>
    <div class="subtitle">第 ${v.round} 回合 · ${v.S} 段 · ${v.P} 柱</div>
    ${
      autoNextSec
        ? `<div class="subtitle" style="color:var(--amber-2)">${autoNextSec} 秒后自动开始下一局；想留下来看回放可点“返回主菜单”。</div>`
        : ''
    }
    <div class="winner-box ${boxClass}">${message}</div>
    <div class="subtitle" style="margin-bottom:8px">最终玩家</div>
    <div style="line-height:2;margin-bottom:16px">${players}</div>
    <div class="result-column" style="margin-top:8px">
      <h3>最后几条公开日志</h3>
      ${tail || '<p class="empty-note">没有日志。</p>'}
    </div>
    <div class="modal-actions">
      <button class="ghost" id="over-menu">返回主菜单</button>
      <button class="primary" id="over-restart">再来一局</button>
    </div>
  `;
  $('gameover-overlay').classList.remove('hidden');

  $('over-restart')?.addEventListener('click', () => {
    hideOverlay('gameover');
    state.busy = true;
    send({ type: 'restart' });
    render();
  });
  $('over-menu')?.addEventListener('click', () => {
    send({ type: 'menu' });
    resetToMenu();
  });
}

/* ---------- overlays / toast ---------- */

function hideOverlay(name) {
  $(`${name}-overlay`)?.classList.add('hidden');
}

function openRules() {
  $('rules-overlay').classList.remove('hidden');
}

function closeRules() {
  $('rules-overlay').classList.add('hidden');
}

function showToast(message, kind = '') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3800);
}

/* ---------- wire ---------- */

$('start-local')?.addEventListener('click', () => {
  if (state.busy || !state.connected) return;
  state.busy = true;
  setStartLabel();
  send({
    type: 'local',
    name: '你',
    ...(autoStart ? { playerCount: state.playerCount } : {}),
  });
});

function onlineName() {
  const input = $('online-name');
  const name = String(input?.value || '').trim().slice(0, 16) || '玩家';
  try {
    localStorage.setItem('df-name', name);
  } catch {
    // ignore
  }
  return name;
}

function openOnline() {
  const overlay = $('online-overlay');
  if (!overlay) return;
  let saved = '';
  try {
    saved = localStorage.getItem('df-name') || '';
  } catch {
    // ignore
  }
  $('online-name').value = saved;
  $('online-code').value = '';
  overlay.classList.remove('hidden');
  $('online-name').focus();
}

function closeOnline() {
  $('online-overlay')?.classList.add('hidden');
}

$('settings-btn')?.addEventListener('click', openSettings);
$('lobby-settings')?.addEventListener('click', openSettings);
$('settings-btn-game')?.addEventListener('click', openSettings);
$('settings-btn-replay')?.addEventListener('click', openSettings);
$('settings-close')?.addEventListener('click', closeSettings);
$('settings-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'settings-overlay') closeSettings();
});
document.querySelectorAll('.settings-tab').forEach((tab) => {
  tab.addEventListener('click', () => showSettingsPage(tab.dataset.settingsPage));
});

$('setting-volume')?.addEventListener('input', (e) => {
  audioSettings.volume = Number(e.target.value) / 100;
  saveAudioSettings();
});

$('setting-music-pack')?.addEventListener('change', (e) => {
  audioSettings.pack = e.target.value === 'original' ? 'original' : 'new';
  saveAudioSettings();
  bgm.setPack(audioSettings.pack);
  syncBgmScene();
});


$('setting-bridge-enabled')?.addEventListener('change', (e) => {
  bridgeSettings.enabled = e.target.checked;
  saveBridgeSettings();
});

$('setting-bridge-mode')?.addEventListener('change', (e) => {
  bridgeSettings.mode = e.target.value === 'auto' ? 'auto' : 'manual';
  saveBridgeSettings();
});

$('lobby-bridge-open')?.addEventListener('click', openBridge);

$('setting-font')?.addEventListener('change', (e) => {
  displaySettings.font = Number(e.target.value) || 1;
  saveDisplaySettings();
});
$('setting-contrast')?.addEventListener('change', (e) => {
  displaySettings.contrast = e.target.checked;
  saveDisplaySettings();
});
$('setting-labels')?.addEventListener('change', (e) => {
  displaySettings.largeLabels = e.target.checked;
  saveDisplaySettings();
});
$('setting-ambient')?.addEventListener('input', (e) => {
  displaySettings.ambient = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-glass')?.addEventListener('input', (e) => {
  displaySettings.glass = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-diffusion')?.addEventListener('input', (e) => {
  displaySettings.diffusion = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-ripple')?.addEventListener('input', (e) => {
  displaySettings.ripple = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-ripple-decay')?.addEventListener('input', (e) => {
  displaySettings.rippleDecay = Math.max(0.009, Math.min(0.1, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-ripple-incident')?.addEventListener('input', (e) => {
  displaySettings.rippleIncident = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-ripple-reflect')?.addEventListener('input', (e) => {
  displaySettings.rippleReflect = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-range')?.addEventListener('input', (e) => {
  displaySettings.range = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-quality')?.addEventListener('input', (e) => {
  displaySettings.quality = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-hide-cursor')?.addEventListener('change', (e) => {
  displaySettings.hideCursor = Boolean(e.target.checked);
  saveDisplaySettings();
});

$('setting-tint-threshold')?.addEventListener('input', (e) => {
  displaySettings.tintThreshold = Math.max(0, Math.min(100, Number(e.target.value)));
  saveDisplaySettings();
});

$('setting-motion')?.addEventListener('change', (e) => {
  displaySettings.reduceMotion = e.target.checked;
  saveDisplaySettings();
});
$('settings-reset')?.addEventListener('click', () => {
  displaySettings = { ...DEFAULT_DISPLAY_SETTINGS };
  audioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  saveDisplaySettings();
  saveAudioSettings();
  showToast('设置已恢复默认');
});

$('history-btn')?.addEventListener('click', openHistory);
$('history-close')?.addEventListener('click', closeHistory);
$('history-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'history-overlay') closeHistory();
});

$('replay-prev')?.addEventListener('click', () => {
  if (!state.replay) return;
  state.replayIndex = Math.max(1, state.replayIndex - 1);
  renderReplay();
});
$('replay-next')?.addEventListener('click', () => {
  if (!state.replay) return;
  state.replayIndex = Math.min(state.replay.rounds.length, state.replayIndex + 1);
  renderReplay();
});
$('replay-slider')?.addEventListener('input', (e) => {
  state.replayIndex = Number(e.target.value) || 1;
  renderReplay();
});
$('replay-toggle-phase')?.addEventListener('click', () => {
  state.replayPhase = state.replayPhase === 'end' ? 'start' : 'end';
  renderReplay();
});
$('replay-back-history')?.addEventListener('click', async () => {
  if (state.replayReturn === 'lobby') {
    state.screen = 'lobby';
    state.replay = null;
    render();
    return;
  }
  state.screen = 'menu';
  state.replay = null;
  render();
  await openHistory();
});
$('replay-back-menu')?.addEventListener('click', () => {
  state.screen = 'menu';
  state.replay = null;
  render();
});

$('lobby-history')?.addEventListener('click', () => {
  const panel = $('lobby-history-panel');
  if (panel?.classList.contains('hidden')) openLobbyHistory();
  else closeLobbyHistory();
});
$('lobby-history-close')?.addEventListener('click', closeLobbyHistory);

$('online-btn')?.addEventListener('click', openOnline);
$('online-cancel')?.addEventListener('click', closeOnline);
$('online-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'online-overlay') closeOnline();
});
$('online-code')?.addEventListener('input', () => {
  const input = $('online-code');
  input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
$('online-code')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('online-join')?.click();
});
$('online-create')?.addEventListener('click', () => {
  if (state.busy) return;
  const name = onlineName();
  closeOnline();
  state.busy = true;
  send({ type: 'createRoom', name });
});
$('online-join')?.addEventListener('click', () => {
  if (state.busy) return;
  const code = String($('online-code')?.value || '').trim().toUpperCase();
  if (!code) {
    showToast('请填写房间码', 'error');
    return;
  }
  const name = onlineName();
  closeOnline();
  state.busy = true;
  send({ type: 'joinRoom', roomId: code, name });
});

$('lobby-back')?.addEventListener('click', () => {
  if (state.busy) return;
  send({ type: 'menu' });
  resetToMenu();
});

$('lobby-start')?.addEventListener('click', () => {
  if (state.busy) return;
  state.busy = true;
  renderLobby();
  send({ type: 'startRoom' });
});

$('rules-btn')?.addEventListener('click', openRules);
$('rules-btn-game')?.addEventListener('click', openRules);
$('rules-close')?.addEventListener('click', closeRules);
$('rules-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'rules-overlay') closeRules();
});

$('menu-btn')?.addEventListener('click', () => {
  if (state.screen === 'game' && !window.confirm('退出当前对局？')) return;
  send({ type: 'menu' });
  resetToMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeRules();
    closeSettings();
    closeHistory();
    closeOnline();
    if (state.screen === 'game' && state.draft) {
      state.draft = null;
      render();
    }
  }
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (document.querySelector('.overlay:not(.hidden)')) return;
  if (state.screen !== 'game' || !state.view || state.view.phase !== 'selecting' || !state.view.you?.alive) {
    return;
  }
  const actionByKey = { '1': 'hide', '2': 'observe', '3': 'attack', '4': 'slip' };
  const action = actionByKey[e.key];
  if (action) {
    const button = document.querySelector(`[data-action="${action}"]`);
    if (button && !button.disabled) {
      e.preventDefault();
      button.click();
    }
    return;
  }
  if (e.key === 'Enter') {
    const submit = document.querySelector('[data-submit]');
    if (submit && !submit.disabled) {
      e.preventDefault();
      submit.click();
    }
  }
});

$('connection-reload')?.addEventListener('click', () => location.reload());

window.addEventListener('error', (event) => {
  if (!event?.message) return;
  showConnectionOverlay(
    '页面出现异常',
    `已捕获页面错误：${event.message}。请刷新页面重试；如果反复出现，查看启动窗口和 logs\\server-errors.log。`,
  );
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason?.message || String(event?.reason ?? '未知错误');
  showConnectionOverlay(
    '页面出现异常',
    `已捕获未处理错误：${reason}。请刷新页面重试；如果反复出现，查看启动窗口和 logs\\server-errors.log。`,
  );
});

if (params.get('debug') === '1') {
  window.__DF_DEBUG__ = {
    state,
    applyView,
    render,
    forceGameOver(winnerId = null) {
      if (!state.view) return;
      const v = JSON.parse(JSON.stringify(state.view));
      v.phase = 'over';
      v.winnerId = winnerId;
      v.you.alive = winnerId === v.you.id;
      v.players = v.players.map((p) => ({ ...p, alive: winnerId == null ? false : p.id === winnerId }));
      state.view = v;
      state.screen = 'over';
      state.busy = false;
      state.resultDismissed = true;
      render();
    },
  };
}

setInterval(updateTimer, 250);

renderMenu();
syncBgmScene();
connect();


function wireLightPreview() {
  const el = $('light-preview');
  if (!el) return;
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = el.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.right = 'auto';
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, drag.left + e.clientX - drag.x));
    const top = Math.max(8, Math.min(window.innerHeight - h - 8, drag.top + e.clientY - drag.y));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  });
  const end = () => { drag = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

wireLightPreview();
document.querySelectorAll('.settings-light-group input, .settings-light-group select').forEach((el) => {
  el.addEventListener('input', renderLightPreview);
});
