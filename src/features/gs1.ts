// GS1 解析：从扫码原始串中抽出产品标识 GTIN(01) 等应用标识符。
//
// 背景：药品追溯码(GS1 DataMatrix)载荷由若干“应用标识符(AI)+数据”拼成，
// 变长字段之间用 FNC1(group separator, ASCII 29 / \x1d) 分隔。
// 浏览器扫码库(BarcodeDetector / zxing)只返回原始串，不解析 AI，需自己拆。
//
// 关键诉求：匹配“产品”应取 GTIN(01)、丢弃序列号(21)，因为药品“一盒一码”——
// 同一种药每盒的 21 序列号都不同，只有 01 的 GTIN 才是“同规格同一码”。

const GS = '\x1d'; // FNC1 / Group Separator

/** 定长 AI 的数据长度（不含 AI 本身）。未列出的视为变长，需用 GS 截断。 */
const FIXED_LEN: Record<string, number> = {
  '00': 18,
  '01': 14, // GTIN
  '02': 14,
  '03': 14,
  '04': 16,
  '11': 6, // 生产日期 YYMMDD
  '12': 6,
  '13': 6,
  '15': 6, // 最佳食用期
  '16': 6,
  '17': 6, // 有效期 YYMMDD
  '20': 2,
};

export interface Gs1Parsed {
  /** 解析出的 AI -> 值 */
  ais: Record<string, string>;
  /** GTIN(01)，若有 */
  gtin?: string;
  /** 序列号(21)，若有（仅展示用，不作产品键） */
  serial?: string;
  /** 有效期(17) 原始 YYMMDD */
  expiry?: string;
  /** 批号(10) */
  lot?: string;
}

/** 判断是否“疑似 GS1”载荷（含 FNC1，或以已知 AI 开头且足够长） */
export function looksLikeGs1(raw: string): boolean {
  if (raw.includes(GS)) return true;
  // 去掉可能的符号标识前缀 ]d2 / ]C1 / ]Q3 等
  const s = stripSymbologyId(raw);
  return /^01\d{14}/.test(s) || /^00\d{18}/.test(s);
}

function stripSymbologyId(raw: string): string {
  // ZXing 有时返回形如 "]d2" + 数据的符号标识；BarcodeDetector 通常不带。
  return raw.replace(/^\][A-Za-z]\d/, '');
}

/** 解析 GS1 载荷为 AI 字典。无法解析的返回 null。 */
export function parseGs1(raw: string): Gs1Parsed | null {
  let s = stripSymbologyId(raw);
  // 开头若有一个 FNC1，去掉
  if (s.startsWith(GS)) s = s.slice(1);
  if (!/^\d{2}/.test(s)) return null;

  const ais: Record<string, string> = {};
  let i = 0;
  let guard = 0;
  while (i < s.length && guard++ < 64) {
    // AI 通常 2~4 位；先尝试 2 位（覆盖药品常用的 01/17/10/21）
    const ai2 = s.slice(i, i + 2);
    const ai = ai2;
    i += 2;
    const fixed = FIXED_LEN[ai];
    if (fixed !== undefined) {
      ais[ai] = s.slice(i, i + fixed);
      i += fixed;
    } else {
      // 变长：读到下一个 GS 或串尾
      const gsIdx = s.indexOf(GS, i);
      if (gsIdx === -1) {
        ais[ai] = s.slice(i);
        i = s.length;
      } else {
        ais[ai] = s.slice(i, gsIdx);
        i = gsIdx + 1;
      }
    }
  }

  if (Object.keys(ais).length === 0) return null;
  return {
    ais,
    gtin: ais['01'],
    serial: ais['21'],
    expiry: ais['17'],
    lot: ais['10'],
  };
}

/** 解析失败时的产品键 */
export interface ProductKey {
  /** 'gtin' = 取到 GTIN（强信号）；'raw' = 整码兜底（弱信号） */
  kind: 'gtin' | 'raw';
  value: string;
  parsed?: Gs1Parsed;
}

/**
 * 从任意扫码结果归一化出“产品键”用于匹配：
 * - GS1 → GTIN(01)
 * - 纯数字 EAN-13/8 商品条码 → 整码即产品键
 * - 20 位监管码 / 其它 → raw 兜底
 */
export function toProductKey(raw: string): ProductKey {
  const trimmed = raw.trim();
  if (looksLikeGs1(trimmed)) {
    const parsed = parseGs1(trimmed);
    if (parsed?.gtin) {
      return { kind: 'gtin', value: normalizeGtin(parsed.gtin), parsed };
    }
    if (parsed) return { kind: 'raw', value: trimmed.replace(/\x1d/g, ''), parsed };
  }
  // 商品条码：EAN-13 / EAN-8 / UPC-A
  if (/^\d{8}$|^\d{12,14}$/.test(trimmed)) {
    return { kind: 'gtin', value: normalizeGtin(trimmed) };
  }
  // 其它（20 位监管码、含字母进口码、自印码）
  return { kind: 'raw', value: trimmed };
}

/** GTIN 归一化为 14 位（左补 0），便于 EAN-13 与 GS1(01) 互相匹配 */
export function normalizeGtin(g: string): string {
  const digits = g.replace(/\D/g, '');
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, '0');
}

/** 把 YYMMDD 转成可读 “20YY-MM-DD”（DD 为 00 视为当月最后一天，按 GS1 约定显示为 --） */
export function formatExpiry(yymmdd?: string): string | undefined {
  if (!yymmdd || yymmdd.length !== 6) return undefined;
  const yy = yymmdd.slice(0, 2);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return `20${yy}-${mm}-${dd === '00' ? '末' : dd}`;
}
