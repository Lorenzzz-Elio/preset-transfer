export class TransferEngine {
    /**
     * @param {import('./types.js').TransferAdapter} adapter
     */
    constructor(adapter) {
        this.adapter = adapter;
    }

    /**
     * @param {import('../core/utils.js').ApiInfo} apiInfo
     * @returns {Promise<string[]>}
     */
    async listContainers(apiInfo) {
        return await this.adapter.listContainers(apiInfo);
    }

    /**
     * @param {import('../core/utils.js').ApiInfo} apiInfo
     * @param {string} name
     * @param {string} displayMode
     * @returns {Promise<import('./types.js').TransferEntry[]>}
     */
    async getEntries(apiInfo, name, displayMode) {
        return await this.adapter.getEntries(apiInfo, name, displayMode);
    }

    /**
     * @param {import('../core/utils.js').ApiInfo} apiInfo
     * @param {import('./types.js').TransferPerformParams} params
     * @returns {Promise<void>}
     */
    async transfer(apiInfo, params) {
        return await this.adapter.transfer(apiInfo, params);
    }

    /**
     * @param {import('../core/utils.js').ApiInfo} apiInfo
     * @param {import('./types.js').TransferDeleteParams} params
     * @returns {Promise<void>}
     */
    async deleteEntries(apiInfo, params) {
        if (typeof this.adapter.deleteEntries !== 'function') {
            throw new Error(`${this.adapter.id}: deleteEntries is not supported`);
        }
        return await this.adapter.deleteEntries(apiInfo, params);
    }

    /**
     * @param {import('../core/utils.js').ApiInfo} apiInfo
     * @param {{ container: string, entry: import('./types.js').TransferEntry, insertPosition?: string, autoEnable?: boolean, displayMode?: string }} params
     * @returns {Promise<void>}
     */
    async insertEntry(apiInfo, params) {
        if (typeof this.adapter.insertEntry !== 'function') {
            throw new Error(`${this.adapter.id}: insertEntry is not supported`);
        }
        return await this.adapter.insertEntry(apiInfo, params);
    }
}
