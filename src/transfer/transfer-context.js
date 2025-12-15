import { createPresetTransferAdapter } from './adapters/preset-adapter.js';
import { createWorldbookTransferAdapter } from './adapters/worldbook-adapter.js';
import { TransferEngine } from './transfer-engine.js';

const adapters = Object.freeze({
    preset: createPresetTransferAdapter(),
    worldbook: createWorldbookTransferAdapter(),
});

/** @type {keyof typeof adapters} */
let activeAdapterKey = 'preset';

/** @type {TransferEngine} */
let activeEngine = new TransferEngine(adapters[activeAdapterKey]);

export function setActiveTransferAdapterKey(adapterKey) {
    if (!Object.prototype.hasOwnProperty.call(adapters, adapterKey)) {
        throw new Error(`Unknown transfer adapter: ${adapterKey}`);
    }
    activeAdapterKey = adapterKey;
    activeEngine = new TransferEngine(adapters[activeAdapterKey]);
}

export function getActiveTransferAdapterKey() {
    return activeAdapterKey;
}

export function getActiveTransferAdapter() {
    return adapters[activeAdapterKey];
}

export function getTransferEngine() {
    return activeEngine;
}

