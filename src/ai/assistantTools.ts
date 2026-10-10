// 全局小助手可以调用的应用内功能（查询 + 操作）。
// 会改动数据的工具带 confirm 文案，执行前必须经用户点头。
//
// 架构说明：本模块现作为公开 Barrel 门面，底层实现已按功能领域拆分至 src/ai/tools/：
// - toolTypes.ts: 共享类型、常量与快照/查找公共方法
// - medicationTools.ts: 药品增删改查、批量导入与相互作用排查
// - scheduleTools.ts: 吃药计划、按时率统计、打卡与提醒设置
// - inventoryTools.ts: 库存编辑、流水日志、撤销操作与批量扣减
// - systemTools.ts: 页面导航卡片、联网搜索、局域网同步、应用更新与系统设置

import type { AssistantTool } from './tools/toolTypes';
import {
  listMyMedications,
  addMedication,
  updateMedication,
  deleteMedication,
  checkDrugInteractionsTool,
  batchImportMedicationsTool,
} from './tools/medicationTools';
import {
  getTodayPlan,
  getAdherenceReport,
  markMedication,
  setReminderTime,
  setReminderPeriodSettings,
} from './tools/scheduleTools';
import {
  editInventory,
  getInventoryLogs,
  undoInventoryOperationTool,
  batchDeductInventoryTool,
} from './tools/inventoryTools';
import {
  presentCard,
  webSearchExa,
  openPage,
  triggerLanSync,
  checkAppUpdate,
  downloadAndInstallUpdate,
  updateAppSettings,
  OPEN_PAGE_TOOL_NAME,
} from './tools/systemTools';
import { countPillsTool } from './tools/pillTools';

export type { AssistantTool };
export { OPEN_PAGE_TOOL_NAME };
export * from './tools/toolTypes';
export * from './tools/medicationTools';
export * from './tools/scheduleTools';
export * from './tools/inventoryTools';
export * from './tools/systemTools';
export * from './tools/pillTools';

export const assistantTools: readonly AssistantTool[] = [
  getTodayPlan,
  listMyMedications,
  getAdherenceReport,
  markMedication,
  setReminderTime,
  setReminderPeriodSettings,
  webSearchExa,
  presentCard,
  openPage,
  editInventory,
  addMedication,
  updateMedication,
  deleteMedication,
  triggerLanSync,
  checkAppUpdate,
  downloadAndInstallUpdate,
  updateAppSettings,
  getInventoryLogs,
  undoInventoryOperationTool,
  batchDeductInventoryTool,
  checkDrugInteractionsTool,
  batchImportMedicationsTool,
  countPillsTool,
];

export function findAssistantTool(name: string): AssistantTool | undefined {
  return assistantTools.find((t) => t.name === name);
}
