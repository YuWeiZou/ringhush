/**
 * Local GPU preflight: verifies Ollama/model and reports whether the model
 * loaded on the GPU. Run: node ai/sim/gpu-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(
  fs.readFileSync(path.join(HERE, '..', 'gpu.config.json'), 'utf8'),
);
const base = new URL(config.url).origin;
const model = process.env.DARK_FOREST_GPU_MODEL || config.model;

async function json(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

try {
  const version = await json(`${base}/api/version`);
  console.log(`Ollama ${version.version} @ ${base}`);
  const tags = await json(`${base}/api/tags`);
  const installed = (tags.models ?? []).map((m) => m.name);
  console.log(`model ${model}: ${installed.includes(model) ? 'installed' : 'MISSING'}`);
  if (!installed.includes(model)) {
    console.log(`available: ${installed.join(', ') || '(none)'}`);
    process.exitCode = 1;
  }

  const ps = await json(`${base}/api/ps`);
  const loaded = (ps.models ?? []).find((m) => m.name === model || m.model === model);
  if (loaded) {
    const ratio = loaded.size ? (loaded.size_vram ?? 0) / loaded.size : 0;
    console.log(
      `loaded: ${loaded.name} · vram=${loaded.size_vram ?? '?'}/${loaded.size ?? '?'} (${(ratio * 100).toFixed(0)}% GPU)`,
    );
    if (ratio < 0.9) process.exitCode = 1;
  } else {
    console.log('not currently loaded; run a GPU smoke test with --load');
  }

  if (process.argv.includes('--load') || process.argv.includes('--smoke')) {
    const started = Date.now();
    const out = await json(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: '只回答一个词：GPU',
        stream: false,
        options: { num_predict: 8 },
      }),
    });
    console.log(`smoke: ${(out.response ?? '').trim()} (${Date.now() - started}ms) eval_count=${out.eval_count}`);
    const after = await json(`${base}/api/ps`);
    const now = (after.models ?? []).find((m) => m.name === model || m.model === model);
    const afterRatio = now?.size ? (now.size_vram ?? 0) / now.size : 0;
    console.log(
      `after smoke: vram=${now?.size_vram ?? '?'}/${now?.size ?? '?'} (${(afterRatio * 100).toFixed(0)}% GPU)`,
    );
    if (afterRatio < 0.9) process.exitCode = 1;
  }
} catch (err) {
  console.error(`GPU preflight failed: ${err.message}`);
  process.exitCode = 1;
}
