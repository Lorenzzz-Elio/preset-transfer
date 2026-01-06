# 预设缝合快照存储方案改进

## 问题

原方案使用 localStorage 存储快照，存在以下问题：
1. localStorage 容量限制小（5-10MB）
2. 缝合条目内容大（每个 1-3KB），多个预设会迅速占满空间
3. 不能丢弃旧数据，否则会导致数据丢失

## 解决方案：使用 IndexedDB

### 为什么选择 IndexedDB

- **容量更大**：通常 50MB+，部分浏览器可达几百 MB
- **异步操作**：不阻塞主线程
- **结构化存储**：支持索引和查询
- **持久化**：数据不会因为 localStorage 满而丢失
- **跨标签页共享**：同一浏览器的不同标签页可以共享数据

### 实现细节

#### 数据库结构
- 数据库名：`PresetTransferSnapshots`
- 对象存储：`snapshots`
- 主键：`normalizedBase`（预设的标准化基础名称）
- 索引：`updatedAt`（更新时间）

#### 存储内容
每个快照包含：
```javascript
{
  normalizedBase: 'mypreset',  // 主键
  schema: 1,
  updatedAt: 1704614400000,
  presetName: 'MyPreset v1.2.0',
  version: '1.2.0',
  patch: {
    schema: 1,
    createdAt: '2026-01-07T...',
    runs: [...],      // 缝合条目运行序列
    uninserted: [...]  // 未插入的缝合条目
  },
  stitchCount: 45
}
```

#### 精简存储
prompt 对象只保留必需字段（通过 `compressPromptForSnapshot`）：
- `identifier`, `name`, `role`, `content`
- `injection_position`, `injection_depth`, `injection_trigger`
- `system_prompt`, `marker`, `forbid_overrides`
- `pt_meta`（缝合元数据）

删除的字段：
- `enabled`, `orderIndex`（在 order 中单独存储）
- `isNewEntry`, `isUninserted`, `hiddenInDefaultMode`, `ptKey`（临时标记）

### 优势

1. **不会丢失数据**：没有 LRU 淘汰机制，所有快照都会保留
2. **容量充足**：IndexedDB 容量远大于 localStorage
3. **性能更好**：异步操作不阻塞 UI
4. **易于管理**：提供完整的查询和删除接口

### 使用方法

#### 查看快照统计
```javascript
await window.PresetTransfer.SnapshotUtils.printSnapshotStats()
```

输出示例：
```
=== 预设缝合快照统计 (IndexedDB) ===
快照数量: 5
总大小: 567.89 KB

┌─────────┬──────────────────┬─────────┬────────────┬─────────┬─────────────────────┐
│ (index) │       base       │ version │ stitchCount│ sizeKB  │      updatedAt      │
├─────────┼──────────────────┼─────────┼────────────┼─────────┼─────────────────────┤
│    0    │ 'MyPreset'       │ '1.2.0' │     45     │ '123.45'│ '2026-01-06 10:30'  │
│    1    │ 'AnotherPreset'  │ '2.0.1' │     32     │  '89.12'│ '2026-01-05 15:20'  │
└─────────┴──────────────────┴─────────┴────────────┴─────────┴─────────────────────┘
```

#### 清理快照

清理单个快照：
```javascript
await window.PresetTransfer.SnapshotUtils.removeSnapshot('预设base名称')
```

清理所有快照：
```javascript
await window.PresetTransfer.SnapshotUtils.clearAllSnapshots()
```

#### 禁用快照功能

如果不需要跨酒馆迁移，可以禁用快照：
```javascript
const settings = window.PresetTransfer.SettingsManager.loadTransferSettings();
settings.presetStitchSnapshotEnabled = false;
window.PresetTransfer.SettingsManager.saveTransferSettings(settings);
```

### 迁移说明

#### 从 localStorage 迁移到 IndexedDB

旧数据存储在 `localStorage['preset-transfer-settings'].presetStitchStateByBase`。

如果需要迁移旧数据，可以在控制台运行：
```javascript
// 读取旧数据
const oldSettings = JSON.parse(localStorage.getItem('preset-transfer-settings'));
const oldSnapshots = oldSettings?.presetStitchStateByBase || {};

// 迁移到 IndexedDB
for (const [base, state] of Object.entries(oldSnapshots)) {
  await window.PresetTransfer.SnapshotUtils.SnapshotStorage.saveSnapshot(base, state);
}

console.log(`已迁移 ${Object.keys(oldSnapshots).length} 个快照到 IndexedDB`);

// 可选：清理旧数据
delete oldSettings.presetStitchStateByBase;
localStorage.setItem('preset-transfer-settings', JSON.stringify(oldSettings));
```

### 技术细节

#### IndexedDB 操作
位置：`src/features/snapshot-storage.js`

```javascript
// 保存快照
await saveSnapshot(normalizedBase, state);

// 读取快照
const state = await loadSnapshot(normalizedBase);

// 获取所有快照
const snapshots = await getAllSnapshots();

// 删除快照
await deleteSnapshot(normalizedBase);

// 清空所有快照
await clearAllSnapshots();
```

#### 异步处理
所有快照操作都是异步的，需要使用 `await` 或 `.then()`：

```javascript
// 正确
async function example() {
  const state = await getStitchStateByBase('mypreset');
  console.log(state);
}

// 或者
getStitchStateByBase('mypreset').then(state => {
  console.log(state);
});
```

### 浏览器兼容性

IndexedDB 支持所有现代浏览器：
- Chrome 24+
- Firefox 16+
- Safari 10+
- Edge 12+

如果浏览器不支持 IndexedDB，会在控制台输出错误，但不会影响其他功能。

### 注意事项

1. **跨浏览器不共享**：IndexedDB 是浏览器本地存储，换浏览器后数据不会迁移
2. **清空缓存会丢失**：清空浏览器数据会删除 IndexedDB
3. **隐私模式限制**：某些浏览器的隐私模式可能限制 IndexedDB 使用
4. **容量限制**：虽然比 localStorage 大得多，但仍有限制（通常 50MB+）

### 容量估算

假设：
- 每个缝合条目平均 2KB（精简后）
- 每个预设 50 个缝合条目 = 100KB
- IndexedDB 容量 50MB

理论上可以存储：50MB / 100KB = 500 个预设快照

实际使用中，大部分用户不会超过 10-20 个预设，完全够用。
