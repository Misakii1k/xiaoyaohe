// 面向用户的更新说明「无黑话」校验（构建/发布侧阻断）。
//
// 用户在应用内检查更新时看到的更新说明来自 docs/releases/<版本>.md：
// gen-version 把它写进 version.json 的 releaseNotes，发版时又用 --notes-file 作为
// GitHub Release 正文。任何一处漏进技术黑话都会直接展示给普通用户，所以这里在
// gen-version 与 release 校验环节一律阻断。
//
// 规则与 oil-tone 的 tone_lint.py 对齐：先剥掉不可见内容（HTML 注释元数据），再逐行检查；
// 并移植了 tone_lint.py 的硬性失败规则（RULES），不依赖本机 Python 与外部技能目录。
//
// 词表与客户端展示侧过滤（src/sync/lan/releaseNotesText.ts）保持一致，由单元测试守护。

/** 用户可见正文里禁止出现的技术黑话。英文词按词边界、忽略大小写匹配。 */
export const RELEASE_NOTES_JARGON = Object.freeze([
  // 用户规则点名
  'DOM', 'CSS', '类名', 'FAB', '操作坞', '微拟物', '径向渐变', 'JNI', 'API',
  'versionCode', 'SHA', '哈希', 'E2E', 'Playwright', 'Vitest', 'typecheck',
  'WebView', 'Capacitor', '增量包', '底座', '边缘函数', 'Cloudflare', 'commit',
  '分支', '重构', 'token',
  // 同类实现细节
  'HTML', 'JSON', 'IndexedDB', 'localStorage', 'TypeScript', 'JavaScript',
  'Gradle', 'npm', 'SDK', 'CDN', 'Markdown', 'Activity', 'LockTask', 'ADB',
  'instrumentation', '热更新', '增量更新', '单例', '管线', '契约测试', '单元测试', '类型检查',
]);

/** oil-tone tone_lint.py 的硬性失败规则（逐条移植）。 */
const TONE_RULES = Object.freeze([
  [/先保哪一个|保(?:重点|逻辑|意思|准确|清楚|自然|风格|质量|结构)/, '使用「遵循、保留、确保」等准确动词'],
  [/(?:一个|这个)?(?:代码)?问题.{0,8}怎么走/, '改成「一个代码问题通常怎么处理」'],
  [/(?:线索|结果|结论|内容).{0,8}(?:带回来|丢回来|交回来)/, '写清楚谁说明或提交了什么'],
  [/(?:先)?把(?:事实|证据).{0,8}(?:找出来|建立(?:起来)?)/, '改成具体动作'],
  [/(?:逻辑|流程).{0,6}跑(?:到|下去)/, '使用「执行」或具体说明调用关系'],
  [/(?:问题|流程|事情|能力|价值).{0,6}落(?:下去|到|地)/, '说明具体实现或处理动作'],
  [/(?:吃下|吞下).{0,10}(?:对话|内容|信息|上下文)/, '使用「读取、接收、包含」等准确动词'],
  [/(?:把)?(?:内容|信息|上下文).{0,8}(?:塞进|塞到|喂给)/, '使用「写入、添加、提供」等准确动词'],
  [/跑测试/, '使用「运行测试」'],
  [/(?:搞|弄)(?:顺|清楚|明白|好|完|懂|定|起来|下去)/, '说明具体动作和结果'],
  [/承接(?:需求|任务|工作|内容)/, '使用「处理、负责、实现」等准确动词'],
  [/(?:赋能|撬动|抓手|闭环|沉淀价值|价值落地)/, '删除宣传黑话，直接说明具体作用'],
  [/原因很简单[：:，,。]?/, '删除模板化领起语'],
  [/(?:真正重要的是|真正的关键是|这不仅仅?是|从更大的角度看)/, '删除没有增加信息的总结或升华表达'],
]);

/** 允许出现的常见英文专名（产品/平台名，普通用户认得）。 */
const ALLOWED_MIXED_CASE = new Set(['iOS', 'GitHub', 'Wi-Fi', 'WiFi', 'iPhone', 'iPad']);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把词表编译成正则：英文词加词边界（允许后接数字，如 SHA256、CSS3），中文词直接匹配。 */
export function compileJargonPattern(term) {
  if (/^[A-Za-z0-9]+$/.test(term)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(term)}(?![A-Za-z_])`, 'i');
  }
  return new RegExp(escapeRegExp(term));
}

const JARGON_PATTERNS = RELEASE_NOTES_JARGON.map((term) => [term, compileJargonPattern(term)]);

/** 剥掉 HTML 注释（如 `<!-- versionCode: 67 -->` 元数据），保留行号不变。 */
export function stripHtmlComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/<!--[\s\S]*$/, (m) => m.replace(/[^\n]/g, ''));
}

/** 英文技术标识：驼峰、下划线、带扩展名的文件名、成员访问、接口路径。 */
function findTechnicalIdentifier(line) {
  const candidates = line.match(/[A-Za-z_$][\w$./-]*/g) ?? [];
  for (const token of candidates) {
    const word = token.replace(/[./-]+$/, '');
    if (!word || ALLOWED_MIXED_CASE.has(word)) continue;
    if (/_/.test(word)) return word; // snake_case / UPPER_SNAKE
    if (/^[a-z]+[A-Z]\w*$/.test(word)) return word; // camelCase
    if (/^[A-Z][a-z]+[A-Z]\w*$/.test(word) && !ALLOWED_MIXED_CASE.has(word)) return word; // PascalCase 组合词
    if (/\.(?:ts|js|mjs|json|css|html|java|kt|xml|md|gradle)$/i.test(word)) return word; // 文件名
    if (/^[a-z]\w*\.[a-z]\w*/.test(word)) return word; // window.prompt 之类
  }
  const path = line.match(/(?:^|[\s（(「])(\/[a-z][\w-]*\/[\w/-]+)/);
  if (path?.[1]) return path[1];
  return null;
}

/**
 * 检查一段面向用户的更新说明。返回问题列表（空数组即通过）。
 * 每项：{ line, text, rule, detail }。
 */
export function lintReleaseNotes(markdown) {
  const issues = [];
  const lines = stripHtmlComments(String(markdown ?? '').replace(/^﻿/, '')).split(/\r?\n/);
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const at = { line: index + 1, text: line };
    if (line.startsWith('```')) {
      issues.push({ ...at, rule: 'code', detail: '更新说明里不能放代码块' });
      return;
    }
    if (/`[^`]*`/.test(line)) {
      issues.push({ ...at, rule: 'code', detail: '更新说明里不能放代码标记（反引号）' });
    }
    if (/<\/?[a-zA-Z][^>]*>/.test(line)) {
      issues.push({ ...at, rule: 'html', detail: '更新说明里不能放网页标签' });
    }
    const hitTerms = [];
    for (const [term, pattern] of JARGON_PATTERNS) {
      if (pattern.test(line)) {
        hitTerms.push(term.toLowerCase());
        issues.push({ ...at, rule: 'jargon', detail: `出现技术黑话「${term}」` });
      }
    }
    const identifier = findTechnicalIdentifier(line.replace(/`[^`]*`/g, ' '));
    if (identifier && !hitTerms.includes(identifier.toLowerCase())) {
      issues.push({ ...at, rule: 'identifier', detail: `出现英文技术标识「${identifier}」` });
    }
    for (const [pattern, fix] of TONE_RULES) {
      if (pattern.test(line)) {
        issues.push({ ...at, rule: 'tone', detail: `文风不合规：${fix}` });
      }
    }
  });
  return issues;
}

/** 统计要点条数（有序/无序列表项），用于提示「2~3 条要点」的篇幅要求。 */
export function countReleaseNoteItems(markdown) {
  return stripHtmlComments(String(markdown ?? ''))
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*]|\d+[.)、])\s+/.test(line))
    .length;
}

export function formatReleaseNotesIssues(issues, fileLabel = '更新说明') {
  return issues
    .map((issue) => `  ${fileLabel}:${issue.line}  ${issue.detail}\n      > ${issue.text}`)
    .join('\n');
}

/** 命中任何问题即抛错阻断（gen-version / release 校验使用）。 */
export function assertPlainReleaseNotes(markdown, fileLabel = '更新说明') {
  const issues = lintReleaseNotes(markdown);
  if (issues.length > 0) {
    throw new Error(
      `${fileLabel} 含有用户看不懂的技术黑话或代码标记，已阻断。请改成大白话后重试：\n`
      + formatReleaseNotesIssues(issues, fileLabel),
    );
  }
}
