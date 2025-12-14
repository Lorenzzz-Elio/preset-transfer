import { createEventApi } from './event-api.js';
import { createPresetApi } from './preset-api.js';
import { createRegexApi } from './regex-api.js';

// Unified API surface used by Preset Transfer.
// Implementation is strictly based on SillyTavern's native frontend APIs.
const PT = (() => {
  const presetApi = createPresetApi();
  const regexApi = createRegexApi();
  const eventApi = createEventApi();

  const api = {
    ...presetApi,
    ...regexApi,
    ...eventApi,
  };

  return { API: api };
})();

export { PT };

