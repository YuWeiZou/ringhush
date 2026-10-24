import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProfileModel, validateProfile } from '../../ai/lib/profile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AI_MODELS_DIR = process.env.DARK_FOREST_AI_DIR
  ? path.resolve(process.env.DARK_FOREST_AI_DIR)
  : path.join(ROOT, 'ai', 'models');
export const AI_EXTERNAL_DIR = process.env.DARK_FOREST_AI_EXTERNAL_DIR
  ? path.resolve(process.env.DARK_FOREST_AI_EXTERNAL_DIR)
  : path.join(ROOT, 'ai', 'external');

function displayModel(meta, extra = {}) {
  return {
    id: String(meta.id),
    name: String(meta.name ?? meta.id),
    version: String(meta.version ?? '0.0.0'),
    generation: Number(meta.generation ?? 0),
    description: String(meta.description ?? ''),
    default: Boolean(meta.default),
    external: Boolean(meta.external),
    randomPool: meta.randomPool !== false,
    usable: true,
    status: 'ok',
    reason: null,
    file: null,
    style: meta.style ?? null,
    chooseAction: null,
    ...extra,
  };
}

/**
 * 扫描 ai/models/*.js（内置）以及 ai/external/<pack>/model.json（外部声明式模型）。
 * 外部模型不可用时仍保留在列表里，供 UI 显示“模型溢出/模型无法读取”。
 */
export async function loadAIModels(dir = AI_MODELS_DIR) {
  const models = [];
  const seen = new Set();

  if (fs.existsSync(dir)) {
    let entries = [];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.js') && !e.name.startsWith('_'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      entries = [];
    }

    for (const name of entries) {
      const file = path.join(dir, name);
      try {
        const url = `${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`;
        const mod = await import(url);
        const meta = mod.meta ?? {};
        if (!meta.id || typeof mod.chooseAction !== 'function') {
          console.warn(`[ai] 跳过 ${name}: 需要导出 meta.id 和 chooseAction()`);
          continue;
        }
        if (seen.has(meta.id)) {
          console.warn(`[ai] 跳过 ${name}: 模型 id 重复 ${meta.id}`);
          continue;
        }
        seen.add(meta.id);
        models.push(
          displayModel(meta, {
            id: String(meta.id),
            name: String(meta.name ?? meta.id),
            version: String(meta.version ?? '0.0.0'),
            generation: Number(meta.generation ?? 0),
            external: Boolean(meta.external),
            randomPool: meta.randomPool !== false,
            file: name,
            chooseAction: mod.chooseAction,
          }),
        );
      } catch (err) {
        console.warn(`[ai] 跳过 ${name}: ${err.message}`);
      }
    }
  }

  // 外部模型只在默认位置扫描；测试自定义内置目录时保持隔离。
  if (dir === AI_MODELS_DIR && fs.existsSync(AI_EXTERNAL_DIR)) {
    let packs = [];
    try {
      packs = fs
        .readdirSync(AI_EXTERNAL_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      packs = [];
    }

    for (const folder of packs) {
      const filePath = path.join(AI_EXTERNAL_DIR, folder, 'model.json');
      const displayFile = `ai/external/${folder}/model.json`;
      if (!fs.existsSync(filePath)) {
        models.push({
          id: `invalid:${folder}`,
          name: folder,
          version: '0.0.0',
          generation: 0,
          description: '模型无法读取',
          default: false,
          external: true,
          randomPool: false,
          usable: false,
          status: 'invalid',
          reason: '缺少 model.json',
          file: displayFile,
          style: null,
          chooseAction: null,
        });
        continue;
      }

      let raw;
      let stat;
      try {
        stat = fs.statSync(filePath);
        raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      } catch (err) {
        models.push({
          id: `invalid:${folder}`,
          name: folder,
          version: '0.0.0',
          generation: 0,
          description: '模型无法读取',
          default: false,
          external: true,
          randomPool: false,
          usable: false,
          status: 'invalid',
          reason: err.message,
          file: displayFile,
          style: null,
          chooseAction: null,
        });
        continue;
      }

      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch {
        models.push({
          id: `invalid:${folder}`,
          name: folder,
          version: '0.0.0',
          generation: 0,
          description: '模型无法读取',
          default: false,
          external: true,
          randomPool: false,
          usable: false,
          status: 'invalid',
          reason: 'JSON 解析失败',
          file: displayFile,
          style: null,
          chooseAction: null,
        });
        continue;
      }

      const check = validateProfile(manifest, { bytes: stat.size });
      if (!check.ok) {
        const overflow = Boolean(check.overflow);
        models.push({
          id: `invalid:${folder}`,
          name: String(manifest.name ?? folder),
          version: String(manifest.version ?? '0.0.0'),
          generation: 0,
          description: overflow ? '模型溢出' : '模型无法读取',
          default: false,
          external: true,
          randomPool: false,
          usable: false,
          status: overflow ? 'overflow' : 'invalid',
          reason: check.reason,
          file: displayFile,
          style: manifest.style ?? null,
          chooseAction: null,
        });
        continue;
      }

      const id = String(manifest.id);
      if (seen.has(id)) {
        models.push({
          id: `invalid:${folder}`,
          name: String(manifest.name ?? folder),
          version: String(manifest.version ?? '0.0.0'),
          generation: 0,
          description: '模型无法读取',
          default: false,
          external: true,
          randomPool: false,
          usable: false,
          status: 'invalid',
          reason: `模型 id 重复：${id}`,
          file: displayFile,
          style: manifest.style ?? null,
          chooseAction: null,
        });
        continue;
      }
      seen.add(id);
      const model = createProfileModel(manifest, { file: displayFile });
      model.meta.status = 'ok';
      model.meta.usable = true;
      model.meta.file = displayFile;
      model.meta.randomPool = false;
      models.push(model.meta);
      models[models.length - 1].chooseAction = model.chooseAction;
    }
  }

  return models;
}
