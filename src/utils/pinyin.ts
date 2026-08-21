/**
 * 拼音首字母提取与模糊匹配工具（零依赖、轻量、医药专用优化）
 */

const collator = new Intl.Collator('zh-Hans-CN');

const PINYIN_BOUNDARIES: readonly [string, string][] = [
  ['a', '啊'], ['b', '芭'], ['c', '擦'], ['d', '搭'], ['e', '蛾'],
  ['f', '发'], ['g', '噶'], ['h', '哈'], ['j', '击'], ['k', '喀'],
  ['l', '垃'], ['m', '妈'], ['n', '拿'], ['o', '噢'], ['p', '啪'],
  ['q', '期'], ['r', '然'], ['s', '撒'], ['t', '塌'], ['w', '挖'],
  ['x', '昔'], ['y', '压'], ['z', '匝'],
];

/** 常见医药多音字与特殊字的首字母映射表 */
const OVERRIDES: Readonly<Record<string, string>> = {
  阿: 'a', 西: 'x', 莫: 'm', 汀: 't', 唑: 'z', 胺: 'a', 酯: 'z', 胍: 'g',
  肽: 't', 酚: 'f', 氯: 'l', 氨: 'a', 肟: 'w', 缬: 'x', 沙: 's', 坦: 't',
  替: 't', 普: 'p', 利: 'l', 洛: 'l', 索: 's', 倍: 'b', 他: 't', 卡: 'k',
  地: 'd', 平: 'p', 片: 'p', 囊: 'n', 胶: 'j', 丸: 'w', 散: 's', 栓: 's',
  雷: 'l', 定: 'd', 醇: 'c', 酸: 's', 钠: 'n', 钙: 'g', 钾: 'j', 镁: 'm',
  锌: 'x', 铁: 't', 糖: 't', 浆: 'j', 膏: 'g', 贴: 't', 滴: 'd', 剂: 'j',
  素: 's', 维: 'w', 生: 's', 霉: 'm', 菌: 'j', 抑: 'y', 帕: 'p', 托: 't',
};

/**
 * 提取单个字符的首字母
 */
export function getCharInitial(char: string): string {
  if (!char) return '';
  if (OVERRIDES[char]) return OVERRIDES[char];
  if (/[a-zA-Z0-9]/.test(char)) return char.toLowerCase();
  
  for (let i = PINYIN_BOUNDARIES.length - 1; i >= 0; i--) {
    const boundary = PINYIN_BOUNDARIES[i];
    if (boundary && collator.compare(char, boundary[1]) >= 0) {
      return boundary[0];
    }
  }
  return char.toLowerCase();
}

/**
 * 提取整个字符串的拼音首字母缩写（如 "阿莫西林胶囊" -> "amxljn"）
 */
export function toPinyinInitials(text: string): string {
  if (!text) return '';
  let initials = '';
  for (const char of text) {
    initials += getCharInitial(char);
  }
  return initials;
}

/**
 * 检查文本是否匹配查询词（支持中文字符串子串匹配、拼音首字母匹配）
 */
export function matchPinyinOrText(target: string | undefined | null, query: string): boolean {
  if (!target) return false;
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;
  
  const lowerTarget = target.toLowerCase();
  // 1. 原文直接包含（汉字/英文）
  if (lowerTarget.includes(cleanQuery)) return true;
  
  // 2. 拼音首字母缩写匹配（如 "amxl" 匹配 "阿莫西林"）
  const initials = toPinyinInitials(target);
  if (initials.includes(cleanQuery)) return true;

  return false;
}
