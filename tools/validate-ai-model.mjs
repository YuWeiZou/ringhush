/**
 * Validate an external JSON AI profile without starting the game.
 *
 * Usage:
 *   node tools/validate-ai-model.mjs ai/external/my-ai/model.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateProfile } from '../ai/lib/profile.js';

const input = process.argv[2];
if (!input) {
  console.error('用法：node tools/validate-ai-model.mjs <model.json>');
  process.exit(2);
}
const file = path.resolve(input);
if (!fs.existsSync(file)) {
  console.error(`找不到文件：${file}`);
  process.exit(2);
}
const bytes = fs.statSync(file).size;
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
} catch (err) {
  console.error(JSON.stringify({ ok: false, status: 'invalid', reason: `JSON 解析失败：${err.message}` }, null, 2));
  process.exit(1);
}
const result = validateProfile(manifest, { bytes });
if (!result.ok) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        status: result.overflow ? 'overflow' : 'invalid',
        reason: result.reason,
        display: result.overflow ? '模型溢出' : '模型无法读取',
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      ok: true,
      id: manifest.id,
      name: manifest.name,
      version: manifest.version ?? '1.0.0',
      rules: manifest.rules.length,
      conditions: result.conditions,
      bytes,
      estimatedBytes: result.estimated,
    },
    null,
    2,
  ),
);
