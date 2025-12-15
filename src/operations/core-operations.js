import { getTransferEngine } from '../transfer/transfer-context.js';

async function performInsertNewEntry(
    apiInfo,
    targetContainer,
    newEntry,
    insertPosition,
    autoEnable,
    displayMode = 'default',
) {
    const engine = getTransferEngine();
    await engine.insertEntry(apiInfo, {
        container: targetContainer,
        entry: newEntry,
        insertPosition,
        autoEnable,
        displayMode,
    });
}

async function performTransfer(
    apiInfo,
    sourceContainer,
    targetContainer,
    selectedEntries,
    insertPosition,
    autoEnable,
    displayMode = 'default',
) {
    const engine = getTransferEngine();
    await engine.transfer(apiInfo, {
        sourceContainer,
        targetContainer,
        entries: selectedEntries,
        insertPosition,
        autoEnable,
        displayMode,
    });
}

async function performDelete(apiInfo, container, selectedEntries) {
    const engine = getTransferEngine();
    await engine.deleteEntries(apiInfo, { container, entries: selectedEntries });
}

export { performDelete, performInsertNewEntry, performTransfer };

