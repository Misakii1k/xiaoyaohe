import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AssistantCardBlock, AssistantCardVariant, AssistantContentBlock } from '../ai/assistant';
import { el, icon, type IconName } from './components';

marked.setOptions({ gfm: true, breaks: true });

function isAllowedHref(raw: string): boolean {
  const href = raw.trim();
  if (!href || href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return true;
  try {
    const protocol = new URL(href).protocol;
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(protocol);
  } catch {
    return false;
  }
}

export function renderAssistantMarkdown(markdown: string): HTMLElement {
  const container = el('div', { class: 'ai-markdown' });
  const html = marked.parse(markdown, { async: false }) as string;
  const content = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'form', 'input', 'button', 'img', 'audio', 'video', 'source', 'object', 'embed'],
    FORBID_ATTR: ['style'],
    RETURN_DOM_FRAGMENT: true,
  });
  container.append(content);
  for (const anchor of container.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (!isAllowedHref(anchor.getAttribute('href') ?? '')) {
      anchor.removeAttribute('href');
      continue;
    }
    anchor.rel = 'noopener noreferrer';
    if (/^https?:/i.test(anchor.href)) anchor.target = '_blank';
  }
  return container;
}

export function renderAssistantBlock(
  block: AssistantContentBlock,
  onNavigate: (path: string) => void,
): HTMLElement {
  if (block.type === 'navigation') {
    const button = el('button', { class: 'ai-navigation-card', type: 'button' }, [
      el('span', { class: 'ai-navigation-icon' }, [icon(block.icon ?? 'chevron-right')]),
      el('span', { class: 'ai-navigation-copy' }, [
        el('strong', { text: block.title }),
        ...(block.description ? [el('span', { text: block.description })] : []),
      ]),
      el('span', { class: 'ai-navigation-action' }, [
        el('span', { text: block.actionLabel }),
        icon('chevron-right'),
      ]),
    ]) as HTMLButtonElement;
    button.onclick = () => onNavigate(block.path);
    button.setAttribute('aria-label', `${block.actionLabel}：${block.title}`);
    return button;
  }

  const tone = block.tone ?? 'neutral';
  const variant = block.variant ?? (tone === 'warning' ? 'notice' : 'summary');
  const headingIcon = block.icon ?? defaultCardIcon(variant, tone);
  const titleGroup = el('div', { class: 'ai-card-title-group' }, [
    ...(block.eyebrow ? [el('span', { class: 'ai-card-eyebrow', text: block.eyebrow })] : []),
    el('h3', { text: block.title }),
  ]);
  const heading = el('div', { class: 'ai-card-heading' }, [
    el('span', { class: 'ai-card-icon' }, [icon(headingIcon)]),
    titleGroup,
    ...(block.badge ? [el('span', { class: 'ai-card-badge', text: block.badge })] : []),
  ]);
  const card = el('article', { class: `ai-content-card is-${tone} is-${variant}` }, [heading]);
  if (block.body) card.append(renderAssistantMarkdown(block.body));
  if (block.items?.length) {
    const items = el('div', { class: 'ai-card-items' });
    for (const item of block.items) {
      const status = item.status ?? 'muted';
      const statusLabel = item.statusLabel ?? defaultItemStatusLabel(status);
      const itemMeta = el('div', { class: 'ai-card-item-meta' }, [
        ...(item.meta ? [el('span', { class: 'ai-card-item-value', text: item.meta })] : []),
        ...(statusLabel ? [el('span', { class: `ai-card-item-status is-${status}`, text: statusLabel })] : []),
      ]);
      const row = el('div', { class: `ai-card-item is-${status}` }, [
        el('span', { class: 'ai-card-item-icon' }, [icon(item.icon ?? defaultItemIcon(variant, status))]),
        el('div', { class: 'ai-card-item-copy' }, [
          el('strong', { text: item.title }),
          ...(item.subtitle ? [el('span', { text: item.subtitle })] : []),
        ]),
        itemMeta,
      ]);
      items.append(row);
    }
    card.append(items);
  }
  if (block.facts?.length) {
    const facts = el('dl', { class: 'ai-card-facts' });
    for (const fact of block.facts) {
      facts.append(el('div', {}, [el('dt', { text: fact.label }), el('dd', { text: fact.value })]));
    }
    card.append(facts);
  }
  return card;
}

function defaultCardIcon(variant: AssistantCardVariant, tone: AssistantCardBlock['tone']): IconName {
  if (tone === 'warning') return 'warn';
  if (tone === 'success') return 'check';
  if (variant === 'medication') return 'pill';
  if (variant === 'inventory') return 'box';
  if (variant === 'stats') return 'timer';
  if (variant === 'search') return 'scan';
  if (variant === 'notice') return 'info';
  return 'sparkles';
}

function defaultItemIcon(variant: AssistantCardVariant, status: string): IconName {
  if (status === 'success') return 'check';
  if (status === 'warning') return 'warn';
  if (status === 'skipped') return 'close';
  if (variant === 'inventory') return 'pill';
  return 'clock';
}

function defaultItemStatusLabel(status: string): string | undefined {
  if (status === 'pending') return '待处理';
  if (status === 'success') return '已完成';
  if (status === 'skipped') return '已跳过';
  if (status === 'warning') return '需留意';
  return undefined;
}
