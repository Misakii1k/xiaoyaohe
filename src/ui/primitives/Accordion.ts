import { Icon } from '../icons/Icon';

export interface AccordionOptions {
  title: string;
  content: Node | readonly Node[];
  open?: boolean;
  className?: string;
}

/** Native details keeps collapsed controls out of the keyboard order. */
export function createAccordion(options: AccordionOptions): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = `ui-accordion${options.className ? ` ${options.className}` : ''}`;
  details.open = options.open ?? false;

  const summary = document.createElement('summary');
  summary.className = 'ui-accordion-summary';
  const label = document.createElement('span');
  label.className = 'ui-accordion-title';
  label.textContent = options.title;
  const chevron = document.createElement('span');
  chevron.className = 'ui-accordion-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.append(Icon('chevron-right'));
  summary.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'ui-accordion-body';
  const nodes = Array.isArray(options.content) ? options.content : [options.content];
  body.append(...nodes);
  details.append(summary, body);
  return details;
}
