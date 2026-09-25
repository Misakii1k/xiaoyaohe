// 更新说明展示前的客户端兜底过滤（展示侧保障）。
//
// 更新说明可能来自 version.json 的 releaseNotes、GitHub Release 正文，最终源头都是
// docs/releases/<版本>.md。发布侧已由 scripts/lib/release-notes-lint.mjs 阻断技术黑话，
// 这里再兜一层：即使上游漏网（旧版本正文、手工改过的 Release 正文），也不把下列内容展示给用户：
// - HTML 注释（如 `<!-- versionCode: 68 -->` 元数据）与网页标签；
// - 代码块与反引号代码标记；
// - 含技术黑话或英文技术标识（驼峰、下划线、文件名、接口路径）的整行。
//
// 词表须与 scripts/lib/release-notes-lint.mjs 的 RELEASE_NOTES_JARGON 保持一致（有单元测试守护）。

export const RELEASE_NOTES_JARGON: readonly string[] = Object.freeze([
  'DOM', 'CSS', '类名', 'FAB', '操作坞', '微拟物', '径向渐变', 'JNI', 'API',
  'versionCode', 'SHA', '哈希', 'E2E', 'Playwright', 'Vitest', 'typecheck',
  'WebView', 'Capacitor', '增量包', '底座', '边缘函数', 'Cloudflare', 'commit',
  '分支', '重构', 'token',
  'HTML', 'JSON', 'IndexedDB', 'localStorage', 'TypeScript', 'JavaScript',
  'Gradle', 'npm', 'SDK', 'CDN', 'Markdown', 'Activity', 'LockTask', 'ADB',
  'instrumentation', '热更新', '增量更新', '单例', '管线', '契约测试', '单元测试', '类型检查',
]);

/** 过滤后什么都不剩时展示的通用说明。 */
export const FALLBACK_RELEASE_NOTES = '本次更新改进了使用体验，并修复了一些已知问题。';

const ALLOWED_MIXED_CASE = new Set(['iOS', 'GitHub', 'Wi-Fi', 'WiFi', 'iPhone', 'iPad']);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const JARGON_PATTERNS: RegExp[] = RELEASE_NOTES_JARGON.map((term) => (
  /^[A-Za-z0-9]+$/.test(term)
    ? new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(term)}(?![A-Za-z_])`, 'i')
    : new RegExp(escapeRegExp(term))
));

/** 行内是否含技术黑话。 */
export function containsReleaseJargon(line: string): boolean {
  return JARGON_PATTERNS.some((pattern) => pattern.test(line));
}

/** 行内是否含英文技术标识（驼峰 / 下划线 / 文件名 / 成员访问 / 接口路径）。 */
export function containsTechnicalIdentifier(line: string): boolean {
  const tokens = line.match(/[A-Za-z_$][\w$./-]*/g) ?? [];
  for (const token of tokens) {
    const word = token.replace(/[./-]+$/, '');
    if (!word || ALLOWED_MIXED_CASE.has(word)) continue;
    if (/_/.test(word)) return true;
    if (/^[a-z]+[A-Z]\w*$/.test(word)) return true;
    if (/^[A-Z][a-z]+[A-Z]\w*$/.test(word)) return true;
    if (/\.(?:ts|js|mjs|json|css|html|java|kt|xml|md|gradle)$/i.test(word)) return true;
    if (/^[a-z]\w*\.[a-z]\w*/.test(word)) return true;
  }
  return /(?:^|[\s（(「])\/[a-z][\w-]*\/[\w/-]+/.test(line);
}

/** 去掉 Markdown 标记后判断一行是否只剩标题/列表符号等无实际内容。 */
function hasVisibleText(line: string): boolean {
  return line.replace(/^#+\s*/, '').replace(/^\s*(?:[-*]|\d+[.)、])\s*/, '').replace(/[*_\s]/g, '').length > 0;
}

/**
 * 把原始更新说明清洗成可以直接展示给用户的文本。
 * 结构（标题、列表、加粗）保留；有问题的整行丢弃；全部丢光时返回标题 + 通用说明。
 */
export function sanitizeReleaseNotesForDisplay(raw: string | undefined | null): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .replace(/^﻿/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/, '');

  const kept: string[] = [];
  let heading: string | null = null;
  let bodyLines = 0;
  let inFence = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    if (/`/.test(trimmed)) continue;
    const line = rawLine.replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\s+$/, '');
    if (!hasVisibleText(line)) continue;
    if (containsReleaseJargon(line) || containsTechnicalIdentifier(line)) continue;
    if (/^#\s/.test(line.trim()) && heading === null && kept.length === 0) {
      heading = line.trim();
    } else if (!/^#{1,6}\s/.test(line.trim())) {
      bodyLines += 1;
    }
    kept.push(line);
  }

  if (bodyLines === 0) {
    return heading ? `${heading}\n\n${FALLBACK_RELEASE_NOTES}` : FALLBACK_RELEASE_NOTES;
  }
  return kept.join('\n');
}
