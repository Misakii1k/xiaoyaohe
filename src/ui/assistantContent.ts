import DOMPurify from 'dompurify';
import { marked, type RendererObject, type Tokens } from 'marked';
import type { AssistantCardBlock, AssistantCardVariant, AssistantContentBlock } from '../ai/assistant';
import { setOccurrenceAction } from '../db/local';
import { closeNotificationsByTag } from '../features/notifier';
import { el, icon, toast, type IconName } from './components';
import { highlightCode } from './assistantHighlight';

marked.setOptions({ gfm: true, breaks: true });

const aiRenderer: RendererObject = {
  heading({ tokens, depth }: Tokens.Heading): string {
    const inner = this.parser.parseInline(tokens);
    return `<h${depth} class="ai-md-h ai-md-h${depth}">${inner}</h${depth}>\n`;
  },
  paragraph({ tokens }: Tokens.Paragraph): string {
    return `<p class="ai-md-p">${this.parser.parseInline(tokens)}</p>\n`;
  },
  code({ text, lang, escaped }: Tokens.Code): string {
    const label = (lang ?? '').trim().toLowerCase();
    const body = escaped ? text : highlightCode(text, lang);
    const head = label ? `<div class="ai-code-head"><span class="ai-code-lang">${label}</span></div>` : '';
    return `<pre class="ai-code">${head}<code>${body}</code></pre>\n`;
  },
  codespan({ text }: Tokens.Codespan): string {
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<code class="ai-md-code">${escaped}</code>`;
  },
  blockquote({ tokens }: Tokens.Blockquote): string {
    return `<blockquote class="ai-quote">${this.parser.parse(tokens)}</blockquote>\n`;
  },
  table(token: Tokens.Table): string {
    let header = '';
    for (const cell of token.header) header += this.tablecell({ ...cell, header: true });
    let body = '';
    for (const row of token.rows) {
      let cells = '';
      for (const cell of row) cells += this.tablecell(cell);
      body += this.tablerow({ text: cells });
    }
    if (body) body = `<tbody>${body}</tbody>`;
    return `<div class="ai-table-wrap"><table class="ai-table">\n<thead>\n${header}</thead>\n${body}</table></div>\n`;
  },
  listitem(item: Tokens.ListItem): string {
    if (item.task) {
      const cls = item.checked ? 'ai-task is-checked' : 'ai-task';
      const glyph = item.checked ? '✓' : '';
      const body = this.parser.parseInline(item.tokens);
      return `<li class="ai-md-taskitem"><span class="${cls}" aria-hidden="true">${glyph}</span><span class="ai-task-text">${body}</span></li>\n`;
    }
    return `<li>${this.parser.parse(item.tokens)}</li>\n`;
  },
  checkbox(): string {
    return '';
  },
  hr(): string {
    return `<hr class="ai-md-hr" />\n`;
  },
};

marked.use({ renderer: aiRenderer });

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
      el('div', { class: 'ai-navigation-copy' }, [
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
  const targetPath = variant === 'medication' ? '/today' : variant === 'inventory' ? '/meds/inventory' : variant === 'stats' ? '/history' : null;

  const titleGroup = el('div', { class: 'ai-card-title-group' }, [
    ...(block.eyebrow ? [el('span', { class: 'ai-card-eyebrow', text: block.eyebrow })] : []),
    el('h3', { text: block.title }),
  ]);
  const headingElements = [
    el('span', { class: 'ai-card-icon' }, [icon(headingIcon)]),
    titleGroup,
    ...(block.badge ? [el('span', { class: 'ai-card-badge', text: block.badge })] : []),
  ];
  if (targetPath) {
    const headJump = el('button', {
      class: 'ai-card-head-jump',
      type: 'button',
      'aria-label': `${block.title} 快捷跳转`,
      title: '前往对应页面',
    }, [icon('chevron-right')]);
    headJump.onclick = (e) => {
      e.stopPropagation();
      onNavigate(targetPath);
    };
    headingElements.push(headJump);
  }
  const heading = el('div', { class: 'ai-card-heading' }, headingElements);
  const card = el('article', { class: `ai-content-card is-${tone} is-${variant}` }, [heading]);
  if (block.body) card.append(renderAssistantMarkdown(block.body));

  // 1. 服药统计卡（stats）：主角突出——大数字达成率 + 横向紧凑状态分布条
  if (variant === 'stats') {
    const factMap = new Map((block.facts ?? []).map((f) => [f.label, f.value]));
    const takenNum = parseInt(factMap.get('已服') ?? '0', 10) || 0;
    const missedNum = parseInt(factMap.get('漏服') ?? '0', 10) || 0;
    const skippedNum = parseInt(factMap.get('跳过') ?? '0', 10) || 0;
    const dueNum = parseInt(factMap.get('应服') ?? '0', 10) || (takenNum + missedNum + skippedNum);
    const rateText = block.badge || (dueNum > 0 ? `${Math.round((takenNum / dueNum) * 100)}%` : '暂无数据');

    const badgeMatch = (block.badge ?? '').match(/(\d+)%/);
    const badgePercent = (badgeMatch && badgeMatch[1]) ? parseInt(badgeMatch[1], 10) : parseInt(block.badge ?? '', 10);
    const percentage = !Number.isNaN(badgePercent) && badgePercent > 0
      ? badgePercent
      : (dueNum > 0 ? Math.round((takenNum / dueNum) * 100) : 0);

    let adherenceAssessment = '按时服药达成率';
    if (percentage > 0 || dueNum > 0) {
      adherenceAssessment = percentage >= 90
        ? `${percentage}% 极佳 · 服药达成率`
        : percentage >= 75
          ? `${percentage}% 良好 · 服药达成率`
          : `${percentage}% 需改善 · 服药达成率`;
    }

    const statsHero = el('div', { class: 'ai-stats-hero' }, [
      el('span', { class: 'ai-stats-value', text: rateText }),
      el('span', { class: 'ai-stats-label', text: adherenceAssessment }),
    ]);

    const statsBarWrap = el('div', { class: 'ai-stats-bar-wrap' });
    const statsBar = el('div', { class: 'ai-stats-bar' });

    if (takenNum > 0) {
      const segTaken = el('div', { class: 'ai-stats-bar-seg is-taken' });
      segTaken.style.flex = `${takenNum}`;
      segTaken.title = `已服 ${takenNum} 次`;
      statsBar.append(segTaken);
    }
    if (missedNum > 0) {
      const segMissed = el('div', { class: 'ai-stats-bar-seg is-missed' });
      segMissed.style.flex = `${missedNum}`;
      segMissed.title = `漏服 ${missedNum} 次`;
      statsBar.append(segMissed);
    }
    if (skippedNum > 0) {
      const segSkipped = el('div', { class: 'ai-stats-bar-seg is-skipped' });
      segSkipped.style.flex = `${skippedNum}`;
      segSkipped.title = `跳过 ${skippedNum} 次`;
      statsBar.append(segSkipped);
    }
    if (takenNum === 0 && missedNum === 0 && skippedNum === 0) {
      const segEmpty = el('div', { class: 'ai-stats-bar-seg is-empty' });
      segEmpty.style.flex = '1';
      statsBar.append(segEmpty);
    }

    const statsLegend = el('div', { class: 'ai-stats-legend' }, [
      el('span', { class: 'ai-legend-item' }, [el('i', { class: 'ai-legend-dot is-taken' }), document.createTextNode(`已服 ${takenNum}次`)]),
      el('span', { class: 'ai-legend-item' }, [el('i', { class: 'ai-legend-dot is-missed' }), document.createTextNode(`漏服 ${missedNum}次`)]),
      el('span', { class: 'ai-legend-item' }, [el('i', { class: 'ai-legend-dot is-skipped' }), document.createTextNode(`跳过 ${skippedNum}次`)]),
    ]);

    statsBarWrap.append(statsBar, statsLegend);
    card.append(statsHero, statsBarWrap);
  }

  // 2. 列表项（用药安排卡提供原位微型打卡、库存卡清晰区分正常与需补充状态）
  if (block.items?.length) {
    const items = el('div', { class: 'ai-card-items' });
    for (const item of block.items) {
      const status = item.status ?? 'muted';
      const statusLabel = item.statusLabel ?? defaultItemStatusLabel(status);
      const itemMeta = el('div', { class: 'ai-card-item-meta' }, [
        ...(item.meta ? [el('span', { class: 'ai-card-item-value', text: item.meta })] : []),
      ]);
      const row = el('div', { class: `ai-card-item is-${status}` }, [
        el('span', { class: 'ai-card-item-icon' }, [icon(item.icon ?? defaultItemIcon(variant, status))]),
        el('div', { class: 'ai-card-item-copy' }, [
          el('strong', { text: item.title }),
          ...(item.subtitle ? [el('span', { text: item.subtitle })] : []),
        ]),
        itemMeta,
      ]);

      // 用药安排卡：针对「待服」药物条目直接提供原位微型「已服」打卡操作
      if (variant === 'medication' && status === 'pending') {
        const takeBtn = el('button', {
          class: 'ai-item-take-btn',
          type: 'button',
          text: '已服',
          'aria-label': `标记已服 ${item.title}`,
        }) as HTMLButtonElement;

        takeBtn.onclick = async (e) => {
          e.stopPropagation();
          takeBtn.disabled = true;
          takeBtn.textContent = '记录中…';
          try {
            let occ = item.occurrence;
            if (!occ) {
              const targetName = (item.medName || item.title || '').trim();
              const { todaySnapshot } = await import('../ai/tools/toolTypes');
              const { projections, medById } = await todaySnapshot();
              const found = projections.find((p) => {
                if (!p.occurrence) return false;
                const mName = medById.get(p.revision.medId)?.name ?? '';
                const mId = p.revision.medId;
                const matchesName = !targetName || mName === targetName || mId === targetName ||
                  targetName.includes(mName) || (mName && mName.includes(targetName));
                const matchesSlot = !item.slot || p.revision.slot === item.slot;
                return matchesName && matchesSlot;
              });
              occ = found?.occurrence;
              if (occ) item.occurrence = occ;
            }
            if (occ) {
              const res = await setOccurrenceAction(occ, 'taken');
              try {
                await closeNotificationsByTag(occ.id);
                if (occ.legacyLogId) {
                  await closeNotificationsByTag(occ.legacyLogId);
                }
              } catch { /* 忽略系统通知取消异常 */ }

              row.classList.remove('is-pending');
              row.classList.add('is-success');
              takeBtn.remove();
              const donePill = el('span', { class: 'ai-card-item-status is-success', text: '已服' });
              itemMeta.append(donePill);
              const iconSpan = row.querySelector('.ai-card-item-icon');
              if (iconSpan) iconSpan.replaceChildren(icon('check'));

              // 撤销 Toast（5 秒居中带操作）
              const undoAction = {
                text: '撤销',
                onClick: async () => {
                  try {
                    await setOccurrenceAction(occ!, undefined);
                    donePill.remove();
                    takeBtn.disabled = false;
                    takeBtn.textContent = '已服';
                    itemMeta.append(takeBtn);
                    row.classList.remove('is-success');
                    row.classList.add('is-pending');
                    if (iconSpan) iconSpan.replaceChildren(icon(item.icon ?? 'pill'));
                    toast(`已撤销 ${item.title} 服药记录`);
                  } catch {
                    toast('撤销失败');
                  }
                },
              };

              if (res.lowStock && res.lowStockMessage) {
                toast(res.lowStockMessage, 5000, undoAction);
              } else {
                toast(`已完成 ${item.title} 服药打卡`, 5000, undoAction);
              }
            } else {
              toast(`未找到 ${item.title} 今日待打卡排期`);
              takeBtn.disabled = false;
              takeBtn.textContent = '已服';
            }
          } catch {
            toast('打卡失败，请重试');
            takeBtn.disabled = false;
            takeBtn.textContent = '已服';
          }
        };

        itemMeta.append(takeBtn);
      } else if (statusLabel) {
        itemMeta.append(el('span', { class: `ai-card-item-status is-${status}`, text: statusLabel }));
      }

      items.append(row);
    }
    card.append(items);
  }

  // 3. 统计之外其它卡片的事实微数据（微网格，非厚重灰方格）
  if (variant !== 'stats' && block.facts?.length) {
    const facts = el('dl', { class: 'ai-card-facts' });
    for (const fact of block.facts) {
      facts.append(el('div', {}, [el('dt', { text: fact.label }), el('dd', { text: fact.value })]));
    }
    card.append(facts);
  }

  // 4. 卡片底部跳转操作
  if (targetPath) {
    const actionText = variant === 'medication' ? '查看今日用药' : variant === 'inventory' ? '管理药品库存' : '查看完整历史';
    const footerAction = el('button', { class: 'ai-card-action-btn', type: 'button' }, [
      el('span', { text: actionText }),
      icon('chevron-right'),
    ]);
    footerAction.onclick = () => onNavigate(targetPath);
    card.append(footerAction);
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
