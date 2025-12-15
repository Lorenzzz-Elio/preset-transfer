/**
 * @typedef {object} TransferEntry
 * @property {string} identifier
 * @property {string} name
 * @property {string} content
 * @property {boolean} [enabled]
 * @property {string} [ptKey] Stable compare key for "new entries" detection
 * @property {unknown} [raw] Domain-specific payload for transfer operations
 * @property {string} [role]
 * @property {string} [injection_position]
 * @property {number} [injection_depth]
 * @property {number} [injection_order]
 * @property {string[]} [injection_trigger]
 */

/**
 * @typedef {object} TransferPerformParams
 * @property {string} sourceContainer
 * @property {string} targetContainer
 * @property {TransferEntry[]} entries
 * @property {string} [insertPosition]
 * @property {boolean} [autoEnable]
 * @property {string} [displayMode]
 */

/**
 * @typedef {object} TransferDeleteParams
 * @property {string} container
 * @property {TransferEntry[]} entries
 */

/**
 * @typedef {object} TransferAdapter
 * @property {string} id
 * @property {{ toolTitle: string, containerLabel: string }} ui
 * @property {{ supportsInsertPosition: boolean, supportsUninsertedMode: boolean, supportsEdit: boolean, supportsCopy: boolean, supportsMove: boolean, supportsCompare: boolean, supportsBatchDeleteContainers: boolean }} capabilities
 * @property {(apiInfo: import('../core/utils.js').ApiInfo) => Promise<string[]>} listContainers
 * @property {(apiInfo: import('../core/utils.js').ApiInfo, name: string, displayMode: string) => Promise<TransferEntry[]>} getEntries
 * @property {(apiInfo: import('../core/utils.js').ApiInfo, params: TransferPerformParams) => Promise<void>} transfer
 * @property {(apiInfo: import('../core/utils.js').ApiInfo, params: TransferDeleteParams) => Promise<void>} [deleteEntries]
 * @property {(apiInfo: import('../core/utils.js').ApiInfo, params: { container: string, entry: TransferEntry, insertPosition?: string, autoEnable?: boolean, displayMode?: string }) => Promise<void>} [insertEntry]
 */

export {};
