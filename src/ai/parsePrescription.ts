// 自然语言 → 结构化处方（NLU 填表）
// 用户：「阿司匹林肠溶片 100mg，每天早晚各一片，饭后吃，30天，注意监测出血」
// 输出：{ name, dosageText, amountPerDose, slots, slotTimes, mealRelsBySlot, daysOfWeek, notes }

import { getLlmConfig } from './llmConfig';
import {
  SLOT_DEFAULT_TIME,
  mealRelsFromBySlot,
  normalizeMealRelsBySlot,
  type Slot,
  type MealRel,
  type MealRelsBySlot,
} from '../db/schema';

export interface PrescriptionDraft {
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  /** 每个时段建议的提醒时间（HH:mm），缺省回退到 SLOT_DEFAULT_TIME */
  slotTimes: Partial<Record<Slot, string>>;
  /** 与进餐关系（可多选；空数组 = 不限） */
  mealRels: MealRel[];
  /** 每个时段的餐食关系，例如早餐前、午餐中、晚餐后 */
  mealRelsBySlot: MealRelsBySlot;
  /** 服药星期 0-6（0=日）；空数组 = 每天 */
  daysOfWeek: number[];
  notes: string;
  /** AI 给的自评置信度 0-1 */
  confidence: number;
}

export class ParsePrescriptionError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
  }
}

const SYSTEM_PROMPT = `你是一个药学助手，把用户口语化描述转成结构化的处方草稿，用于填写吃药提醒应用的表单。

只输出一个 JSON 对象，**不要**包裹 markdown 代码块、不要解释。字段定义：

{
  "name": "药名（中文为主，去掉剂量后缀，如'阿司匹林肠溶片'）",
  "dosageText": "规格，如 '100mg/片'、'5mg/胶囊'、'10mL/支'；不知道留 ''",
  "amountPerDose": "每次用量，如 '1片'、'半片'、'2粒'、'5mL'；不知道留 ''",
  "slots": ["morning"|"noon"|"evening"|"bedtime" 的子集，表示一天中哪些时段服用],
  "slotTimes": { "morning": "08:00", "noon": "12:00", ... } 用户明确说了时间才填，否则留空对象 {},
  "mealRels": ["before"|"after"|"with" 的任意组合]（餐前 / 餐后 / 餐中；可同时多选；用户没提就留空数组 []）,
  "mealRelsBySlot": { "morning": ["before"], "noon": ["with"], "evening": ["after"] } 精确到早餐/午餐/晚餐/睡前；不知道就留空对象 {},
  "daysOfWeek": [0-6 的数组，0=周日；'每天' 输出 []；'工作日' 输出 [1,2,3,4,5]；'周末' 输出 [0,6]],
  "notes": "用户提到的注意事项、医嘱、副作用等；没有就空字符串",
  "confidence": 0-1 的小数，自评把握度
}

时段映射参考：
- 早上 / 早晨 / 早饭 → morning
- 中午 / 午饭 / 午间 → noon
- 晚上 / 傍晚 / 晚饭 → evening
- 睡前 / 临睡 / 夜里 → bedtime

"一天三次" → morning + noon + evening
"早晚" → morning + evening
"每天一次" 没说时段时默认 morning
"餐前" → mealRels 含 "before"；"餐后" → mealRels 含 "after"；"随餐 / 饭中 / 餐间" → mealRels 含 "with"；没提 → mealRels: [];
**重要：优先精确输出 mealRelsBySlot**，如 "早餐前 + 晚餐后" → slots: ["morning","evening"], mealRelsBySlot: {"morning":["before"],"evening":["after"]}, mealRels: ["before","after"]
"午餐中吃" → slots: ["noon"]，mealRelsBySlot: {"noon":["with"]}, mealRels: ["with"]

不要编造用户没提供的剂量信息。判断不准就放低 confidence。`;

export async function parsePrescription(text: string): Promise<PrescriptionDraft> {
  const desc = text.trim();
  if (!desc) {
    throw new ParsePrescriptionError('请先描述这种药');
  }
  const cfg = getLlmConfig();
  if (!cfg.baseUrl || !cfg.apiKey) {
    throw new ParsePrescriptionError(
      '请先在「设置 → AI 大模型」配置 API 地址和密钥',
      'unconfigured',
    );
  }

  const resp = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + cfg.apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: desc },
      ],
    }),
  });

  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const msg = typeof data.error === 'string'
      ? data.error
      : data.error?.message || `AI 服务出错（${resp.status}）`;
    throw new ParsePrescriptionError(msg);
  }

  const payload = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new ParsePrescriptionError('AI 返回为空');

  let raw: any;
  try {
    raw = JSON.parse(content);
  } catch {
    // 兜底：尝试从代码块抽 JSON
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new ParsePrescriptionError('AI 返回的不是 JSON');
    raw = JSON.parse(m[0]);
  }
  return normalize(raw);
}

function normalize(raw: any): PrescriptionDraft {
  const validSlots: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
  const validMeal: MealRel[] = ['before', 'after', 'with'];

  // slots：兼容老模型可能还返回 with_meal —— 自动迁移到 noon + mealRels 加 with
  let slots: Slot[] = [];
  const mealSet = new Set<MealRel>();
  if (Array.isArray(raw.slots)) {
    const seen = new Set<Slot>();
    for (const s of raw.slots as unknown[]) {
      if (typeof s !== 'string') continue;
      if (s === 'with_meal') {
        seen.add('noon');
        mealSet.add('with');
        continue;
      }
      if (validSlots.includes(s as Slot)) seen.add(s as Slot);
    }
    slots = [...seen];
  }

  const slotTimes: Partial<Record<Slot, string>> = {};
  if (raw.slotTimes && typeof raw.slotTimes === 'object') {
    for (const s of validSlots) {
      const v = raw.slotTimes[s];
      if (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v)) slotTimes[s] = v;
    }
  }
  // 给选中的时段但 AI 没给时间的，填默认值
  for (const s of slots) if (!slotTimes[s]) slotTimes[s] = SLOT_DEFAULT_TIME[s];

  // mealRels：兼容老模型可能返回单值 mealRel
  if (Array.isArray(raw.mealRels)) {
    for (const mr of raw.mealRels as unknown[]) {
      if (typeof mr === 'string' && validMeal.includes(mr as MealRel)) {
        mealSet.add(mr as MealRel);
      }
    }
  } else if (typeof raw.mealRel === 'string') {
    const mr = raw.mealRel;
    if (validMeal.includes(mr as MealRel)) mealSet.add(mr as MealRel);
  }
  // 按规范化顺序输出
  const mealRels: MealRel[] = (['before', 'with', 'after'] as MealRel[]).filter((m) => mealSet.has(m));
  const mealRelsBySlot = normalizeMealRelsBySlot(raw.mealRelsBySlot, slots, mealRels);
  const finalMealRels = mealRelsFromBySlot(mealRelsBySlot);

  let daysOfWeek: number[] = [];
  if (Array.isArray(raw.daysOfWeek)) {
    const seen = new Set<number>();
    for (const d of raw.daysOfWeek as unknown[]) {
      if (Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) {
        seen.add(d as number);
      }
    }
    daysOfWeek = [...seen].sort((a, b) => a - b);
  }

  const confidence = typeof raw.confidence === 'number'
    ? Math.min(1, Math.max(0, raw.confidence))
    : 0.6;

  return {
    name: String(raw.name || '').trim(),
    dosageText: String(raw.dosageText || '').trim(),
    amountPerDose: String(raw.amountPerDose || '').trim(),
    slots,
    slotTimes,
    mealRels: finalMealRels.length > 0 ? finalMealRels : mealRels,
    mealRelsBySlot,
    daysOfWeek,
    notes: String(raw.notes || '').trim(),
    confidence,
  };
}
