/**
 * 架构分区检查。
 *
 * 作用：防止一次小改动把依赖关系带歪（例如浏览器代码 import Node 内置模块、
 * 规则引擎 import public/，或 shared/ring.js 依赖环境）。
 *
 * 用法：node tools/check-architecture.mjs
 * 退出码：0 = 通过；1 = 有越界引用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 每个区的允许目标区。dir 用 posix 相对路径。
 * allowNode：允许 node: 内置模块。
 * allowBare：允许 npm 包（目前只有服务端的 ws）。
 */
const ZONES = [
  {
    id: 'shared',
    dir: 'shared',
    allows: ['shared'],
    allowNode: false,
    allowBare: false,
  },
  {
    id: 'engine',
    dir: 'src/engine',
    allows: ['engine', 'shared', 'ai/lib'],
    allowNode: true,
    allowBare: false,
  },
  {
    id: 'server',
    dir: 'server',
    allows: ['server', 'engine', 'shared', 'ai/lib'],
    allowNode: true,
    allowBare: true,
  },
  {
    id: 'public',
    dir: 'public',
    allows: ['public', 'shared'],
    allowNode: false,
    allowBare: false,
  },
  {
    id: 'ai/lib',
    dir: 'ai/lib',
    allows: ['ai/lib', 'shared'],
    allowNode: false,
    allowBare: false,
  },
  {
    id: 'ai/models',
    dir: 'ai/models',
    allows: ['ai/models', 'ai/lib', 'shared'],
    allowNode: true,
    allowBare: false,
  },
];

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function zoneOf(rel) {
  return ZONES.find((zone) => rel === zone.dir || rel.startsWith(zone.dir + '/')) ?? null;
}

function resolveSpec(file, spec) {
  if (spec.startsWith('.')) {
    const abs = path.resolve(path.dirname(file), spec.split('?')[0]);
    const rel = toPosix(path.relative(ROOT, abs));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { kind: 'outside', rel: spec };
    return { kind: 'path', rel };
  }
  if (spec.startsWith('/')) {
    const clean = spec.split('?')[0];
    if (clean.startsWith('/shared/')) return { kind: 'path', rel: clean.slice(1) };
    return { kind: 'path', rel: `public${clean}` };
  }
  if (spec.startsWith('node:')) return { kind: 'node', rel: spec };
  return { kind: 'bare', rel: spec };
}

function collectImports(file, content) {
  const found = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const spec = match[1];
      if (!spec || spec.startsWith('data:')) continue;
      const line = content.slice(0, match.index).split('\n').length;
      found.push({ spec, line });
    }
  }
  // 同一个 import 可能被多个模式命中，按“行 + 说明符”去重。
  const seen = new Set();
  return found.filter((item) => {
    const key = `${item.line}:${item.spec}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const errors = [];
let scanned = 0;

for (const zone of ZONES) {
  for (const file of walk(path.join(ROOT, zone.dir))) {
    scanned += 1;
    const rel = toPosix(path.relative(ROOT, file));
    const content = fs.readFileSync(file, 'utf8');
    for (const { spec, line } of collectImports(file, content)) {
      const target = resolveSpec(file, spec);

      if (target.kind === 'node') {
        if (!zone.allowNode) {
          errors.push(`${rel}:${line}  越界 import '${spec}'：${zone.id} 区不能使用 Node 内置模块`);
        }
        continue;
      }

      if (target.kind === 'bare') {
        if (!zone.allowBare) {
          errors.push(`${rel}:${line}  越界 import '${spec}'：${zone.id} 区不能直接依赖 npm 包`);
        }
        continue;
      }

      if (target.kind === 'outside') {
        errors.push(`${rel}:${line}  越界 import '${spec}'：路径在仓库之外`);
        continue;
      }

      const targetZone = zoneOf(target.rel);
      if (!targetZone) {
        errors.push(`${rel}:${line}  越界 import '${spec}'：目标 ${target.rel} 不属于任何分区`);
        continue;
      }
      if (!zone.allows.includes(targetZone.id)) {
        errors.push(
          `${rel}:${line}  越界 import '${spec}'：${zone.id} 区不能引用 ${targetZone.id} 区`,
        );
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`架构分区检查失败：${errors.length} 处越界（扫描 ${scanned} 个文件）`);
  for (const message of errors) console.error(`  - ${message}`);
  console.error('');
  console.error('规则见 docs/维护指南.md §2、§5。');
  process.exit(1);
}

const summary = ZONES.map((zone) => `${zone.id}=${walk(path.join(ROOT, zone.dir)).length}`).join(' ');
console.log(`架构分区检查通过：${scanned} 个文件（${summary}）`);
