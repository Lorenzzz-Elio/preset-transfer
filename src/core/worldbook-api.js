import { getParentWindow, getSillyTavernContext } from './utils.js';

let worldInfoModulePromise = null;

async function getWorldInfoModule() {
  if (!worldInfoModulePromise) {
    worldInfoModulePromise = import('/scripts/world-info.js');
  }
  return await worldInfoModulePromise;
}

async function computeCharacterLinkedWorldbooks() {
  const bound = new Set();

  try {
    const ctx = getSillyTavernContext();
    const characters =
      Array.isArray(ctx?.characters) && ctx.characters.length
        ? ctx.characters
        : Array.isArray(getParentWindow()?.characters)
        ? getParentWindow().characters
        : [];
    for (const character of characters) {
      const world = character?.data?.extensions?.world ?? character?.extensions?.world;
      if (typeof world === 'string' && world.trim()) {
        bound.add(world.trim());
      }
    }
  } catch {
    // ignore
  }

  try {
    const mod = await getWorldInfoModule();
    const charLore = mod?.world_info?.charLore;
    if (Array.isArray(charLore)) {
      for (const entry of charLore) {
        const books = entry?.extraBooks;
        if (!Array.isArray(books)) continue;
        for (const name of books) {
          if (typeof name === 'string' && name.trim()) {
            bound.add(name.trim());
          }
        }
      }
    }
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

