// IndexedDB 封装（idb）：离线优先的本地存储 + 局域网同步元数据
// 本文件作为稳定公共导出门面（Facade Barrel），向下保持 100% API 兼容。

export * from './connection';
export * from './errors';
export * from './normalization';
export * from './inventoryHelpers';
export * from './repositories/assistantRepo';
export * from './repositories/photosRepo';
export * from './repositories/pushStatesRepo';
export * from './repositories/reminderPeriodsRepo';
export * from './repositories/rulesRepo';
export * from './repositories/medsRepo';
export * from './repositories/logsRepo';
export * from './repositories/inventoryRepo';
export * from './repositories/importExportRepo';
