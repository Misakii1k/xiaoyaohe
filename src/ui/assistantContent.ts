import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { AssistantContentBlock } from '../ai/assistant';
import { el, icon } from './components';

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
  const heading = el('div', { class: 'ai-card-heading' }, [
    el('span', { class: 'ai-card-icon' }, [icon(tone === 'warning' ? 'warn' : tone === 'success' ? 'check' : 'sparkles')]),
    el('div', {}, [
      ...(block.eyebrow ? [el('span', { class: 'ai-card-eyebrow', text: block.eyebrow })] : []),
      el('h3', { text: block.title }),
    ]),
  ]);
  const card = el('article', { class: `ai-content-card is-${tone}` }, [heading]);
  if (block.body) card.append(renderAssistantMarkdown(block.body));
  if (block.facts?.length) {
    const facts = el('dl', { class: 'ai-card-facts' });
    for (const fact of block.facts) {
      facts.append(el('div', {}, [el('dt', { text: fact.label }), el('dd', { text: fact.value })]));
    }
    card.append(facts);
  }
  return card;
}
