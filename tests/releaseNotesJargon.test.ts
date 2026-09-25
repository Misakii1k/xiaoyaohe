import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RELEASE_NOTES_JARGON as BUILD_JARGON,
  assertPlainReleaseNotes,
  countReleaseNoteItems,
  lintReleaseNotes,
  stripHtmlComments,
} from '../scripts/lib/release-notes-lint.mjs';
import { readReleaseNotes } from '../scripts/gen-version.mjs';
import {
  FALLBACK_RELEASE_NOTES,
  RELEASE_NOTES_JARGON as CLIENT_JARGON,
  sanitizeReleaseNotesForDisplay,
} from '../src/sync/lan/releaseNotesText';

const root = process.cwd();
const releasesDir = join(root, 'docs', 'releases');

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const releaseDocs = readdirSync(releasesDir)
  .filter((f) => /^\d+\.\d+\.\d+\.md$/.test(f))
  .map((f) => f.replace(/\.md$/, ''))
  .sort(compareVersions);

describe('更新说明黑话约束：发布侧阻断', () => {
  it('客户端过滤词表与发布校验词表一致', () => {
    expect([...CLIENT_JARGON]).toEqual([...BUILD_JARGON]);
  });

  it('词表覆盖用户点名的全部黑话', () => {
    const required = ['DOM', 'CSS', '类名', 'FAB', '操作坞', '微拟物', '径向渐变', 'JNI', 'API', 'versionCode',
      'SHA', '哈希', 'E2E', 'Playwright', 'Vitest', 'typecheck', 'WebView', 'Capacitor', '增量包', '底座',
      '边缘函数', 'Cloudflare', 'commit', '分支', '重构', 'token'];
    for (const term of required) expect(BUILD_JARGON).toContain(term);
  });

  it('命中黑话 / 代码标记 / 英文技术标识 / 文风规则都会报错', () => {
    const bad = [
      '1. 优化 DOM 结构。',
      '1. 修复 css 类名冲突。',
      '1. 调整 FAB 操作坞位置。',
      '1. 新增 `promptDialog` 弹窗。',
      '1. 修复 SHA256 校验。',
      '1. 修复 WebView 兼容问题。',
      '1. 修复 appUpdatePanel 的排版。',
      '1. 修改 settings.css 的间距。',
      '1. 适配 /images/edits 接口。',
      '1. 修复 REORDER_TASKS 权限。',
      '1. 形成提醒闭环。',
      '<div>标签</div>',
    ];
    for (const line of bad) {
      expect(lintReleaseNotes(`# 小药盒 v9.9.9 更新说明\n\n${line}`).length, line).toBeGreaterThan(0);
      expect(() => assertPlainReleaseNotes(line)).toThrow(/已阻断/);
    }
  });

  it('HTML 注释元数据不算黑话，也会在写入前剥离', () => {
    const doc = '# 小药盒 v1.1.10 更新说明\n\n1. 按钮更跟手。\n2. 弹窗过渡更自然。\n\n<!-- versionCode: 68 -->\n';
    expect(lintReleaseNotes(doc)).toEqual([]);
    expect(stripHtmlComments(doc)).not.toContain('versionCode');
    expect(countReleaseNoteItems(doc)).toBe(2);
  });

  it('常见产品名（GitHub、Wi-Fi、iOS、Android）不误伤', () => {
    expect(lintReleaseNotes('1. 对齐 iOS 手感，同一 Wi-Fi 下的设备可以互传新版本，GitHub 下载更稳，Android 通知更安静。')).toEqual([]);
  });

  it('gen-version 读取更新说明：剥掉注释元数据，含黑话时抛错阻断', () => {
    const dir = mkdtempSync(join(tmpdir(), 'medbox-notes-'));
    mkdirSync(join(dir, 'docs', 'releases'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'releases', '9.9.9.md'), '﻿# 小药盒 v9.9.9 更新说明\n\n1. 打卡更顺手。\n\n<!-- versionCode: 99 -->\n');
    const notes = readReleaseNotes(dir, '9.9.9');
    expect(notes).toBe('# 小药盒 v9.9.9 更新说明\n\n1. 打卡更顺手。');

    writeFileSync(join(dir, 'docs', 'releases', '9.9.8.md'), '# 小药盒 v9.9.8\n\n1. 重构 CSS 径向渐变。\n');
    expect(() => readReleaseNotes(dir, '9.9.8')).toThrow(/技术黑话/);
  });

  it('全部面向用户的历史更新说明都无黑话', () => {
    const failures: string[] = [];
    for (const version of releaseDocs) {
      const issues = lintReleaseNotes(readFileSync(join(releasesDir, `${version}.md`), 'utf8'));
      for (const issue of issues) failures.push(`${version}.md:${issue.line} ${issue.detail} | ${issue.text}`);
    }
    expect(failures).toEqual([]);
  });

  it('最近 5 个版本的更新说明保持 2~3 条要点', () => {
    for (const version of releaseDocs.slice(-5)) {
      const count = countReleaseNoteItems(readFileSync(join(releasesDir, `${version}.md`), 'utf8'));
      expect(count, `${version}.md`).toBeGreaterThanOrEqual(2);
      expect(count, `${version}.md`).toBeLessThanOrEqual(3);
    }
  });

  it('已生成的 version.json 中的更新说明不含注释元数据和黑话', () => {
    const file = join(root, 'public', 'version.json');
    if (!existsSync(file)) return;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { releaseNotes?: string };
    if (!manifest.releaseNotes) return;
    expect(sanitizeReleaseNotesForDisplay(manifest.releaseNotes)).not.toContain('<!--');
    expect(sanitizeReleaseNotesForDisplay(manifest.releaseNotes)).not.toContain('versionCode');
  });
});

describe('更新说明黑话约束：客户端展示兜底', () => {
  it('剥离 HTML 注释元数据，保留正常内容', () => {
    const raw = '# 小药盒 v1.1.10 更新说明\n\n1. 按钮按下更跟手。\n2. 弹窗过渡更自然。\n\n<!-- versionCode: 68 -->';
    const out = sanitizeReleaseNotesForDisplay(raw);
    expect(out).toBe('# 小药盒 v1.1.10 更新说明\n1. 按钮按下更跟手。\n2. 弹窗过渡更自然。');
    expect(out).not.toContain('versionCode');
  });

  it('丢弃含代码标记、代码块、黑话、英文技术标识的行', () => {
    const raw = [
      '# 小药盒 v2.0.0 更新说明',
      '- 打卡更顺手。',
      '- 新增 `promptDialog` 弹窗。',
      '```',
      'npm run build',
      '```',
      '- 优化 DOM 与 CSS 渲染。',
      '- 修复 appUpdatePanel 排版。',
      '- 升级 WebView 底座。',
      '- 基于 Cloudflare 边缘函数。',
      '- 提醒更安静。',
    ].join('\n');
    const out = sanitizeReleaseNotesForDisplay(raw);
    expect(out).toBe('# 小药盒 v2.0.0 更新说明\n- 打卡更顺手。\n- 提醒更安静。');
  });

  it('去掉网页标签但保留文字', () => {
    expect(sanitizeReleaseNotesForDisplay('1. <b>打卡</b>更顺手。')).toBe('1. 打卡更顺手。');
  });

  it('全部被过滤时给出通用说明，保留标题', () => {
    expect(sanitizeReleaseNotesForDisplay('# 小药盒 v3.0.0\n- 重构 DOM')).toBe(`# 小药盒 v3.0.0\n\n${FALLBACK_RELEASE_NOTES}`);
    expect(sanitizeReleaseNotesForDisplay('- API 调整')).toBe(FALLBACK_RELEASE_NOTES);
  });

  it('空值安全', () => {
    expect(sanitizeReleaseNotesForDisplay(undefined)).toBe('');
    expect(sanitizeReleaseNotesForDisplay(null)).toBe('');
  });
});
