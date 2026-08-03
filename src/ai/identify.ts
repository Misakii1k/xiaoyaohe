// 拍照识药：使用用户自带的 OpenAI 兼容 LLM，与云同步解耦。
import { normalizeMealRelsBySlot, mealRelsFromBySlot, type Slot, type MealRel, type MealRelsBySlot, type MedicationInventory } from '../db/schema';
import { getLlmRouteCandidates, type LlmProvider } from './llmConfig';
import { hasAiConsent, requireAiConsent, type AiDataKind } from './consent';

export type IdentifyMode = 'medicine_box' | 'prescription_sheet' | 'medication_batch' | 'inventory';

/**
 * 一次识别会话：按优先级携带全部候选服务商，单个请求失败时顺延到下一家。
 * baseUrl/apiKey/model 保持为当前服务商，兼容旧调用方读字段的习惯。
 */
export interface IdentifySession {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
  providers: readonly LlmProvider[];
  /** 下一家候选；没有则返回 false，表示顺延已用完。 */
  advance(): boolean;
}

export interface IdentifyRequestOptions {
  signal?: AbortSignal;
  session?: IdentifySession;
}

export interface IdentifyResult {
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  /** 与进餐关系（可多选；空数组 = 不限） */
  mealRels: MealRel[];
  /** 按早中晚/睡前绑定的餐前、餐中、餐后 */
  mealRelsBySlot: MealRelsBySlot;
  evidence: {
    ocrNames: string[];
    gtins: string[];
    rawCodes: string[];
  };
  confidence: number;
}

export interface PrescriptionItemDraft {
  name: string;
  dosageText: string;
  amountPerDose: string;
  slots: Slot[];
  mealRels: MealRel[];
  mealRelsBySlot: MealRelsBySlot;
  notes: string;
  confidence: number;
}

export interface PrescriptionSheetResult {
  items: PrescriptionItemDraft[];
  confidence: number;
}

export interface InventoryIdentifyResult {
  name: string;
  inventory: MedicationInventory;
  evidence: {
    ocrNames: string[];
    rawText: string;
  };
  confidence: number;
}

export class IdentifyError extends Error {
  constructor(message: string, public hint?: string) {
    super(message);
  }
}

const VALID_SLOTS: Slot[] = ['morning', 'noon', 'evening', 'bedtime'];
const VALID_MEAL: MealRel[] = ['before', 'with', 'after'];

const EMPTY_EVIDENCE = '{"ocrNames":[],"gtins":[],"rawCodes":[]}';

const PROMPTS: Record<IdentifyMode, string> = {
  medicine_box:
    '你是医药包装识别助手。看一张药盒/药品照片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '只识别药名、规格、每次剂量、服药时段、餐食关系和可见码值；不确定字段留空。' +
    'JSON 形如：' +
    '{"name":"通用名，必填；认不出填空字符串","dosageText":"规格，如 100mg/片、20片/盒；不知道填空字符串","amountPerDose":"每次用量，如 1片；包装没有医嘱则填空字符串","slots":["morning","noon","evening","bedtime"],"mealRels":["before","with","after"],"mealRelsBySlot":{"morning":["before"],"noon":["with"],"evening":["after"]},"evidence":' +
    EMPTY_EVIDENCE +
    ',"confidence":0-1}' +
    '。mealRelsBySlot 用于精确表达早餐前、午餐中、晚餐后；无法识别药品时返回 name 空、slots 空、mealRelsBySlot 空。',
  prescription_sheet:
    '你是药单识别助手。看一张处方、药单、分药清单或相册上传图片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '把其中每种药分成数组 items，只识别药名、规格、每次剂量、服药时段、餐食关系和必要备注；不确定字段留空。' +
    'JSON 形如：{"items":[{"name":"药名","dosageText":"规格","amountPerDose":"每次用量","slots":["morning","noon","evening","bedtime"],"mealRels":["before","with","after"],"mealRelsBySlot":{"morning":["before"],"noon":["with"],"evening":["after"]},"notes":"备注","confidence":0-1}],"confidence":0-1}。',
  medication_batch:
    '你是药品批量识别助手。看一张处方、药单、药盒或标签照片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '把其中每种药分成数组 items，只识别药名、规格、每次剂量、服药时段、餐食关系和必要备注；不确定字段留空。' +
    'JSON 形如：{"items":[{"name":"药名","dosageText":"规格","amountPerDose":"每次用量","slots":["morning","noon","evening","bedtime"],"mealRels":["before","with","after"],"mealRelsBySlot":{"morning":["before"],"noon":["with"],"evening":["after"]},"notes":"备注","confidence":0-1}],"confidence":0-1}。',
  inventory:
    '你是药品库存识别助手。看一张购药票据、药盒侧面、药瓶标签或药品照片，仅输出严格 JSON，不要 markdown、不要解释。' +
    '目标是辅助填写剩余药量，只识别药名、包装量、单位、可推断的剩余量和来源说明；不确定字段留空或 0。' +
    'JSON 形如：{"name":"药名","inventory":{"remaining":0,"unit":"片/粒/袋/mL 等","packageQuantity":0,"lowThreshold":0,"sourceNote":"从图片看到或推断的依据"},"evidence":{"ocrNames":[],"rawText":"图片中可读到的关键文字"},"confidence":0-1}。',
};

export async function identifyByBlob(
  blob: Blob,
  hint?: string,
  mode: IdentifyMode = 'medicine_box',
  options?: IdentifyRequestOptions,
): Promise<IdentifyResult> {
  return requestIdentify<IdentifyResult>(blob, mode, hint, options);
}

export async function identifyPrescriptionSheetByBlob(
  blob: Blob,
  hint?: string,
  options?: IdentifyRequestOptions,
): Promise<PrescriptionSheetResult> {
  return requestIdentify<PrescriptionSheetResult>(blob, 'prescription_sheet', hint, options);
}

export async function identifyMedicationBatchByBlob(
  blob: Blob,
  hint?: string,
  options?: IdentifyRequestOptions,
): Promise<PrescriptionSheetResult> {
  return requestIdentify<PrescriptionSheetResult>(blob, 'medication_batch', hint, options);
}

export async function identifyInventoryByBlob(blob: Blob, hint?: string, options?: IdentifyRequestOptions): Promise<InventoryIdentifyResult> {
  return requestIdentify<InventoryIdentifyResult>(blob, 'inventory', hint, options);
}

/** 顺延用：可恢复的失败（网络/超时/5xx/429/401/403）带上 retryable 标记。 */
export class IdentifyRetryableError extends IdentifyError {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Gets consent once and returns a reusable session for multi-image queues.
 * _mode 仅保留签名兼容调用方（MedBatchAdd 等），会话不绑定识别模式。 */
export async function createIdentifySession(_mode: IdentifyMode, kind: AiDataKind = 'medicine-photo'): Promise<IdentifySession> {
  const candidates = getLlmRouteCandidates();
  if (candidates.length === 0) {
    throw new IdentifyError(
      '请先在「设置 → AI 大模型」配置 API 地址和密钥。',
      'unconfigured',
    );
  }
  // 当前供应商是用户明确选择的：先确认一次同意；顺延候选未同意时直接跳过。
  await requireAiConsent(kind, candidates[0]!.baseUrl);
  const usable = candidates.filter((provider, index) =>
    Boolean(provider.baseUrl && provider.apiKey)
    && (index === 0 || hasAiConsent(kind, provider.baseUrl)),
  );
  if (usable.length === 0) throw new IdentifyError('所有 AI 服务商都还没有密钥或外发授权。', 'unconfigured');
  let index = 0;
  const current = (): LlmProvider => usable[Math.min(index, usable.length - 1)]!;
  return {
    get baseUrl() { return current().baseUrl; },
    get apiKey() { return current().apiKey; },
    get model() { return current().model; },
    get label() { return current().label; },
    providers: usable,
    advance() {
      if (index + 1 >= usable.length) return false;
      index += 1;
      return true;
    },
  };
}

// 口述录药：把老人随口说的一段话整理成与药单识别相同的 items 结构
const SPEECH_PROMPT =
  '你是用药录入助手。用户会口述（或打字）自己在吃的药，语句可能口语化、有停顿词。' +
  '把其中每种药整理成数组 items，仅输出严格 JSON，不要 markdown、不要解释。' +
  '只提取药名、规格、每次剂量、服药时段、餐食关系和必要备注；没说到的字段留空，不要编造。' +
  '口语对应关系：早上/早饭=morning，中午/午饭=noon，晚上/晚饭=evening，睡前=bedtime；' +
  '"早晚各一片"表示 morning 和 evening 各 1片；"饭前/随餐/饭后"对应 before/with/after。' +
  'JSON 形如：{"items":[{"name":"药名","dosageText":"规格","amountPerDose":"每次用量","slots":["morning","noon","evening","bedtime"],"mealRels":["before","with","after"],"mealRelsBySlot":{"morning":["before"]},"notes":"备注","confidence":0-1}],"confidence":0-1}。';

/** 把口述/手打的用药描述解析成批量建档草稿；复用药单识别的数据结构 */
export async function parseMedicationSpeech(
  text: string,
  options: IdentifyRequestOptions = {},
): Promise<PrescriptionSheetResult> {
  throwIfAborted(options.signal);
  const session = options.session ?? await createIdentifySession('prescription_sheet', 'prescription');
  let lastError: IdentifyError | undefined;
  for (;;) {
    try {
      const resp = await fetchWithTimeout(session.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + session.apiKey,
        },
        body: JSON.stringify({
          model: session.model,
          messages: [
            { role: 'system', content: SPEECH_PROMPT },
            { role: 'user', content: `请整理这段用药描述：${text}` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      }, options.signal);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: { message?: string } | string };
        const msg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || `AI 服务出错（${resp.status}）`;
        if (resp.status === 401 || resp.status === 403 || resp.status === 404
          || resp.status === 429 || resp.status >= 500) {
          throw new IdentifyRetryableError(msg, resp.status);
        }
        throw new IdentifyError(msg);
      }
      const payload = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = payload.choices?.[0]?.message?.content ?? '';
      const parsed = tryParseJson(raw);
      if (!parsed) throw new IdentifyError('AI 返回无法解析');
      return normalizePrescriptionSheet(parsed);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const retryable = error instanceof IdentifyRetryableError
        || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      lastError = error instanceof IdentifyError ? error : new IdentifyError('AI 请求失败');
      if (!retryable || !session.advance()) throw lastError;
    }
  }
}

// 口述库存：把"阿司匹林还剩5片，二甲双胍刚买了一盒20片"整理成药名 + 库存字段
const INVENTORY_SPEECH_PROMPT =
  '你是药品库存录入助手。用户会口述（或打字）手头药品的剩余情况，语句可能口语化、有停顿词。' +
  '把其中每种药整理成数组 items，仅输出严格 JSON，不要 markdown、不要解释。' +
  '只提取药名、剩余数量、单位、一盒/一瓶有多少、剩多少时提醒买药；没说到的字段留空或 0，不要编造。' +
  '口语对应关系："片/粒/袋/粒/mL"等是单位；"还剩5片"=remaining 5、unit 片；"一盒20片"=packageQuantity 20；' +
  '"剩3天的量"=remaining 按天推算或留 0 并在 sourceNote 注明；"快没了/该买了"=lowThreshold 给一个保守值。' +
  'JSON 形如：{"items":[{"name":"药名","inventory":{"remaining":0,"unit":"片","packageQuantity":0,"lowThreshold":0,"sourceNote":"从口述推断的依据"},"confidence":0-1}],"confidence":0-1}。';

export interface InventorySpeechResult {
  items: InventorySpeechItem[];
  confidence: number;
}

export interface InventorySpeechItem {
  name: string;
  inventory: MedicationInventory;
  confidence: number;
}

/** 把口述/手打的库存描述解析成多条库存草稿；复用 identifyInventory 的归一化。 */
export async function parseInventorySpeech(
  text: string,
  options: IdentifyRequestOptions = {},
): Promise<InventorySpeechResult> {
  throwIfAborted(options.signal);
  const session = options.session ?? await createIdentifySession('inventory', 'prescription');
  let lastError: IdentifyError | undefined;
  for (;;) {
    try {
      const resp = await fetchWithTimeout(session.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + session.apiKey,
        },
        body: JSON.stringify({
          model: session.model,
          messages: [
            { role: 'system', content: INVENTORY_SPEECH_PROMPT },
            { role: 'user', content: `请整理这段库存描述：${text}` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      }, options.signal);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: { message?: string } | string };
        const msg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || `AI 服务出错（${resp.status}）`;
        if (resp.status === 401 || resp.status === 403 || resp.status === 404
          || resp.status === 429 || resp.status >= 500) {
          throw new IdentifyRetryableError(msg, resp.status);
        }
        throw new IdentifyError(msg);
      }
      const payload = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = payload.choices?.[0]?.message?.content ?? '';
      const parsed = tryParseJson(raw);
      if (!parsed) throw new IdentifyError('AI 返回无法解析');
      const items = normalizeInventorySpeech(parsed);
      return { items, confidence: conf(parsed.confidence) };
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const retryable = error instanceof IdentifyRetryableError
        || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      lastError = error instanceof IdentifyError ? error : new IdentifyError('AI 请求失败');
      if (!retryable || !session.advance()) throw lastError;
    }
  }
}

function normalizeInventorySpeech(raw: Record<string, unknown>): InventorySpeechItem[] {
  const list = Array.isArray(raw.items) ? raw.items : [];
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const obj = entry as Record<string, unknown>;
    const inv = normalizeInventory(obj);
    return [{ name: str(obj.name), inventory: inv.inventory, confidence: conf(obj.confidence) }];
  });
}

async function requestIdentify<T>(blob: Blob, mode: IdentifyMode, hint?: string, options: IdentifyRequestOptions = {}): Promise<T> {
  throwIfAborted(options.signal);
  // 压到 1280 长边，质量 0.8，尽量小但保留药盒细节
  const shrunk = await downscaleToJpeg(blob, 1280, 0.8);
  throwIfAborted(options.signal);
  const base64 = await blobToBase64(shrunk);
  return requestLocalLlm<T>(base64, mode, hint, options.session ?? await createIdentifySession(mode), options.signal);
}

async function requestLocalLlm<T>(base64: string, mode: IdentifyMode, hint: string | undefined, session: IdentifySession, signal?: AbortSignal): Promise<T> {
  const userText = hint
    ? `请按 ${mode} 模式识别这张图片。补充提示：${hint}`
    : `请按 ${mode} 模式识别这张图片。`;
  let lastError: IdentifyError | undefined;
  for (;;) {
    try {
      const resp = await fetchWithTimeout(session.baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + session.apiKey,
        },
        body: JSON.stringify({
          model: session.model,
          messages: [
            { role: 'system', content: PROMPTS[mode] },
            {
              role: 'user',
              content: [
                { type: 'text', text: userText },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      }, signal);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: { message?: string } | string };
        const msg = typeof data.error === 'string'
          ? data.error
          : data.error?.message || `AI 服务出错（${resp.status}）`;
        if (resp.status === 401 || resp.status === 403 || resp.status === 404
          || resp.status === 429 || resp.status >= 500) {
          throw new IdentifyRetryableError(msg, resp.status);
        }
        throw new IdentifyError(msg);
      }
      const payload = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
      const raw = payload.choices?.[0]?.message?.content ?? '';
      const parsed = tryParseJson(raw);
      if (!parsed) throw new IdentifyError('AI 返回无法解析');
      return normalizeResult(parsed, mode) as T;
    } catch (error) {
      if (signal?.aborted) throw error;
      const retryable = error instanceof IdentifyRetryableError
        || (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'));
      lastError = error instanceof IdentifyError ? error : new IdentifyError('AI 请求失败');
      if (!retryable || !session.advance()) throw lastError;
    }
  }
}

function normalizeResult(raw: Record<string, unknown>, mode: IdentifyMode): IdentifyResult | PrescriptionSheetResult | InventoryIdentifyResult {
  if (mode === 'prescription_sheet' || mode === 'medication_batch') return normalizePrescriptionSheet(raw);
  if (mode === 'inventory') return normalizeInventory(raw);
  return normalizeMedicineBox(raw);
}

function normalizeMedicineBox(raw: Record<string, unknown>): IdentifyResult {
  const slots = normalizeSlots(raw.slots);
  const mealRels = normalizeMealRels(raw.mealRels ?? (raw as any).mealRel);
  const bySlot = normalizeMealRelsBySlot(raw.mealRelsBySlot, slots, mealRels);
  const evidence = asObject(raw.evidence);
  return {
    name: str(raw.name),
    dosageText: str(raw.dosageText),
    amountPerDose: str(raw.amountPerDose),
    slots,
    mealRels: mealRelsFromBySlot(bySlot),
    mealRelsBySlot: bySlot,
    evidence: {
      ocrNames: strArr(evidence.ocrNames),
      gtins: strArr(evidence.gtins),
      rawCodes: strArr(evidence.rawCodes),
    },
    confidence: conf(raw.confidence),
  };
}

function normalizePrescriptionSheet(raw: Record<string, unknown>): PrescriptionSheetResult {
  const items: PrescriptionItemDraft[] = [];
  for (const item of Array.isArray(raw.items) ? raw.items : []) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const name = str(obj.name);
    if (!name) continue;
    const slots = normalizeSlots(obj.slots);
    const mealRels = normalizeMealRels(obj.mealRels ?? (obj as any).mealRel);
    const bySlot = normalizeMealRelsBySlot(obj.mealRelsBySlot, slots, mealRels);
    items.push({
      name,
      dosageText: str(obj.dosageText),
      amountPerDose: str(obj.amountPerDose),
      slots,
      mealRels: mealRelsFromBySlot(bySlot),
      mealRelsBySlot: bySlot,
      notes: str(obj.notes, 1000),
      confidence: conf(obj.confidence, 0.6),
    });
  }
  return { items, confidence: conf(raw.confidence, items.length ? 0.7 : 0) };
}

function normalizeInventory(raw: Record<string, unknown>): InventoryIdentifyResult {
  const inventory = asObject(raw.inventory);
  const evidence = asObject(raw.evidence);
  const inv: MedicationInventory = {
    remaining: positiveNumber(inventory.remaining),
    unit: str(inventory.unit) || '片',
  };
  const packageQuantity = positiveNumber(inventory.packageQuantity);
  const lowThreshold = positiveNumber(inventory.lowThreshold);
  if (packageQuantity > 0) inv.packageQuantity = packageQuantity;
  if (lowThreshold > 0) inv.lowThreshold = lowThreshold;
  const sourceNote = str(inventory.sourceNote);
  if (sourceNote) inv.sourceNote = sourceNote;
  return {
    name: str(raw.name),
    inventory: inv,
    evidence: {
      ocrNames: strArr(evidence.ocrNames),
      rawText: str(evidence.rawText),
    },
    confidence: conf(raw.confidence),
  };
}

function tryParseJson(s: string): Record<string, unknown> | null {
  const text = s.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const obj = JSON.parse(match[0]);
      return obj && typeof obj === 'object' ? obj as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function normalizeSlots(value: unknown): Slot[] {
  const set = new Set<Slot>();
  for (const item of Array.isArray(value) ? value : []) {
    if (item === 'with_meal') set.add('noon');
    else if (typeof item === 'string' && (VALID_SLOTS as string[]).includes(item)) set.add(item as Slot);
  }
  return VALID_SLOTS.filter((slot) => set.has(slot));
}

function normalizeMealRels(value: unknown): MealRel[] {
  const set = new Set<MealRel>();
  for (const item of Array.isArray(value) ? value : [value]) {
    if (typeof item === 'string' && (VALID_MEAL as string[]).includes(item)) set.add(item as MealRel);
  }
  return VALID_MEAL.filter((rel) => set.has(rel));
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function str(value: unknown, maxLength = 160): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function strArr(value: unknown, maxItems = 16, maxLength = 160): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, maxItems).map((item) => item.trim().slice(0, maxLength))
    : [];
}

function conf(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function fetchWithTimeout(url: string, init: RequestInit, externalSignal?: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(abort, 45_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new IdentifyRetryableError('请求超时，请检查网络后重试');
    }
    throw new IdentifyRetryableError('连不上 AI 服务，请检查网络或设置里的服务地址');
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abort);
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('识别已取消', 'AbortError');
}

/** 按比例缩到 maxSide 长边，输出 JPEG。失败回退原图 */
async function downscaleToJpeg(blob: Blob, maxSide: number, quality: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b || blob), 'image/jpeg', quality);
    });
  } catch {
    return blob;
  }
}
