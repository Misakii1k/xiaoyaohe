// 拍照识别路由：POST /api/identify
// mode=medicine_box | prescription_sheet | inventory
// 客户端发 base64 图片，Worker 转发给 OpenAI 兼容视觉模型；图片不入 KV、不留存。
import type { Env } from '../types';
import { json, getHousehold, checkSecret } from '../lib/http';

type Slot = 'morning' | 'noon' | 'evening' | 'bedtime';
type MealRel = 'before' | 'with' | 'after';
type MealRelsBySlot = Partial<Record<Slot, MealRel[]>>;
type IdentifyMode = 'medicine_box' | 'prescription_sheet' | 'inventory';

interface IdentifyBody {
  image: string;
  mimeType?: string;
  hint?: string;
  mode?: IdentifyMode;
}

export interface IdentifyResult {
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  mealRels: MealRel[];
  mealRelsBySlot: MealRelsBySlot;
  evidence: {
    ocrNames: string[];
    gtins: string[];
    rawCodes: string[];
  };
  confidence: number;
  raw?: string;
}

interface PrescriptionItemDraft {
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  mealRels: MealRel[];
  mealRelsBySlot: MealRelsBySlot;
  notes: string;
  confidence: number;
}

interface PrescriptionSheetResult {
  items: PrescriptionItemDraft[];
  confidence: number;
  raw?: string;
}

interface InventoryIdentifyResult {
  name: string;
  inventory: {
    remaining: number;
    unit: string;
    packageQuantity?: number;
    lowThreshold?: number;
    sourceNote?: string;
  };
  evidence: {
    ocrNames: string[];
    rawText: string;
  };
  confidence: number;
  raw?: string;
}

const EMPTY_EVIDENCE = '{"ocrNames":[],"gtins":[],"rawCodes":[]}';

const PROMPTS: Record<IdentifyMode, string> = {
  medicine_box:
    '你是医药包装识别助手。看一张药盒/药品照片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '只识别药名、规格、每次剂量、服药时段、餐食关系和可见码值；不确定字段留空。' +
    'JSON 形如：' +
    '{"name":"通用名，必填；认不出填空字符串","dosageText":"规格，如 100mg/片、20片/盒；不知道填空字符串","amountPerDose":"每次用量，如 1片；包装没有医嘱则填空字符串","slots":["morning","noon","evening","bedtime"],"mealRels":["before","with","after"],"mealRelsBySlot":{"morning":["before"],"noon":["with"],"evening":["after"]},"evidence":' +
    EMPTY_EVIDENCE +
    ',"confidence":0-1}' +
    '。mealRelsBySlot 用于精确表达早餐前、午餐中、晚餐后；若只知道全局餐后，可在所有已识别 slots 下填 ["after"]。无法识别药品时返回 name 空、slots 空、mealRelsBySlot 空。',
  prescription_sheet:
    '你是药单识别助手。看一张处方、药单、分药清单或相册上传图片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '把其中每种药分成数组 items，只识别药名、规格、每次剂量、服药时段、餐食关系和必要备注；不确定字段留空。' +
    'JSON 形如：{"items":[{"name":"药名","dosageText":"规格","amountPerDose":"每次用量","slots":["morning","noon","evening","bedtime"],"mealRels":["before","with","after"],"mealRelsBySlot":{"morning":["before"],"noon":["with"],"evening":["after"]},"notes":"备注","confidence":0-1}],"confidence":0-1}。' +
    '时段映射：早/早餐=morning，中/午餐=noon，晚/晚餐=evening，睡前=bedtime。餐前=before，餐中/随餐/饭中=with，餐后=after。',
  inventory:
    '你是药品库存识别助手。看一张购药票据、药盒侧面、药瓶标签或药品照片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '目标是辅助填写剩余药量，只识别药名、包装量、单位、可推断的剩余量和来源说明；不确定字段留空或 0。' +
    'JSON 形如：{"name":"药名","inventory":{"remaining":0,"unit":"片/粒/袋/mL 等","packageQuantity":0,"lowThreshold":0,"sourceNote":"从图片看到或推断的依据"},"evidence":{"ocrNames":[],"rawText":"图片中可读到的关键文字"},"confidence":0-1}。' +
    '如果只看到每盒 28 片但无法知道剩余量，remaining 填 0，packageQuantity 填 28。',
};

export async function handleIdentify(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const household = getHousehold(req);
  if (!household) return json({ error: 'bad household' }, 400);
  if (!checkSecret(req, env)) return json({ error: 'unauthorized' }, 401);

  if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL) {
    return json({ error: 'AI 未配置：请在 Worker 设置 AI_API_KEY / AI_BASE_URL / AI_MODEL' }, 503);
  }

  let body: IdentifyBody;
  try {
    body = (await req.json()) as IdentifyBody;
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  if (!body.image || typeof body.image !== 'string') {
    return json({ error: '缺少 image (base64)' }, 400);
  }
  if (body.image.length > 4 * 1024 * 1024) {
    return json({ error: '图片太大，请压缩到 3MB 以内' }, 413);
  }

  const mode = normalizeMode(body.mode);
  const mimeType = body.mimeType || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${body.image}`;
  const userText = body.hint
    ? `请按 ${mode} 模式识别这张图片。补充提示：${body.hint}`
    : `请按 ${mode} 模式识别这张图片。`;

  const upstream = await fetch(env.AI_BASE_URL.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + env.AI_API_KEY,
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages: [
        { role: 'system', content: PROMPTS[mode] },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!upstream.ok) {
    const t = await upstream.text();
    return json({ error: 'AI 调用失败', status: upstream.status, detail: t.slice(0, 500) }, 502);
  }

  const data = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const parsed = tryParseJson(raw);

  if (!parsed) {
    return json({ error: 'AI 返回无法解析', raw: raw.slice(0, 500) }, 502);
  }

  if (mode === 'prescription_sheet') return json(normalizePrescriptionSheet(parsed, raw));
  if (mode === 'inventory') return json(normalizeInventory(parsed, raw));
  return json(normalizeMedicineBox(parsed, raw));
}

function normalizeMode(mode: unknown): IdentifyMode {
  return mode === 'prescription_sheet' || mode === 'inventory' || mode === 'medicine_box'
    ? mode
    : 'medicine_box';
}

function tryParseJson(s: string): Record<string, unknown> | null {
  const t = s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const o = JSON.parse(t);
    return typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : null;
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

const VALID_SLOTS: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
const VALID_MEAL: MealRel[] = ['before', 'with', 'after'];

function normalizeMedicineBox(o: Record<string, unknown>, raw: string): IdentifyResult {
  const ev = (o.evidence as Record<string, unknown>) || {};
  const slots = normalizeSlots(o.slots);
  const mealRels = normalizeMealRels(o.mealRels ?? (o as any).mealRel);
  const mealRelsBySlot = normalizeMealRelsBySlot(o.mealRelsBySlot, slots, mealRels);
  const mergedMealRels = mealRelsFromBySlot(mealRelsBySlot, mealRels);

  return {
    name: str(o.name),
    dosageText: str(o.dosageText),
    amountPerDose: str(o.amountPerDose),
    slots,
    mealRels: mergedMealRels,
    mealRelsBySlot,
    evidence: {
      ocrNames: strArr(ev.ocrNames),
      gtins: strArr(ev.gtins),
      rawCodes: strArr(ev.rawCodes),
    },
    confidence: conf(o.confidence),
    raw: raw.slice(0, 1000),
  };
}

function normalizePrescriptionSheet(o: Record<string, unknown>, raw: string): PrescriptionSheetResult {
  const source = Array.isArray(o.items) ? o.items : [];
  const items: PrescriptionItemDraft[] = [];
  for (const item of source) {
    if (!item || typeof item !== 'object') continue;
    const x = item as Record<string, unknown>;
    const slots = normalizeSlots(x.slots);
    const mealRels = normalizeMealRels(x.mealRels ?? (x as any).mealRel);
    const mealRelsBySlot = normalizeMealRelsBySlot(x.mealRelsBySlot, slots, mealRels);
    const name = str(x.name);
    if (!name) continue;
    items.push({
      name,
      dosageText: str(x.dosageText),
      amountPerDose: str(x.amountPerDose),
      slots,
      mealRels: mealRelsFromBySlot(mealRelsBySlot, mealRels),
      mealRelsBySlot,
      notes: str(x.notes),
      confidence: conf(x.confidence, 0.6),
    });
  }
  return { items, confidence: conf(o.confidence, items.length ? 0.7 : 0), raw: raw.slice(0, 1000) };
}

function normalizeInventory(o: Record<string, unknown>, raw: string): InventoryIdentifyResult {
  const inv = (o.inventory as Record<string, unknown>) || {};
  const ev = (o.evidence as Record<string, unknown>) || {};
  const remaining = positiveNumber(inv.remaining);
  const packageQuantity = positiveNumber(inv.packageQuantity);
  const lowThreshold = positiveNumber(inv.lowThreshold);
  const out: InventoryIdentifyResult = {
    name: str(o.name),
    inventory: {
      remaining,
      unit: str(inv.unit) || '片',
      sourceNote: str(inv.sourceNote),
    },
    evidence: {
      ocrNames: strArr(ev.ocrNames),
      rawText: str(ev.rawText),
    },
    confidence: conf(o.confidence),
    raw: raw.slice(0, 1000),
  };
  if (packageQuantity > 0) out.inventory.packageQuantity = packageQuantity;
  if (lowThreshold > 0) out.inventory.lowThreshold = lowThreshold;
  return out;
}

function normalizeSlots(v: unknown): Slot[] {
  const set = new Set<Slot>();
  if (!Array.isArray(v)) return [];
  for (const x of v) {
    if (x === 'with_meal') {
      set.add('noon');
      continue;
    }
    if (typeof x === 'string' && (VALID_SLOTS as string[]).includes(x)) set.add(x as Slot);
  }
  return VALID_SLOTS.filter((s) => set.has(s));
}

function normalizeMealRels(v: unknown): MealRel[] {
  const values = Array.isArray(v) ? v : [v];
  const set = new Set<MealRel>();
  for (const x of values) {
    if (typeof x === 'string' && (VALID_MEAL as string[]).includes(x)) set.add(x as MealRel);
  }
  return VALID_MEAL.filter((m) => set.has(m));
}

function normalizeMealRelsBySlot(v: unknown, slots: Slot[], fallback: MealRel[]): MealRelsBySlot {
  const out: MealRelsBySlot = {};
  const obj = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  for (const s of VALID_SLOTS) {
    if (!slots.includes(s)) continue;
    const rels = normalizeMealRels(obj[s]);
    if (rels.length) out[s] = rels;
    else if (fallback.length) out[s] = [...fallback];
  }
  return out;
}

function mealRelsFromBySlot(bySlot: MealRelsBySlot, fallback: MealRel[]): MealRel[] {
  const set = new Set<MealRel>(fallback);
  for (const s of VALID_SLOTS) {
    for (const rel of bySlot[s] ?? []) set.add(rel);
  }
  return VALID_MEAL.filter((m) => set.has(m));
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim());
}

function conf(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? Math.max(0, Math.min(1, v)) : fallback;
}

function positiveNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}
