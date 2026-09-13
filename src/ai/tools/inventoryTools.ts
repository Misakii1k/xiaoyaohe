import {
  listMeds,
  listRules,
  updateMedicationInventory,
  listRecentInventoryOperations,
  undoInventoryOperation,
  batchDeductInventory,
} from '../../db/local';
import { INVENTORY_SOURCE_LABEL } from '../../db/schema';
import { roundStock, calculateBatchDeductionPreview } from '../../features/inventory';
import { rescheduleMedicationReminders } from '../../features/reminderScheduler';
import type { AssistantCardBlock, AssistantCardItem } from '../assistant';
import { type AssistantTool, str, findMedByName } from './toolTypes';

const INVENTORY_ACTION_VALUES = ['set', 'add', 'mark_empty'] as const;
type InventoryAction = (typeof INVENTORY_ACTION_VALUES)[number];

export const editInventory: AssistantTool = {
  name: 'edit_inventory',
  label: '帮忙改一下库存',
  description: '修改某种药的库存数量。支持三种操作：set=直接设为剩余多少；add=在现有基础上加多少（补货）；mark_empty=直接标记用完。需要传药名，可用部分匹配。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '药名，可以是部分名字' },
      action: { type: 'string', enum: INVENTORY_ACTION_VALUES, description: 'set=设为剩余多少，add=补货加上多少，mark_empty=标记用完' },
      quantity: { type: 'number', description: 'set/add 时要传的数量；mark_empty 可不传', minimum: 0 },
      unit: { type: 'string', description: '单位（片/粒/袋/mL 等）；若与库存单位不一致会按字符串归一化处理', maxLength: 12 },
      note: { type: 'string', description: '可选的来源说明，例如「补了一盒」', maxLength: 80 },
    },
    required: ['medName', 'action'],
    additionalProperties: false,
  },
  confirm(args) {
    const action = args.action as InventoryAction;
    const name = str(args.medName);
    const qty = args.quantity;
    const unit = str(args.unit);
    if (action === 'mark_empty') return `把「${name}」的库存标记为用完（剩余设为 0）？`;
    const numStr = typeof qty === 'number' ? `${qty}${unit}` : String(qty ?? '');
    if (action === 'add') return `给「${name}」补货 ${numStr}（加到现有库存上）？`;
    return `把「${name}」的库存设为 ${numStr}？`;
  },
  async run(args) {
    const name = str(args.medName);
    const action = args.action as InventoryAction;
    if (!INVENTORY_ACTION_VALUES.includes(action)) {
      return { ok: false, 提示: 'action 必须是 set / add / mark_empty' };
    }
    let requestedQty: number | undefined;
    if (action === 'set' || action === 'add') {
      const rawQty = args.quantity;
      const qty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
      if (!Number.isFinite(qty) || qty < 0) {
        return { ok: false, 提示: '数量必须是 ≥ 0 的数字' };
      }
      requestedQty = qty;
    }

    const { med } = await findMedByName(name);
    if (!med) return { ok: false, 提示: `没找到叫「${name}」的药，先用 list_my_medications 看看都登记了什么药` };

    const unit = str(args.unit) || med.inventory?.unit || '';
    const note = str(args.note);
    if (!unit) {
      return { ok: false, 提示: '该药还没有库存单位，请通过 update_medication 或库存页设置初始单位' };
    }
    const { remaining: expectedRemaining, unit: expectedUnit, ...currentDetails } = med.inventory ?? {
      remaining: undefined,
      unit: undefined,
    };
    const metadata = note
      ? {
          expected: currentDetails,
          value: {
            ...currentDetails,
            sourceNote: note.slice(0, 80),
          },
        }
      : undefined;
    const committed = await updateMedicationInventory(
      med.id,
      action === 'add'
        ? { action, quantity: requestedQty ?? 0, unit, metadata }
        : action === 'mark_empty'
          ? { action, unit, expectedRemaining, expectedUnit, metadata }
          : { action, remaining: roundStock(requestedQty ?? 0), unit, expectedRemaining, expectedUnit, metadata },
      {
        source: 'ai',
        sourceNote: note || (action === 'add'
          ? `AI小助手补货 +${requestedQty ?? 0}`
          : action === 'mark_empty'
            ? 'AI小助手标记用完'
            : `AI小助手修改库存为 ${requestedQty ?? 0}`),
      },
    );
    const committedInventory = committed.med.inventory!;
    const unitDisplay = committedInventory.unit || unit || '片';
    try { await rescheduleMedicationReminders(); } catch { /* 重排失败下次启动兜底 */ }

    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'inventory',
      icon: 'box',
      eyebrow: '库存已更新',
      title: committed.med.name,
      badge: `${committedInventory.remaining}${unitDisplay}`,
      tone: committedInventory.remaining <= 0 ? 'warning' : 'success',
      body: note ? `备注：${note}` : undefined,
      facts: [
        { label: '当前剩余', value: `${committedInventory.remaining}${unitDisplay}` },
        { label: '操作', value: action === 'set' ? '设为' : action === 'add' ? '补货' : '标记用完' },
      ],
    };
    return {
      ok: true,
      已更新: `「${committed.med.name}」库存 → ${committedInventory.remaining}${unitDisplay}`,
      药名: committed.med.name,
      剩余: committedInventory.remaining,
      单位: unitDisplay,
      ui,
    };
  },
};

export const getInventoryLogs: AssistantTool = {
  name: 'get_inventory_logs',
  label: '查看库存修改记录',
  description: '查询药物库存修改历史与近 3 天的所有历史操作记录，带明确的操作来源标记（AI小助手、手动修改、服药扣减、分药向导、批量扣减、撤回操作）。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '可选，按药名筛选' },
      days: { type: 'integer', minimum: 1, maximum: 30, description: '查询最近几天，默认 3 天' },
    },
    additionalProperties: false,
  },
  async run(args) {
    const days = Math.min(30, Math.max(1, Number(args.days) || 3));
    const name = str(args.medName);
    let logs = await listRecentInventoryOperations(days);
    if (name) {
      logs = logs.filter((l) => l.medName.toLocaleLowerCase('zh-CN').includes(name.toLocaleLowerCase('zh-CN')));
    }
    const items: AssistantCardItem[] = logs.slice(0, 8).map((l) => {
      const sourceLabel = INVENTORY_SOURCE_LABEL[l.source] || l.source;
      const deltaStr = l.delta > 0 ? `+${l.delta}` : `${l.delta}`;
      const timeStr = new Date(l.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(l.timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
      return {
        title: `${l.medName} ${deltaStr}${l.unit || ''}`,
        subtitle: `${dateStr} ${timeStr} · ${sourceLabel}${l.sourceNote ? ` · ${l.sourceNote}` : ''}`,
        meta: `剩余 ${l.newRemaining}${l.unit || ''}`,
        status: l.canUndo ? 'success' : 'muted',
        statusLabel: l.canUndo ? '可撤回' : undefined,
        icon: 'box',
      };
    });
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'inventory',
      icon: 'box',
      eyebrow: `库存修改记录 · 近 ${days} 天`,
      title: name ? `「${name}」的库存操作记录` : '最近的库存操作记录',
      badge: `${logs.length} 条记录`,
      tone: 'neutral',
      body: logs.length > 0
        ? `列出了近 ${days} 天的操作历史。最近一次由本端记录的操作支持一键撤回。`
        : `近 ${days} 天内没有找到库存修改记录。`,
      items,
      facts: [
        { label: '记录数', value: `${logs.length} 条` },
        { label: '查询天数', value: `${days} 天` },
      ],
    };
    return {
      ok: true,
      记录数: logs.length,
      记录列表: logs.map((l) => ({
        药名: l.medName,
        变动: l.delta,
        之前剩余: l.previousRemaining,
        之后剩余: l.newRemaining,
        单位: l.unit,
        来源: INVENTORY_SOURCE_LABEL[l.source] || l.source,
        时间: new Date(l.timestamp).toLocaleString('zh-CN'),
        可撤回: l.canUndo ?? false,
      })),
      ui,
    };
  },
};

export const undoInventoryOperationTool: AssistantTool = {
  name: 'undo_inventory_operation',
  label: '撤回库存修改操作',
  description: '撤回某种药品最近一次或指定的库存修改操作，把库存还原为修改前的数量。',
  parameters: {
    type: 'object',
    properties: {
      medName: { type: 'string', description: '药名，可撤回该药最近一次修改' },
      logId: { type: 'string', description: '修改日志 ID，可选' },
    },
    additionalProperties: false,
  },
  confirm(args) {
    const name = str(args.medName);
    return `确定要撤回${name ? `「${name}」` : ''}最近一次的库存修改操作吗？库存将恢复至修改前的状态。`;
  },
  async run(args) {
    let logId = str(args.logId);
    const name = str(args.medName);
    if (!logId) {
      const logs = await listRecentInventoryOperations(30);
      const target = name
        ? logs.find((l) => l.canUndo && l.medName.toLocaleLowerCase('zh-CN').includes(name.toLocaleLowerCase('zh-CN')))
        : logs.find((l) => l.canUndo);
      if (!target) {
        return { ok: false, 提示: name ? `没找到「${name}」可撤回的库存修改日志` : '暂无可撤回的库存修改日志' };
      }
      logId = target.id;
    }
    const res = await undoInventoryOperation(logId);
    if (!res.ok) return { ok: false, 提示: res.message };
    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'inventory',
      icon: 'box',
      eyebrow: '撤回成功',
      title: res.log?.medName || '库存已恢复',
      tone: 'success',
      body: res.message,
    };
    return { ok: true, 结果: res.message, ui };
  },
};

export const batchDeductInventoryTool: AssistantTool = {
  name: 'batch_deduct_inventory',
  label: '一次性预扣/批量扣减库存',
  description: '批量/一次性扣除指定天数（如 7 天/一周）的药物库存。在确认与执行前，会展示当前的剩余库存、本次需要扣除的量、扣除后的预计剩余及对比区别。',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'integer', minimum: 1, maximum: 60, description: '预扣天数，例如 7 表示扣除一周库存' },
      medName: { type: 'string', description: '可选，只扣除特定某种药的库存' },
    },
    required: ['days'],
    additionalProperties: false,
  },
  confirm(args) {
    const days = Math.max(1, Number(args.days) || 7);
    const name = str(args.medName);
    return `准备一次性扣除 ${name ? `「${name}」` : '所有药品'} ${days} 天的库存。将在执行前生成完整变动对比，确认继续吗？`;
  },
  async run(args) {
    const days = Math.max(1, Number(args.days) || 7);
    const name = str(args.medName);
    const [meds, rules] = await Promise.all([listMeds(), listRules()]);
    let targetMeds = meds.filter((m) => m.inventory && !m.deleted);
    if (name) {
      targetMeds = targetMeds.filter((m) => m.name.toLocaleLowerCase('zh-CN').includes(name.toLocaleLowerCase('zh-CN')));
    }
    if (targetMeds.length === 0) {
      return { ok: false, 提示: name ? `没找到带库存且匹配「${name}」的药品` : '当前没有已设置库存的药品' };
    }

    const preview = calculateBatchDeductionPreview(targetMeds, rules, days);
    const deductItems = preview.items
      .filter((i) => i.deductQuantity > 0)
      .map((i) => ({ medId: i.medId, quantity: i.deductQuantity }));

    if (deductItems.length === 0) {
      return { ok: false, 提示: '选中的药品日均用量均为 0，无需扣减' };
    }

    const res = await batchDeductInventory(deductItems, 'batch', `一次性扣除 ${days} 天库存`);

    const items: AssistantCardItem[] = res.items.map((item) => ({
      title: item.medName,
      subtitle: `前剩余 ${item.previous}${item.unit} ➔ 实际扣除 ${item.deducted}${item.unit}`,
      meta: `实际剩余 ${item.remaining}${item.unit}`,
      status: item.remaining <= 0 ? 'warning' : 'success',
      statusLabel: item.remaining <= 0 ? '已用完' : '已提交',
      icon: 'box',
    }));

    const ui: AssistantCardBlock = {
      type: 'card',
      variant: 'inventory',
      icon: 'box',
      eyebrow: `批量扣减对比预览 (${days} 天用量)`,
      title: `已批量扣除 ${days} 天库存`,
      tone: 'success',
      body: `本次处理了 ${res.items.length} 种药品的库存扣减。右侧展示实际提交结果。`,
      items,
      facts: [
        { label: '扣除天数', value: `${days} 天` },
        { label: '处理药品数', value: `${res.items.length} 种` },
      ],
    };

    return {
      ok: true,
      扣除天数: days,
      对比明细: res.items.map((item) => ({
        药名: item.medName,
        扣除前剩余: `${item.previous}${item.unit}`,
        本次实际扣除: `${item.deducted}${item.unit}`,
        扣除后实际剩余: `${item.remaining}${item.unit}`,
        状态变化: item.remaining <= 0 ? '变为用完' : '已提交',
      })),
      ui,
    };
  },
};

export const inventoryTools: readonly AssistantTool[] = [
  editInventory,
  getInventoryLogs,
  undoInventoryOperationTool,
  batchDeductInventoryTool,
];
