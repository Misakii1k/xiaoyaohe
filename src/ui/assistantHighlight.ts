// 自托管、无依赖的线性正则语法高亮。
// 设计目标：流式每 delta 全量重解析时成本 O(n)，避免回溯/嵌套。
// 仅对 js/ts/json/bash/sh/python 做轻量上色；其它语言直接转义返回单色。
// 不追求 100% 正确（模板字符串 `${}`、嵌套引号等边界会错色），换取可预测的线性成本。

const KEYWORDS: Record<string, ReadonlySet<string>> = {
  js: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'import', 'export', 'from', 'default', 'await', 'async', 'new', 'class', 'extends', 'super', 'this', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 'try', 'catch', 'finally', 'throw', 'switch', 'case', 'do', 'in', 'of', 'yield', 'delete', 'void']),
  ts: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'import', 'export', 'from', 'default', 'await', 'async', 'new', 'class', 'extends', 'super', 'this', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined', 'try', 'catch', 'finally', 'throw', 'switch', 'case', 'do', 'in', 'of', 'yield', 'delete', 'void', 'interface', 'type', 'enum', 'namespace', 'public', 'private', 'protected', 'readonly', 'as', 'implements', 'declare']),
  bash: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'echo', 'export', 'cd', 'exit', 'return', 'function', 'local', 'set', 'unset', 'source']),
  sh: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'echo', 'export', 'cd', 'exit', 'return', 'function', 'local', 'set', 'unset', 'source']),
  python: new Set(['def', 'return', 'if', 'else', 'elif', 'for', 'while', 'break', 'continue', 'import', 'from', 'as', 'class', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'global', 'nonlocal', 'yield', 'async', 'await', 'assert', 'del']),
};

const HIGHLIGHTED = new Set(['js', 'ts', 'javascript', 'typescript', 'bash', 'sh', 'shell', 'zsh', 'python', 'py', 'json']);

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function langKey(lang: string): string {
  const l = lang.toLowerCase();
  if (l === 'typescript' || l === 'ts') return 'ts';
  if (l === 'javascript' || l === 'js') return 'js';
  if (l === 'python' || l === 'py') return 'python';
  if (l === 'bash' || l === 'sh' || l === 'shell' || l === 'zsh') return 'bash';
  return l;
}

function kwClass(lang: string): string | null {
  const k = langKey(lang);
  return KEYWORDS[k] ? k : null;
}

// 标记片段类型，用于先保护注释/字符串再上色其余。
type Part = { text: string; kind: 'raw' | 'comment' | 'string' };

function splitProtected(text: string, lang: string): Part[] {
  // 一次线性扫描，用单条正则把注释和字符串整体切出来。无回溯（各分支互斥、非贪婪且无嵌套）。
  // 注释：//...、#...（仅 bash/sh/python 行注释）、/* ... */（js/ts）
  // 字符串："..."、'...'、`...`
  const isHashLang = lang === 'bash' || lang === 'sh' || lang === 'python' || lang === 'py';
  const isBlockCommentLang = lang === 'js' || lang === 'ts';
  const pattern = isBlockCommentLang
    ? /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g
    : isHashLang
      ? /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\n]*/g
      : /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*"|`(?:\\.|[^`\\])*`/g;
  const parts: Part[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), kind: 'raw' });
    const tok = m[0];
    const isComment = tok.startsWith('//') || tok.startsWith('/*') || (tok.startsWith('#') && isHashLang);
    parts.push({ text: tok, kind: isComment ? 'comment' : 'string' });
    last = m.index + tok.length;
    if (tok.length === 0) pattern.lastIndex++; // 防止零宽死循环
  }
  if (last < text.length) parts.push({ text: text.slice(last), kind: 'raw' });
  return parts;
}

function highlightRaw(text: string, lang: string): string {
  const cls = kwClass(lang);
  if (!cls) {
    // json：仅高亮键字符串（已被 splitProtected 当 string 切出）+ 数字；无关键字
    if (lang === 'json') return highlightJson(text);
    return esc(text);
  }
  const kws = KEYWORDS[cls];
  // 关键字与数字用一条线性正则按位置上色，避免嵌套。
  const tokenRe = /([A-Za-z_$][\w$]*)|(\b\d+(?:\.\d+)?\b)|([{}()[\];,])/g;
  return text.replace(tokenRe, (whole, word, num, punct) => {
    if (word) {
      if (kws.has(word)) return `<span class="tok-keyword">${esc(word)}</span>`;
      return esc(word);
    }
    if (num) return `<span class="tok-number">${esc(num)}</span>`;
    if (punct) return `<span class="tok-punct">${esc(punct)}</span>`;
    return esc(whole);
  });
}

function highlightJson(text: string): string {
  const tokenRe = /"(?:\\.|[^"\\])*"(\s*:)?|(\b\d+(?:\.\d+)?\b)|\b(true|false|null)\b|([{}[\]:,])/g;
  return text.replace(tokenRe, (whole, keyColon, num, lit, punct) => {
    if (keyColon) return `<span class="tok-keyword">${esc(whole)}</span>`;
    if (num) return `<span class="tok-number">${esc(num)}</span>`;
    if (lit) return `<span class="tok-keyword">${esc(lit)}</span>`;
    if (punct) return `<span class="tok-punct">${esc(punct)}</span>`;
    return esc(whole);
  });
}

export function highlightCode(text: string, lang?: string): string {
  const l = (lang ?? '').trim().toLowerCase();
  if (!l || !HIGHLIGHTED.has(l)) return esc(text);
  const cls = kwClass(l) ?? (l === 'json' ? 'json' : null);
  if (!cls) return esc(text);
  const parts = splitProtected(text, cls === 'json' ? '' : cls);
  let out = '';
  for (const p of parts) {
    if (p.kind === 'string') out += `<span class="tok-string">${esc(p.text)}</span>`;
    else if (p.kind === 'comment') out += `<span class="tok-comment">${esc(p.text)}</span>`;
    else out += cls === 'json' ? highlightJson(p.text) : highlightRaw(p.text, cls);
  }
  return out;
}
