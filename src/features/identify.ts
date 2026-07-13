// 多信号匹配编排（M1 实现 Tier1 码匹配 + 学习闭环写回；Tier2/3 OCR/pHash 在 M4 接入）
import { listMeds, putMed, getMed } from '../db/local';
import { normalizeGtin, toProductKey, type ProductKey } from './gs1';
import { findClosest } from './phash';
import type { Medication } from '../db/schema';

export interface MatchResult {
  key: ProductKey;
  /** 命中的药（Tier1 唯一命中） */
  med?: Medication;
}

/** 扫码 → 归一化产品键 → 在各药 identity 中查命中 */
export async function identifyByCode(raw: string): Promise<MatchResult> {
  const key = toProductKey(raw);
  const meds = await listMeds();
  const med = findByKey(meds, key);
  return { key, med };
}

function findByKey(meds: Medication[], key: ProductKey): Medication | undefined {
  if (key.kind === 'gtin') {
    const norm = normalizeGtin(key.value);
    return meds.find((m) => m.identity.gtins.some((g) => normalizeGtin(g) === norm));
  }
  // raw 兜底：整码精确匹配
  return meds.find((m) => m.identity.rawCodes.includes(key.value));
}

/** 学习闭环：把这次扫到的码绑定到指定药，下次直接命中 */
export async function bindCodeToMed(medId: string, key: ProductKey): Promise<void> {
  const meds = await listMeds();
  const med = meds.find((m) => m.id === medId);
  if (!med) return;
  if (key.kind === 'gtin') {
    const norm = normalizeGtin(key.value);
    if (!med.identity.gtins.some((g) => normalizeGtin(g) === norm)) {
      med.identity.gtins.push(key.value);
    }
  } else {
    if (!med.identity.rawCodes.includes(key.value)) {
      med.identity.rawCodes.push(key.value);
    }
  }
  await putMed(med);
}

export interface IdentitySignals {
  gtins?: string[];
  rawCodes?: string[];
  ocrNames?: string[];
  photoHashes?: string[];
}

/** 把一组识别证据合并到指定药的 identity 上（去重；不覆盖名字/规格等用户字段） */
export async function augmentIdentity(medId: string, signals: IdentitySignals): Promise<void> {
  const med = await getMed(medId);
  if (!med) return;
  if (signals.gtins?.length) {
    const has = new Set(med.identity.gtins.map(normalizeGtin));
    for (const g of signals.gtins) {
      if (!has.has(normalizeGtin(g))) med.identity.gtins.push(g);
    }
  }
  if (signals.rawCodes?.length) {
    const has = new Set(med.identity.rawCodes);
    for (const c of signals.rawCodes) if (!has.has(c)) med.identity.rawCodes.push(c);
  }
  if (signals.ocrNames?.length) {
    const has = new Set(med.identity.ocrNames);
    for (const n of signals.ocrNames) if (!has.has(n)) med.identity.ocrNames.push(n);
  }
  if (signals.photoHashes?.length) {
    const has = new Set(med.identity.photoHashes);
    for (const h of signals.photoHashes) if (!has.has(h)) med.identity.photoHashes.push(h);
  }
  await putMed(med);
}

/** 用照片感知哈希找最相似的本地药；距离 ≤ MAX_SIMILAR 视为相似 */
export const MAX_SIMILAR_DISTANCE = 10;
export async function findMedByPhotoHash(
  hash: string,
): Promise<{ med: Medication; distance: number } | null> {
  const meds = await listMeds();
  let best: { med: Medication; distance: number } | null = null;
  for (const m of meds) {
    if (!m.identity.photoHashes.length) continue;
    const c = findClosest(hash, m.identity.photoHashes);
    if (!c) continue;
    if (!best || c.distance < best.distance) best = { med: m, distance: c.distance };
  }
  if (!best || best.distance > MAX_SIMILAR_DISTANCE) return null;
  return best;
}
