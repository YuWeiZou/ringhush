import fs from 'node:fs';
import { chooseAction as fallbackHunter } from './hunter.js';
import { refreshKnown } from '../lib/common.js';

/**
 * 本地显卡模型适配器。
 *
 * Node 进程不做推理；它把“这个 AI 看得到的局面”发给本机运行中的
 * OpenAI 兼容服务（Ollama / llama.cpp server / vLLM 等），由显卡出动作。
 * 服务不可用或输出非法时，回退到猎手策略，保证对局继续。
 *
 * 配置：ai/gpu.config.json
 * 环境变量可覆盖：DARK_FOREST_GPU_URL / _MODEL / _KEY / _TIMEOUT_MS / _MODE
 */

function readConfig() {
  try {
    return JSON.parse(
      fs.readFileSync(new URL('../gpu.config.json', import.meta.url), 'utf8'),
    );
  } catch {
    return {};
  }
}

const CONFIG = readConfig();
const URL_ = process.env.DARK_FOREST_GPU_URL || CONFIG.url || 'http://127.0.0.1:11434/v1/chat/completions';
const MODEL = process.env.DARK_FOREST_GPU_MODEL || CONFIG.model || 'qwen2.5:14b';
const API_KEY = process.env.DARK_FOREST_GPU_KEY || CONFIG.apiKey || '';
const TIMEOUT = Number(process.env.DARK_FOREST_GPU_TIMEOUT_MS || CONFIG.timeoutMs || 8000);
const MODE = process.env.DARK_FOREST_GPU_MODE || CONFIG.mode || 'openai';

let warned = false;
let downUntil = 0;
const STATS_KEY = Symbol.for('darkforest.gpu.stats');
const stats = (globalThis[STATS_KEY] ??= {
  calls: 0,
  legal: 0,
  fallbacks: 0,
  errors: 0,
  lastError: null,
});

export function getGpuStats() {
  return { ...stats };
}

export function resetGpuStats() {
  stats.calls = 0;
  stats.legal = 0;
  stats.fallbacks = 0;
  stats.errors = 0;
  stats.lastError = null;
}

export const meta = {
  id: 'gpu',
  name: '本地显卡模型',
  version: '2.3.3',
  generation: 11,
  style: { aggression: 0.6, observation: 0.5, hide: 0.5, trapCommit: 0.9, blindFire: 0.5, longArc: 0.65, compartmentClear: 0.6, bombCaution: 0.75 },
  external: true,
  description: `2.3 适配器：通过本机 GPU 推理服务出决策（${MODE}: ${MODEL}）。需运行 Ollama / llama.cpp / vLLM；不可用时回退到猎手。`,
};

function compactState(ctx) {
  const known = refreshKnown(ctx)
    .filter((k) => ctx.round - k.round <= 3)
    .map((k) => ({
      segment: k.segment + 1,
      terrain: ctx.map[k.segment]?.terrain,
      age: ctx.round - k.round,
      source: k.source,
    }));
  const sound = { left: 0, right: 0 };
  for (const e of ctx.privateLog ?? []) {
    if (e.type === 'clue' && e.kind === 'half') sound[e.half] += 1;
  }
  const recent = (ctx.privateLog ?? [])
    .slice(-24)
    .map((e) => {
      const out = { type: e.type, round: e.round };
      if (e.type === 'observe') {
        out.from = e.from + 1;
        out.segments = (e.segments ?? []).map((s) => s + 1);
      } else if (e.type === 'clue') {
        out.kind = e.kind;
        out.half = e.half;
      } else if (e.type === 'attack') {
        out.target = e.target + 1;
        out.arcLength = e.arcLength;
      } else if (e.type === 'death') {
        out.cause = e.cause;
      }
      return out;
    });

  return {
    game: 'dark-forest',
    round: ctx.round,
    segments: ctx.S,
    pillars: ctx.P,
    me: {
      name: ctx.me.name,
      position: ctx.me.position + 1,
      terrain: ctx.me.terrain,
    },
    bomb: {
      target: ctx.bomb.target == null ? null : ctx.bomb.target + 1,
      targets: (ctx.bomb.targets ?? []).map((t) => t + 1),
      targetRound: ctx.bomb.targetRound,
    },
    alivePlayers: ctx.players.filter((p) => p.alive).map((p) => p.name),
    terrain: ctx.map.map((m) => m.terrain),
    legal: {
      canHide: ctx.legal.canHide,
      canHideEffective: ctx.legal.canHideEffective,
      observeFull: ctx.legal.observe.full,
      observeMax: ctx.legal.observe.max,
      moves: ctx.legal.moves.map((m) => ({
        dir: m.dir,
        distance: m.distance,
        destination: m.destination + 1,
        cross: m.cross,
      })),
    },
    known: known,
    soundCounts: sound,
    recentIntel: recent,
  };
}

function isLegal(ctx, action) {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'hide') return Boolean(ctx.legal.canHide);
  if (action.type === 'observe') {
    const dir = action.dir === -1 ? -1 : 1;
    const length = Number(action.length);
    return Number.isInteger(length) && length >= 1 && length <= (ctx.legal.observe.max ?? ctx.S) && (dir === 1 || dir === -1);
  }
  if (action.type === 'attack') {
    const target = Number(action.target);
    return (
      Number.isInteger(target) &&
      target >= 0 &&
      target < ctx.S &&
      target !== ctx.me.position
    );
  }
  if (action.type === 'slip') {
    const dir = action.dir === -1 ? -1 : 1;
    const distance = Number(action.distance) === 2 ? 2 : 1;
    return ctx.legal.moves.some((m) => m.dir === dir && m.distance === distance);
  }
  return false;
}

function parseAction(text) {
  const raw = String(text ?? '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    if (obj.action && typeof obj.action === 'object') return obj.action;
    return obj;
  } catch {
    return null;
  }
}

async function askOpenAI(state) {
  const messages = [
    {
      role: 'system',
      content:
        '你是《黑暗森林》的 AI 玩家。你只能使用给定信息，不能假设其他玩家的位置，也不能与其他玩家交流。' +
        '请从 legal 中选择一个合法行动，只输出 JSON，不要解释。' +
        '格式：{"type":"hide"} / {"type":"observe","dir":1或-1,"length":整数} / ' +
        '{"type":"attack","target":段号,"dir":1或-1} / {"type":"slip","dir":1或-1,"distance":1或2}。' +
        '段号是 1-based。优先活下来，再利用 known 和 recentIntel 的信息。',
    },
    { role: 'user', content: JSON.stringify(state) },
  ];
  const headers = { 'content-type': 'application/json' };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 160,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

async function askDecide(state) {
  const headers = { 'content-type': 'application/json' };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({ state }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return JSON.stringify(data);
  } finally {
    clearTimeout(timer);
  }
}

export async function chooseAction(ctx) {
  stats.calls += 1;
  if (Date.now() < downUntil) {
    stats.fallbacks += 1;
    return fallbackHunter(ctx);
  }
  try {
    const state = compactState(ctx);
    const text = MODE === 'decide' ? await askDecide(state) : await askOpenAI(state);
    const action = parseAction(text);
    if (action?.type === 'attack') {
      // 提示词里段号是 1-based，引擎内部是 0-based
      action.target = Number(action.target) - 1;
    }
    if (action?.type === 'observe') {
      action.dir = action.dir === -1 ? -1 : 1;
      const n = Number(action.length);
      action.length = Number.isInteger(n)
        ? Math.max(1, Math.min(ctx.legal.observe.max ?? ctx.S, n))
        : Math.max(2, Math.min(ctx.legal.observe.max ?? ctx.S, Math.floor(ctx.S / 3)));
    }
    if (isLegal(ctx, action)) {
      downUntil = 0;
      if (action.type === 'attack') {
        action.target = Number(action.target);
        action.dir = action.dir === -1 ? -1 : 1;
      }
      if (action.type === 'observe') {
        action.dir = action.dir === -1 ? -1 : 1;
        action.length = Math.max(1, Math.min(ctx.S, Number(action.length)));
      }
      stats.legal += 1;
      return action;
    }
    stats.fallbacks += 1;
    stats.lastError = 'invalid action';
    downUntil = Date.now() + 30_000;
    if (!warned) {
      warned = true;
      console.warn(`[ai] 本地显卡模型输出非法/不可用，已回退猎手。配置：${URL_} · ${MODEL}`);
    }
  } catch (err) {
    stats.fallbacks += 1;
    stats.errors += 1;
    stats.lastError = err.message;
    downUntil = Date.now() + 30_000;
    if (!warned) {
      warned = true;
      console.warn(`[ai] 本地显卡模型不可用（${err.message}），已回退猎手。配置：${URL_}`);
    }
  }
  return fallbackHunter(ctx);
}
