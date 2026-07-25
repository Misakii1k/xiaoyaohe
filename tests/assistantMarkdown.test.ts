import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { highlightCode } from '../src/ui/assistantHighlight';
// 导入 assistantContent 触发其顶层的 marked.use({ renderer }) 副作用，注册自定义 renderer。
// 该模块顶层不碰 document，仅在调用渲染函数时才用 DOM，故无 DOM 环境也可安全导入。
import '../src/ui/assistantContent';

describe('assistant markdown renderer hooks (marked.parse output)', () => {
  it('adds ai-code class + language label + highlighted spans to fenced code', () => {
    const html = marked.parse('```js\nconst x = 1; // hi\n```', { async: false }) as string;
    expect(html).toContain('pre class="ai-code"');
    expect(html).toContain('ai-code-lang">js');
    expect(html).toContain('tok-keyword');
    expect(html).toContain('tok-comment');
    expect(html).toContain('tok-number');
  });

  it('adds ai-table class to GFM tables', () => {
    const html = marked.parse('| a | b |\n| --- | --- |\n| 1 | 2 |', { async: false }) as string;
    expect(html).toContain('table class="ai-table"');
    expect(html).toContain('<thead>');
  });

  it('renders GFM task lists as styled spans, never as <input>', () => {
    const html = marked.parse('- [x] done\n- [ ] todo', { async: false }) as string;
    expect(html).not.toContain('<input');
    expect(html).toContain('ai-task is-checked');
    expect(html).toContain('class="ai-task"');
    expect(html).toContain('ai-task-text');
    expect(html).toContain('✓');
  });

  it('adds ai-quote class to blockquotes', () => {
    const html = marked.parse('> hello', { async: false }) as string;
    expect(html).toContain('blockquote class="ai-quote"');
  });

  it('adds heading tier classes with depth', () => {
    const html = marked.parse('## Title\n### Sub', { async: false }) as string;
    expect(html).toContain('h2 class="ai-md-h ai-md-h2"');
    expect(html).toContain('h3 class="ai-md-h ai-md-h3"');
  });

  it('uses mono inline code via ai-md-code class', () => {
    const html = marked.parse('inline `code` here', { async: false }) as string;
    expect(html).toContain('code class="ai-md-code"');
  });

  it('renders hr with ai-md-hr class', () => {
    const html = marked.parse('a\n\n---\n\nb', { async: false }) as string;
    expect(html).toContain('hr class="ai-md-hr"');
  });

  it('paragraph gets ai-md-p class', () => {
    const html = marked.parse('hello world', { async: false }) as string;
    expect(html).toContain('p class="ai-md-p"');
  });
});

describe('isAllowedHref / anchor hardening (renderAssistantMarkdown string output)', () => {
  // renderAssistantMarkdown 用 document.createElement，无法在无 DOM 环境直接调。
  // 这里只验 marked 输出 link 仍保留 href，hardening 由 DOMPurify 后处理保证。
  it('marked keeps href on http links', () => {
    const html = marked.parse('[ok](https://example.com)', { async: false }) as string;
    expect(html).toContain('href="https://example.com"');
  });
});

describe('highlightCode', () => {
  it('highlights js keywords / comments / numbers with spans', () => {
    const html = highlightCode('const x = 1; // hi', 'js');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-comment">// hi</span>');
    expect(html).toContain('<span class="tok-number">1</span>');
  });

  it('highlights strings separately from keywords', () => {
    const html = highlightCode('const s = "hello";', 'js');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-string">"hello"</span>');
  });

  it('falls back to plain escape for unknown lang (no spans)', () => {
    const html = highlightCode('const x = 1;', 'rust');
    expect(html).not.toContain('<span');
    expect(html).toContain('const x = 1;');
  });

  it('falls back to plain escape when lang missing', () => {
    const html = highlightCode('plain text');
    expect(html).not.toContain('<span');
    expect(html).toContain('plain text');
  });

  it('escapes HTML-significant chars in plain mode', () => {
    const html = highlightCode('a < b & c > d', 'rust');
    expect(html).toContain('&lt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&gt;');
  });

  it('highlights python line comments with #', () => {
    const html = highlightCode('x = 1  # set x', 'python');
    expect(html).toContain('<span class="tok-comment"># set x</span>');
    expect(html).toContain('<span class="tok-number">1</span>');
  });

  it('highlights json keys and literals, no keyword set', () => {
    const html = highlightCode('{"a": true, "b": 2}', 'json');
    expect(html).toContain('tok-string'); // "a":
    expect(html).toContain('tok-keyword'); // true
    expect(html).toContain('tok-number'); // 2
  });
});
