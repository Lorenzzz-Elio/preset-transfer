import { getGlobalTavernRegexesNative, updateGlobalTavernRegexesWithNative } from './st-regex.js';

export function createRegexApi() {
  return {
    getTavernRegexes(opts = {}) {
      const scope = opts?.scope || 'global';
      if (scope !== 'global') return [];
      return getGlobalTavernRegexesNative(opts);
    },

    async updateTavernRegexesWith(updater, option = {}) {
      const scope = option?.scope || 'global';
      if (scope !== 'global') return [];
      return await updateGlobalTavernRegexesWithNative(updater);
    },
  };
}

