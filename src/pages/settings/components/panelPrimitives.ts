import { el, icon, type IconName } from '../../../ui/components';
import type { PanelChip, PanelOpts } from '../types';

let panelSeq = 0;

export function panel(opts: PanelOpts): HTMLElement {
  const wrap = el('div', {
    class: 'panel' + (opts.defaultOpen ? ' open' : ''),
  });

  const head = el('button', { class: 'panel-head', type: 'button' });
  const bodyId = `settings-panel-${++panelSeq}`;
  head.setAttribute('aria-expanded', String(Boolean(opts.defaultOpen)));
  head.setAttribute('aria-controls', bodyId);
  const lead = el('span', { class: 'panel-lead' });
  const iconWrap = el('span', { class: `panel-icon panel-icon-${opts.iconTone || 'blue'}` });
  iconWrap.append(icon(opts.iconName));
  lead.append(iconWrap, el('span', { class: 'panel-title', text: opts.title }));
  head.append(lead);

  const right = el('span', { class: 'panel-right' });
  const chip = el('span', {
    class: 'panel-chip tone-' + opts.chip.tone,
    html: opts.chip.text,
  });
  right.append(chip);
  const chevron = el('span', { class: 'panel-chevron' });
  chevron.append(icon('chevron-right'));
  right.append(chevron);
  head.append(right);

  const body = el('div', { class: 'panel-body' });
  body.id = bodyId;
  body.hidden = !opts.defaultOpen;
  if (!opts.defaultOpen) body.setAttribute('inert', '');
  head.onclick = () => {
    const open = wrap.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    if (open) body.removeAttribute('inert');
    else body.setAttribute('inert', '');
  };

  wrap.append(head, body);
  opts.renderBody(body);
  return wrap;
}

export function setChip(panelEl: HTMLElement, chip: PanelChip): void {
  const c = panelEl.querySelector<HTMLElement>('.panel-chip');
  if (!c) return;
  c.className = 'panel-chip tone-' + chip.tone;
  c.textContent = chip.text;
}

export function createSettingsGroup(
  title: string,
  iconName: IconName,
  items: HTMLElement[],
): HTMLElement {
  const section = el('section', { class: 'settings-group-section' });
  const head = el('div', { class: 'settings-group-header' });
  head.append(icon(iconName, 'settings-group-icon'));
  head.append(el('h2', { class: 'settings-group-title', text: title }));
  section.append(head);

  const card = el('div', { class: 'settings-group-card' });
  for (const item of items) {
    card.append(item);
  }
  section.append(card);
  return section;
}
