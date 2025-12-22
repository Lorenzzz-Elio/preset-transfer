import { getParentWindow, getSillyTavernContext } from './utils.js';
import { loadTransferSettings, saveTransferSettings } from '../settings/settings-manager.js';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js');
  }
  return await worldInfoModulePromise;
}

const CHARACTER_WORLD_CACHE_KEY = 'worldbookCharacterWorldCache';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCache(raw) {
  if (!raw || typeof raw !== 'object') return { version: 1, byAvatar: {} };
  const version = Number(raw.version) || 1;
  const byAvatar = raw.byAvatar && typeof raw.byAvatar === 'object' ? raw.byAvatar : {};
  return { version, byAvatar: { ...byAvatar } };
}

function loadCharacterWorldCache() {
  const settings = loadTransferSettings();
  return normalizeCache(settings?.[CHARACTER_WORLD_CACHE_KEY]);
}

function saveCharacterWorldCache(cache) {
  const settings = loadTransferSettings();
  settings[CHARACTER_WORLD_CACHE_KEY] = normalizeCache(cache);
  saveTransferSettings(settings);
}

async function waitForWorldInfoSettings(mod, { timeoutMs = 1200, intervalMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (typeof mod?.world_names !== 'undefined') return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Compute worldbooks linked to any character.
 *
 * Notes:
 * - When SillyTavern enables `performance.lazyLoadCharacters`, the character list is "shallow"
 *   and doesn't include `data.extensions.world`. We use a small persistent cache to avoid
 *   showing everything as unbound after restart.
 * - Call with `{ unshallow: true }` to progressively fetch full character cards and refresh cache.
 */
async function computeCharacterLinkedWorldbooks(options = {}) {
  const bound = new Set();
  const { unshallow = false } = options ?? {};
  const unshallowConcurrency = Math.max(1, Number(options?.unshallowConcurrency ?? 3));
  const unshallowYieldEvery = Math.max(1, Number(options?.unshallowYieldEvery ?? 6));

  let cache;
  let cacheDirty = false;

  try {
    cache = loadCharacterWorldCache();
    const cachedWorlds = Object.values(cache.byAvatar ?? {})
      .map((v) => normalizeString(v))
      .filter(Boolean);
    for (const w of cachedWorlds) bound.add(w);
  } catch {
    cache = { version: 1, byAvatar: {} };
  }

  try {
    const ctx = getSillyTavernContext();
    const characters =
      Array.isArray(ctx?.characters) && ctx.characters.length
        ? ctx.characters
        : Array.isArray(getParentWindow()?.characters)
        ? getParentWindow().characters
        : [];

    const toUnshallow = [];

    for (let i = 0; i < characters.length; i += 1) {
      const character = characters[i];
      const avatar = normalizeString(character?.avatar);
      const world = normalizeString(character?.data?.extensions?.world ?? character?.extensions?.world);
      const isShallow = !!character?.shallow;

      if (world) bound.add(world);

      if (avatar && !isShallow) {
        const prev = normalizeString(cache?.byAvatar?.[avatar]);
        if (prev !== world) {
          if (!cache.byAvatar || typeof cache.byAvatar !== 'object') cache.byAvatar = {};
          if (world) cache.byAvatar[avatar] = world;
          else delete cache.byAvatar[avatar];
          cacheDirty = true;
        }
      } else if (unshallow && isShallow) {
        toUnshallow.push(i);
      }
    }

    if (unshallow && toUnshallow.length && typeof ctx?.unshallowCharacter === 'function') {
      let processed = 0;
      while (toUnshallow.length) {
        const batch = toUnshallow.splice(0, unshallowConcurrency);
        await Promise.allSettled(batch.map((id) => ctx.unshallowCharacter(id)));
        processed += batch.length;

        // Yield to keep UI responsive.
        if (processed % unshallowYieldEvery === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      for (const character of characters) {
        const avatar = normalizeString(character?.avatar);
        const world = normalizeString(character?.data?.extensions?.world ?? character?.extensions?.world);
        const isShallow = !!character?.shallow;

        if (world) bound.add(world);

        if (avatar && !isShallow) {
          const prev = normalizeString(cache?.byAvatar?.[avatar]);
          if (prev !== world) {
            if (!cache.byAvatar || typeof cache.byAvatar !== 'object') cache.byAvatar = {};
            if (world) cache.byAvatar[avatar] = world;
            else delete cache.byAvatar[avatar];
            cacheDirty = true;
          }
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    const mod = await getWorldInfoModule();
    await waitForWorldInfoSettings(mod);
    const charLore = mod?.world_info?.charLore;
    if (Array.isArray(charLore)) {
      for (const entry of charLore) {
        const books = entry?.extraBooks;
        if (!Array.isArray(books)) continue;
        for (const name of asArray(books)) {
          const t = normalizeString(name);
          if (t) bound.add(t);
        }
      }
    }
  } catch {
    // ignore
  }

  try {
    if (cacheDirty) saveCharacterWorldCache(cache);
  } catch {
    // ignore
  }

  return bound;
}

async function listWorldbooks() {
  const mod = await getWorldInfoModule();
  if (typeof mod.updateWorldInfoList === 'function') {
    await mod.updateWorldInfoList();
  }
  return Array.isArray(mod.world_names) ? mod.world_names.slice() : [];
}

async function batchDeleteWorldbooks(worldbookNames) {
  const results = [];
  const errors = [];
  const mod = await getWorldInfoModule();

  if (typeof mod.deleteWorldInfo !== 'function') {
    throw new Error('World Info module missing deleteWorldInfo');
  }

  for (const name of worldbookNames) {
    try {
      const success = await mod.deleteWorldInfo(name);
      results.push({ name, success });
      if (!success) {
        errors.push(`世界书 "${name}" 删除失败`);
      }
    } catch (error) {
      errors.push(`世界书 "${name}": ${error.message}`);
      results.push({ name, success: false });
    }
  }

  return { results, errors };
}

export {
  getWorldInfoModule,
  computeCharacterLinkedWorldbooks,
  listWorldbooks,
  batchDeleteWorldbooks,
};
