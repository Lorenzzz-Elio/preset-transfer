import { getSillyTavernContext } from './utils.js';

export function createEventApi() {
  return {
    eventOn(name, cb) {
      const context = getSillyTavernContext();
      const es = context?.eventSource;

      if (es && typeof es.on === 'function') {
        es.on(name, cb);
        return true;
      }
      if (es && typeof es.addListener === 'function') {
        es.addListener(name, cb);
        return true;
      }
      return false;
    },
  };
}

