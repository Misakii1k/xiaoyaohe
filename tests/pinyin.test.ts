import { describe, expect, it } from 'vitest';
import { getCharInitial, toPinyinInitials, matchPinyinOrText } from '../src/utils/pinyin';

describe('pinyin utility', () => {
  it('extracts correct pinyin initials for common medication names', () => {
    expect(toPinyinInitials('阿莫西林胶囊')).toBe('amxljn');
    expect(toPinyinInitials('氨氯地平片')).toBe('aldpp');
    expect(toPinyinInitials('布洛芬缓释胶囊')).toBe('blfhsjn');
    expect(toPinyinInitials('维生素C')).toBe('wssc');
    expect(toPinyinInitials('二甲双胍')).toBe('ejsg');
    expect(toPinyinInitials('对乙酰氨基酚')).toBe('dyxajf');
  });

  it('matches chinese characters directly and via pinyin initials', () => {
    // Exact & partial Chinese
    expect(matchPinyinOrText('阿莫西林胶囊', '阿莫')).toBe(true);
    expect(matchPinyinOrText('阿莫西林胶囊', '西林')).toBe(true);
    expect(matchPinyinOrText('阿莫西林胶囊', '头孢')).toBe(false);

    // Pinyin initials
    expect(matchPinyinOrText('阿莫西林胶囊', 'amxl')).toBe(true);
    expect(matchPinyinOrText('阿莫西林胶囊', 'amx')).toBe(true);
    expect(matchPinyinOrText('阿莫西林胶囊', 'AMXL')).toBe(true);
    expect(matchPinyinOrText('氨氯地平片', 'aldp')).toBe(true);
    expect(matchPinyinOrText('维生素C片', 'wssc')).toBe(true);
  });

  it('handles edge cases gracefully', () => {
    expect(matchPinyinOrText(null, 'abc')).toBe(false);
    expect(matchPinyinOrText(undefined, 'abc')).toBe(false);
    expect(matchPinyinOrText('阿莫西林', '')).toBe(true);
    expect(matchPinyinOrText('阿莫西林', '   ')).toBe(true);
  });
});
