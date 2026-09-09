// 密钥落点契约：LanSync 的 extras 通道可以传密钥，但只允许经会话密钥加密后过网，
// 落地必须走 secretStore / 安全存储，绝不能明文写进 localStorage。
//
// localStorage 本身在 LAN 层是合法用途（设备名、已配对设备、更新缓存、开关位），
// 所以这里检查的是「写进去的值里不许出现密钥」，而不是「禁止写 localStorage」。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LAN_DIR = join(process.cwd(), 'src', 'sync', 'lan');
const SET_ITEM_RE = /localStorage\.setItem\(\s*([^,]+),\s*([\s\S]*?)\)\s*;/g;
const SECRETISH_RE = /apiKey|apikey|secret|password|bearer|authorization/i;

function lanSources(): Array<{ file: string; code: string }> {
  return readdirSync(LAN_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => {
      const raw = readFileSync(join(LAN_DIR, name), 'utf8');
      const code = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      return { file: name, code };
    });
}

describe('LanSync 密钥落点契约', () => {
  it('写入 localStorage 的值里不含任何密钥', () => {
    for (const { file, code } of lanSources()) {
      for (const match of code.matchAll(SET_ITEM_RE)) {
        expect(match[2], `${file}: ${match[0]}`).not.toMatch(SECRETISH_RE);
      }
    }
  });

  it('退役的明文密钥键已彻底消失', () => {
    for (const { file, code } of lanSources()) {
      expect(code, file).not.toContain('medbox.agnesApi');
    }
  });

  it('extras 只在会话密钥加密后发送', () => {
    const session = readFileSync(join(LAN_DIR, 'session.ts'), 'utf8');
    expect(session).toContain('collectSyncExtras');
    expect(session).toContain('encryptLanSyncMessage');
    expect(session).toMatch(/syncExtrasSchema\.safeParse/);
  });
});
