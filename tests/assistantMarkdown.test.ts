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

vi.mock('../src/db/local', () => ({
  setOccurrenceAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../src/features/notifier', () => ({
  closeNotificationsByTag: vi.fn(async () => undefined),
}));
vi.mock('../src/ai/tools/toolTypes', () => ({
  todaySnapshot: vi.fn(async () => ({
    projections: [
      {
        occurrence: { id: 'occ-dyn-1', medId: 'med-dyn-1', slot: 'morning', dateLocal: '2026-10-10', timeLocal: '08:00', legacyLogId: 'log-dyn-1' },
        revision: { medId: 'med-dyn-1', slot: 'morning' },
      },
    ],
    medById: new Map([
      ['med-dyn-1', { id: 'med-dyn-1', name: '降压药' }],
    ]),
  })),
}));

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

  it('renders medication cards with in-place take buttons for pending items', async () => {
    const { setOccurrenceAction } = await import('../src/db/local');
    const onNavigate = vi.fn();
    const mockOccurrence = {
      id: 'occ-1',
      medId: 'med-1',
      slot: 'morning' as const,
      dateLocal: '2026-10-10',
      timeLocal: '08:00',
      legacyLogId: 'log-1',
    };

    const card = renderAssistantBlock({
      type: 'card',
      title: '今日用药安排',
      variant: 'medication',
      badge: '1 待处理',
      items: [
        {
          title: '阿莫西林',
          subtitle: '08:00 · 1片 · 饭后',
          status: 'pending',
          statusLabel: '还没吃',
          occurrence: mockOccurrence,
        },
        {
          title: '维生素C',
          subtitle: '08:00 · 2片',
          status: 'success',
          statusLabel: '已吃',
        },
      ],
    }, onNavigate);

    expect(card.className).toContain('ai-content-card');
    expect(card.className).toContain('is-medication');

    // Header jump button
    const headJump = card.querySelector<HTMLButtonElement>('.ai-card-head-jump');
    expect(headJump).toBeDefined();
    headJump?.click();
    expect(onNavigate).toHaveBeenCalledWith('/today');

    // Pending item has in-place take button
    const takeBtn = card.querySelector<HTMLButtonElement>('.ai-item-take-btn');
    expect(takeBtn).toBeDefined();
    expect(takeBtn?.textContent).toBe('已服');

    // Success item has status pill
    const successPill = card.querySelector('.ai-card-item-status.is-success');
    expect(successPill?.textContent).toBe('已吃');

    // Click take button
    takeBtn?.click();
    await vi.waitFor(() => {
      expect(setOccurrenceAction).toHaveBeenCalledWith(mockOccurrence, 'taken');
      expect(card.querySelector('.ai-item-take-btn')).toBeNull();
    });

    const rows = card.querySelectorAll('.ai-card-item');
    expect(rows[0]?.classList.contains('is-success')).toBe(true);

    // Verify undo toast was mounted
    const toastElem = document.querySelector('.toast');
    expect(toastElem).toBeDefined();
    expect(toastElem?.textContent).toContain('已完成 阿莫西林 服药打卡');
    const undoBtn = toastElem?.querySelector<HTMLButtonElement>('.toast-action-btn');
    expect(undoBtn?.textContent).toBe('撤销');

    // Click undo
    undoBtn?.click();
    await vi.waitFor(() => {
      expect(setOccurrenceAction).toHaveBeenCalledWith(mockOccurrence, undefined);
      expect(card.querySelector('.ai-item-take-btn')).not.toBeNull();
    });
    // Reverts back to pending
    expect(rows[0]?.classList.contains('is-pending')).toBe(true);
  });

  it('renders stats cards with hero adherence percentage and horizontal distribution bar', () => {
    const onNavigate = vi.fn();
    const card = renderAssistantBlock({
      type: 'card',
      title: '按时服药情况',
      variant: 'stats',
      badge: '82%',
      facts: [
        { label: '应服', value: '14 次' },
        { label: '已服', value: '11 次' },
        { label: '漏服', value: '2 次' },
        { label: '跳过', value: '1 次' },
      ],
    }, onNavigate);

    expect(card.className).toContain('is-stats');
    // Protagonist hero number
    const heroValue = card.querySelector('.ai-stats-value');
    expect(heroValue?.textContent).toBe('82%');
    expect(card.querySelector('.ai-stats-label')?.textContent).toContain('82% 良好 · 服药达成率');

    // Horizontal distribution bar
    expect(card.querySelector('.ai-stats-bar-wrap')).toBeDefined();
    expect(card.querySelector('.ai-stats-bar-seg.is-taken')).toBeDefined();
    expect(card.querySelector('.ai-stats-bar-seg.is-missed')).toBeDefined();
    expect(card.querySelector('.ai-stats-bar-seg.is-skipped')).toBeDefined();

    // Stats card should NOT render clumsy dl.ai-card-facts
    expect(card.querySelector('dl.ai-card-facts')).toBeNull();

    // Footer button
    const footerBtn = card.querySelector<HTMLButtonElement>('.ai-card-action-btn');
    expect(footerBtn?.textContent).toContain('查看完整历史');
    footerBtn?.click();
    expect(onNavigate).toHaveBeenCalledWith('/history');
  });

  it('renders inventory cards with non-wrapping status badges', () => {
    const onNavigate = vi.fn();
    const card = renderAssistantBlock({
      type: 'card',
      title: '我的药物',
      variant: 'inventory',
      badge: '1 项需补充',
      items: [
        {
          title: '布洛芬缓释胶囊',
          subtitle: '0.3g · 每次 1 粒',
          meta: '仅剩 2 粒',
          status: 'warning',
          statusLabel: '需补充',
        },
        {
          title: '阿莫西林胶囊',
          subtitle: '0.25g · 每次 2 粒',
          meta: '剩余 24 粒',
          status: 'success',
          statusLabel: '正常',
        },
      ],
    }, onNavigate);

    expect(card.className).toContain('is-inventory');
    const warningBadge = card.querySelector('.ai-card-item-status.is-warning');
    expect(warningBadge?.textContent).toBe('需补充');
    const successBadge = card.querySelector('.ai-card-item-status.is-success');
    expect(successBadge?.textContent).toBe('正常');
  });

  it('dynamically matches occurrence by item title when occurrence is not pre-populated', async () => {
    const { setOccurrenceAction } = await import('../src/db/local');
    const onNavigate = vi.fn();
    const card = renderAssistantBlock({
      type: 'card',
      title: '今日用药',
      variant: 'medication',
      items: [
        {
          title: '降压药',
          subtitle: '08:00 · 1片',
          status: 'pending',
          // occurrence omitted to test dynamic resolution
        },
      ],
    }, onNavigate);

    const takeBtn = card.querySelector<HTMLButtonElement>('.ai-item-take-btn');
    expect(takeBtn).not.toBeNull();
    takeBtn?.click();

    await vi.waitFor(() => {
      expect(setOccurrenceAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'occ-dyn-1', medId: 'med-dyn-1' }),
        'taken',
      );
      expect(card.querySelector('.ai-item-take-btn')).toBeNull();
    });
  });

  it('renders search cards with lightweight source links', () => {
    const onNavigate = vi.fn();
    const card = renderAssistantBlock({
      type: 'card',
      title: '降压药使用注意',
      variant: 'search',
      body: '> 互联网内容仅供参考。\n\n每日定时服用。\n\n**来源**\n1. [说明书](https://example.com/guide)\n2. [百科](https://example.com/baike)',
    }, onNavigate);

    expect(card.className).toContain('is-search');
    const links = card.querySelectorAll('a');
    expect(links.length).toBe(2);
    expect(links[0]?.textContent).toBe('说明书');
    expect(links[0]?.getAttribute('href')).toBe('https://example.com/guide');
    expect(links[1]?.textContent).toBe('百科');
  });

  it('renders stats cards for 100% adherence and 0% edge cases', () => {
    const onNavigate = vi.fn();
    const fullCard = renderAssistantBlock({
      type: 'card',
      title: '按时服药情况',
      variant: 'stats',
      badge: '100%',
      facts: [
        { label: '应服', value: '4 次' },
        { label: '已服', value: '4 次' },
        { label: '漏服', value: '0 次' },
        { label: '跳过', value: '0 次' },
      ],
    }, onNavigate);

    expect(fullCard.querySelector('.ai-stats-value')?.textContent).toBe('100%');
    expect(fullCard.querySelector('.ai-stats-label')?.textContent).toContain('极佳');

    const emptyCard = renderAssistantBlock({
      type: 'card',
      title: '按时服药情况',
      variant: 'stats',
      badge: '0%',
      facts: [
        { label: '应服', value: '4 次' },
        { label: '已服', value: '0 次' },
        { label: '漏服', value: '4 次' },
        { label: '跳过', value: '0 次' },
      ],
    }, onNavigate);

    expect(emptyCard.querySelector('.ai-stats-value')?.textContent).toBe('0%');
    expect(emptyCard.querySelector('.ai-stats-label')?.textContent).toContain('需改善');
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
