// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { marked } from 'marked';
import { highlightCode } from '../src/ui/assistantHighlight';
import { renderAssistantBlock, renderAssistantMarkdown } from '../src/ui/assistantContent';

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
  it('marked keeps href on http links', () => {
    const html = marked.parse('[ok](https://example.com)', { async: false }) as string;
    expect(html).toContain('href="https://example.com"');
  });

  it('sanitizes unsafe HTML and hardens allowed external links', () => {
    const content = renderAssistantMarkdown([
      '<script>alert(1)</script>',
      '[safe](https://example.com)',
      '[unsafe](javascript:alert(1))',
    ].join('\n\n'));

    expect(content.querySelector('script')).toBeNull();
    const links = content.querySelectorAll('a');
    expect(links[0]?.getAttribute('href')).toBe('https://example.com');
    expect(links[0]?.target).toBe('_blank');
    expect(links[0]?.rel).toBe('noopener noreferrer');
    expect(links[1]?.hasAttribute('href')).toBe(false);
  });
});

describe('assistant structured content', () => {
  it('renders navigation cards with unchanged navigation behavior', () => {
    const onNavigate = vi.fn();
    const card = renderAssistantBlock({
      type: 'navigation',
      title: '药品库存',
      description: '查看剩余药量',
      actionLabel: '打开',
      path: '/meds/inventory',
    }, onNavigate) as HTMLButtonElement;

    expect(card.className).toBe('ai-navigation-card');
    expect(card.textContent).toContain('药品库存');
    expect(card.getAttribute('aria-label')).toBe('打开：药品库存');
    card.click();
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(onNavigate).toHaveBeenCalledWith('/meds/inventory');
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
