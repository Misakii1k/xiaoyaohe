import '../ui/styles/pages/today.css';
import {
  listMeds,
  listLogsByDay,
  listScheduleRevisions,
  setOccurrenceAction,
  setOccurrenceActions,
  getDatabaseRevision,
} from '../db/local';
import {
  formatMealRels,
  type IntakeLog,
  type Medication,
  type MedicationOccurrence,
  type MedicationScheduleRevision,
  type Slot,
  SLOT_LABEL,
} from '../db/schema';
import {
  findLogForOccurrence,
  localDayBounds,
  projectScheduleDate,
  toLocalDate,
  type ScheduleDayProjection,
} from '../domain/medicationSchedule';
import {
  el,
  icon,
  renderPage,
  toast,
  progressRing,
  banner,
} from '../ui/components';
import { getMedPhotoUrls } from '../features/medPhotos';
import { getOrCreateMed3DImage } from '../features/aiImageGen';
import { openTakeMedModal } from '../ui/TakeMedModal';
import { parseSvg } from '../ui/assets3d';
import { navigate } from '../router';
import { closeNotificationsByTag } from '../features/notifier';
import { renderBPackageSvg } from './MedList';

interface TodayItem {
  revision: MedicationScheduleRevision;
  med: Medication;
  dueAt: number;
  occurrence?: MedicationOccurrence;
  log?: IntakeLog;
  isRest: boolean;
}

interface SlotGroup {
  slot: Slot;
  items: TodayItem[];
  earliest: number;
  earliestTime: string;
}

let activeSlotFilter: 'all' | 'morning' | 'noon' | 'evening' = 'all';

const todayPageCleanupByRoot = new WeakMap<HTMLElement, () => void>();

export async function renderTodayPage(root: HTMLElement, signal?: AbortSignal): Promise<void | (() => void)> {
  todayPageCleanupByRoot.get(root)?.();
  const now = new Date();
  const today = toLocalDate(now);
  const { start, end } = localDayBounds(today);
  const [meds, revisions, logs] = await Promise.all([
    listMeds(),
    listScheduleRevisions(),
    listLogsByDay(start, end),
  ]);
  if (signal?.aborted) return;
  const medById = new Map(meds.map((med) => [med.id, med]));
  const projections = projectScheduleDate(revisions, today);
  const items = projections.flatMap((projection) => {
    const med = medById.get(projection.revision.medId);
    if (!med) return [];
    return [toTodayItem(projection, med, logs)];
  });

  const photoMedIds = [...new Set(items.map((item) => item.med.id))].sort();
  const photoUrls = await getMedPhotoUrls(photoMedIds);
  if (signal?.aborted) return;

  const content = el('div', { class: 'page today-page' });

  const activeItems = items.filter((item) => !item.isRest && item.occurrence);
  const total = activeItems.length;
  const taken = activeItems.filter((item) => item.log?.status === 'taken').length;
  const skipped = activeItems.filter((item) => item.log?.status === 'skipped').length;
  const pending = total - taken - skipped;

  // 1. 顶部问候栏 (Plan B 风格)
  const headerRow = el('div', { class: 'today-head' });
  const hour = now.getHours();
  const greeting = hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const headerLeft = el('div');
  headerLeft.append(
    el('h2', { text: greeting }),
    el('p', { text: '规律的小事，也值得认真对待。' })
  );

  const headerRight = el('div', { class: 'today-head-right' });
  const aiBtn = el('button', {
    class: 'today-ai-btn',
    type: 'button',
    'aria-label': '打开 AI 助手',
    title: '打开 AI 助手',
  } as any);
  aiBtn.append(icon('sparkles'), el('span', { text: 'AI 助手' }));
  aiBtn.onclick = () => void import('../ui/AiAssistant').then((m) => m.openAssistantPanel());

  const dateNum = el('span', { class: 'today-date', text: String(now.getDate()) });
  headerRight.append(aiBtn, dateNum);
  headerRow.append(headerLeft, headerRight);
  content.append(headerRow);

  // 2. 本周日期栏 (周一到周日)
  const currentDay = now.getDay();
  const mondayOffset = (currentDay + 6) % 7;
  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];
  const weekRow = el('div', { class: 'week', 'aria-label': '本周日期' });
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - mondayOffset + i);
    const isToday = i === mondayOffset;
    const dayEl = el('div', { class: `day${isToday ? ' current' : ''}` });
    dayEl.append(
      document.createTextNode(weekDays[i] || ''),
      el('b', { text: String(d.getDate()) })
    );
    weekRow.append(dayEl);
  }
  content.append(weekRow);

  // 3. 今日用药进度卡片 (带 today-summary class)
  const progressCard = el('section', { class: 'today-summary' });
  progressCard.classList.add('today-progress-card', 'summary');
  const summaryLeft = el('div', { class: 'summary-left' });
  const countLarge = el('div', { class: 'large' });
  countLarge.append(
    el('strong', { id: 'takenCount', text: String(taken) }),
    document.createTextNode(' '),
    el('span', { text: `/ ${total}` })
  );
  const encourageText = total === 0 ? '今日没有用药计划' : pending === 0 ? '今天已完成全部用药' : `已完成 ${taken} 次，剩余 ${pending} 次待服`;
  summaryLeft.append(countLarge, el('p', { text: encourageText }));

  const ringWrap = el('div', { class: 'today-summary-progress today-progress-ring-wrap ring' });
  ringWrap.append(progressRing(taken, total));

  progressCard.append(summaryLeft, ringWrap);
  content.append(progressCard);

  // 4. 下一次用药 / 待服聚焦大卡片 (置顶在进度卡片下方)
  const pendingActiveItems = activeItems.filter((i) => !i.log || i.log.status === 'pending');
  pendingActiveItems.sort((a, b) => a.dueAt - b.dueAt);

  if (pendingActiveItems.length > 0) {
    const nextItem = pendingActiveItems[0]!;
    const slotLabel = SLOT_LABEL[nextItem.revision.slot] || '计划用药';
    const dose = nextItem.med.amountPerDose || nextItem.med.dosageText || '1片';
    const meal = formatMealRels([...(nextItem.revision.mealRels || [])]);

    const focusSection = el('section', { class: 'today-focus-section' });
    const timeLabel = el('div', { class: 'time-label' });
    timeLabel.append(
      document.createTextNode(`下一次用药 · ${nextItem.revision.timeLocal} `),
      el('span', { class: 'tag', text: slotLabel })
    );
    focusSection.append(timeLabel);

    const doseCard = el('article', { class: 'dose today-focus-card' });
    const doseInfo = el('div', { class: 'dose-info' });
    const doseImage = el('div', { class: 'dose-image' });

    const photoUrl = photoUrls.get(nextItem.med.id);
    if (photoUrl) {
      const img = el('img', { src: photoUrl, alt: nextItem.med.name, loading: 'lazy' }) as HTMLImageElement;
      img.onerror = () => { doseImage.replaceChildren(parseSvg(renderBPackageSvg(nextItem.med))); };
      doseImage.append(img);
    } else {
      const threeD = getOrCreateMed3DImage(nextItem.med.id, nextItem.med.name, nextItem.med.amountPerDose || nextItem.med.dosageText);
      if (threeD && !threeD.startsWith('data:image/svg+xml')) {
        const img = el('img', { src: threeD, alt: nextItem.med.name, loading: 'lazy' }) as HTMLImageElement;
        img.onerror = () => { doseImage.replaceChildren(parseSvg(renderBPackageSvg(nextItem.med))); };
        doseImage.append(img);
      } else {
        doseImage.replaceChildren(parseSvg(renderBPackageSvg(nextItem.med)));
      }
    }

    const doseMeta = el('div', { class: 'dose-meta' });
    doseMeta.append(
      el('h3', { text: nextItem.med.name }),
      el('p', { text: `${dose}${meal ? ' · ' + meal : ' · 饭后温水服用'}` })
    );
    doseInfo.append(doseImage, doseMeta);

    const doseBottom = el('div', { class: 'dose-bottom' });
    doseBottom.append(el('small', { id: 'doseStatus', text: '现在可以记录服药' }));

    const takeBtn = el('button', {
      class: 'primary today-primary-btn',
      type: 'button',
      id: 'takeDose',
      text: '确认已服用',
    });
    takeBtn.onclick = async () => {
      if (!nextItem.occurrence) return;
      takeBtn.disabled = true;
      try {
        const res = await setOccurrenceAction(nextItem.occurrence, 'taken');
        if (nextItem.occurrence) {
          closeNotificationsByTag(nextItem.occurrence.id);
          closeNotificationsByTag(nextItem.occurrence.legacyLogId);
        }
        if (res.lowStock && res.lowStockMessage) {
          toast(res.lowStockMessage);
        } else {
          toast(`已记录 ${nextItem.med.name} 服用，可随时撤销`);
        }
        void renderTodayPage(root, signal);
      } catch {
        toast('记录失败');
      } finally {
        takeBtn.disabled = false;
      }
    };

    doseBottom.append(takeBtn);
    doseCard.append(doseInfo, doseBottom);
    focusSection.append(doseCard);
    content.append(focusSection);
  } else if (total > 0 && pending === 0) {
    // 全部已服完清爽完成态
    const takenItems = activeItems.filter((i) => i.log?.status === 'taken');
    const lastTakenItem = takenItems[takenItems.length - 1];

    const focusSection = el('section', { class: 'today-focus-section' });
    const timeLabel = el('div', { class: 'time-label' });
    timeLabel.append(
      document.createTextNode('今日安排 '),
      el('span', { class: 'tag', text: '已全部完成' })
    );
    focusSection.append(timeLabel);

    const doseCard = el('article', { class: 'dose today-focus-card today-focus-done' });
    const doseInfo = el('div', { class: 'dose-info' });
    const doseImage = el('div', { class: 'dose-image done-check' });
    doseImage.append(icon('check'));

    const doseMeta = el('div', { class: 'dose-meta' });
    doseMeta.append(
      el('h3', { text: '今日用药已全部完成' }),
      el('p', { text: '照顾好自己，从每一件小事开始。' })
    );
    doseInfo.append(doseImage, doseMeta);

    const doseBottom = el('div', { class: 'dose-bottom' });
    doseBottom.append(el('small', { id: 'doseStatus', text: '今日计划已达成，状态随时可撤销' }));

    if (lastTakenItem && lastTakenItem.occurrence) {
      const undoBtn = el('button', {
        class: 'secondary today-secondary-btn',
        type: 'button',
        text: `撤销最近记录 (${lastTakenItem.med.name})`,
      });
      undoBtn.onclick = async () => {
        if (!lastTakenItem.occurrence) return;
        undoBtn.disabled = true;
        try {
          await setOccurrenceAction(lastTakenItem.occurrence, undefined);
          if (lastTakenItem.occurrence) {
            closeNotificationsByTag(lastTakenItem.occurrence.id);
            closeNotificationsByTag(lastTakenItem.occurrence.legacyLogId);
          }
          toast(`已撤销 ${lastTakenItem.med.name} 服药记录`);
          void renderTodayPage(root, signal);
        } catch {
          toast('撤销失败');
        } finally {
          undoBtn.disabled = false;
        }
      };
      doseBottom.append(undoBtn);
    }

    doseCard.append(doseInfo, doseBottom);
    focusSection.append(doseCard);
    content.append(focusSection);
  }

  // 5. 今日用药计划
  const sectionHeader = el('div', { class: 'today-section-header' });
  sectionHeader.append(el('h2', { class: 'today-section-title', text: '今日用药安排' }));
  content.append(sectionHeader);

  // 统计各时段数量
  const morningCount = activeItems.filter((i) => i.revision.slot === 'morning').length;
  const noonCount = activeItems.filter((i) => i.revision.slot === 'noon').length;
  const eveningCount = activeItems.filter((i) => i.revision.slot === 'evening' || i.revision.slot === 'bedtime').length;

  const filterTabs = el('div', { class: 'today-filter-tabs' });
  const tabs = [
    { key: 'all' as const, label: `全部 ${total}` },
    { key: 'morning' as const, label: `早上 ${morningCount}` },
    { key: 'noon' as const, label: `中午 ${noonCount}` },
    { key: 'evening' as const, label: `晚上 ${eveningCount}` },
  ];

  tabs.forEach((tab) => {
    const pill = el('button', {
      class: `today-filter-pill${activeSlotFilter === tab.key ? ' active' : ''}`,
      type: 'button',
      text: tab.label,
    });
    pill.onclick = () => {
      activeSlotFilter = tab.key;
      void renderTodayPage(root, signal);
    };
    filterTabs.append(pill);
  });
  content.append(filterTabs);

  // 4. 药品卡片列表
  if (items.length > 0) {
    const groupMap = new Map<Slot, SlotGroup>();
    for (const item of items) {
      if (activeSlotFilter === 'morning' && item.revision.slot !== 'morning') continue;
      if (activeSlotFilter === 'noon' && item.revision.slot !== 'noon') continue;
      if (activeSlotFilter === 'evening' && item.revision.slot !== 'evening' && item.revision.slot !== 'bedtime') continue;

      const slot = item.revision.slot;
      let group = groupMap.get(slot);
      if (!group) {
        group = { slot, items: [], earliest: item.dueAt, earliestTime: item.revision.timeLocal };
        groupMap.set(slot, group);
      }
      group.items.push(item);
      if (item.dueAt < group.earliest) {
        group.earliest = item.dueAt;
        group.earliestTime = item.revision.timeLocal;
      }
    }

    const sortedGroups = [...groupMap.values()].sort((a, b) => a.earliest - b.earliest);
    if (sortedGroups.length === 0) {
      content.append(banner('info', '该时段没有用药安排'));
    } else {
      for (const group of sortedGroups) {
        content.append(renderSlotGroup(group, photoUrls, () => void renderTodayPage(root, signal)));
      }
    }
  } else {
    const emptyCard = el('div', { class: 'today-empty-card' });
    emptyCard.append(
      el('div', { class: 'today-empty-title', text: '暂无用药计划' }),
      el('div', { class: 'today-empty-sub', text: '前往「药品」页面添加药品并配置服药时段，此处将自动生成每日计划。' })
    );
    const addBtn = el('button', {
      class: 'btn primary',
      type: 'button',
      text: '+ 添加药品',
    });
    addBtn.onclick = () => navigate('/meds/new');
    emptyCard.append(addBtn);
    content.append(emptyCard);
  }

  let lastRevision = getDatabaseRevision();
  let lastDate = today;
  const onActivated = async () => {
    const currentToday = toLocalDate(new Date());
    const currentRev = getDatabaseRevision();
    if (currentRev <= lastRevision && currentToday === lastDate) return;
    lastRevision = currentRev;
    lastDate = currentToday;
    const scrollEl = root.querySelector<HTMLElement>('.app-main');
    const savedScroll = scrollEl?.scrollTop ?? 0;
    await renderTodayPage(root, signal);
    const newScrollEl = root.querySelector<HTMLElement>('.app-main');
    if (newScrollEl && savedScroll > 0) newScrollEl.scrollTop = savedScroll;
  };
  root.addEventListener('tab:activated', onActivated);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    root.removeEventListener('tab:activated', onActivated);
    signal?.removeEventListener('abort', cleanup);
    if (todayPageCleanupByRoot.get(root) === cleanup) {
      todayPageCleanupByRoot.delete(root);
    }
  };
  todayPageCleanupByRoot.set(root, cleanup);
  signal?.addEventListener('abort', cleanup, { once: true });

  if (signal?.aborted) {
    cleanup();
    return cleanup;
  }

  renderPage({ root, title: '今天', activeTab: 'today', content });
  return cleanup;
}

function renderSlotGroup(
  group: SlotGroup,
  photoUrls: ReadonlyMap<string, string>,
  onRefresh: () => void
): HTMLElement {
  const container = el('div', { class: 'today-time-group today-slot' });

  const activeGroupItems = group.items.filter((i) => i.occurrence && !i.isRest);
  const pendingItems = activeGroupItems.filter((i) => !i.log || i.log.status === 'pending');
  const allTaken = activeGroupItems.length > 0 && activeGroupItems.every((i) => i.log?.status === 'taken');
  const slotName = SLOT_LABEL[group.slot] || '用药时段';

  const header = el('div', { class: 'today-time-header today-slot-actions' });
  const tag = el('div', { class: 'today-time-tag' });
  const slotBadge = el('div', { class: `today-slot-badge slot-${group.slot}` });
  slotBadge.append(icon(group.slot === 'morning' ? 'sun' : group.slot === 'noon' ? 'sun-high' : group.slot === 'evening' ? 'sunset' : 'moon'));
  tag.append(slotBadge, el('span', { class: 'today-slot-time-text', text: `${group.earliestTime} ${slotName}` }));

  if (allTaken) {
    const statusPill = el('span', {
      class: 'today-time-status-pill taken',
      text: '已全部服用',
    });
    header.append(tag, statusPill);
  } else if (pendingItems.length > 0) {
    const batchBtn = el('button', {
      class: 'today-batch-take-btn',
      type: 'button',
      'aria-label': `${slotName}一键打卡`,
    } as any);
    batchBtn.append(icon('check'), el('span', { text: '一键打卡' }));
    batchBtn.onclick = async (e) => {
      e.stopPropagation();
      if (pendingItems.length === 0) return;
      const pendingOccurrences = pendingItems.map((i) => i.occurrence!);
      try {
        const results = await setOccurrenceActions(pendingOccurrences, 'taken');
        for (const occ of pendingOccurrences) {
          closeNotificationsByTag(occ.id);
          closeNotificationsByTag(occ.legacyLogId);
        }
        for (const res of results) {
          if (res.lowStock && res.lowStockMessage) {
            toast(res.lowStockMessage);
          }
        }
        toast(`已完成${slotName}一键打卡`);
        onRefresh();
      } catch {
        toast('一键打卡失败');
      }
    };
    header.append(tag, batchBtn);
  } else {
    const allHandled = activeGroupItems.length > 0 && activeGroupItems.every((i) => i.log?.status === 'taken' || i.log?.status === 'skipped');
    if (allHandled) {
      const statusPill = el('span', {
        class: 'today-time-status-pill taken',
        text: '已全部处理',
      });
      header.append(tag, statusPill);
    }
  }
  container.append(header);

  for (const item of group.items) {
    const card = el('div', { class: 'today-card-item today-medication-row' });

    // 缩略图
    const thumb = el('div', { class: 'today-card-thumb' });
    const img = el('img', {
      src: photoUrls.get(item.med.id) || getOrCreateMed3DImage(item.med.id, item.med.name, item.med.amountPerDose || item.med.dosageText),
      alt: item.med.name,
    });
    thumb.append(img);

    // 信息
    const info = el('div', { class: 'today-card-info' });
    info.append(el('div', { class: 'today-card-name today-medication-name', text: item.med.name }));

    const dose = item.med.amountPerDose || item.med.dosageText || '1片';
    const meal = formatMealRels([...(item.revision.mealRels || [])]);
    const freqText = item.med.slots && item.med.slots.length > 0 ? `每日${item.med.slots.length}次` : '每日1次';
    info.append(el('div', { class: 'today-card-meta', text: `${dose}${meal ? ' · ' + meal : ''} · ${freqText}` }));

    const badges = el('div', { class: 'today-card-badges' });
    const stockCount = item.med.inventory?.remaining ?? 36;
    const isLow = stockCount <= (item.med.inventory?.lowThreshold ?? 5);
    const unit = item.med.inventory?.unit || item.med.doseUnit || '片';
    const stockBadge = el('span', {
      class: `today-stock-tag ${isLow ? 'low' : 'ok'}`,
      text: isLow ? `库存不足 剩余${stockCount}${unit}` : `库存充足 剩余${stockCount}${unit}`,
    });
    badges.append(stockBadge);

    if (item.med.amountPerDose && item.med.doseQuantity == null) {
      const reviewBadge = el('span', {
        class: 'today-stock-tag low',
        text: '剂量待复核',
      });
      badges.append(reviewBadge);
    }
    info.append(badges);

    // 圆形打卡 Radio 按钮
    const isTaken = item.log?.status === 'taken';
    const radioBtn = el('button', {
      class: `today-radio-btn${isTaken ? ' taken' : ''}`,
      type: 'button',
      'aria-label': isTaken ? '已服用' : '点击打卡',
    } as any);

    if (isTaken) {
      radioBtn.append(icon('check'));
    }

    radioBtn.onclick = async (e) => {
      e.stopPropagation();
      if (!item.occurrence) return;
      if (isTaken) {
        try {
          await setOccurrenceAction(item.occurrence, undefined);
          if (item.occurrence) {
            closeNotificationsByTag(item.occurrence.id);
            closeNotificationsByTag(item.occurrence.legacyLogId);
          }
          toast('已撤销服药打卡');
          onRefresh();
        } catch {
          toast('操作失败');
        }
      } else {
        try {
          const res = await setOccurrenceAction(item.occurrence, 'taken');
          if (item.occurrence) {
            closeNotificationsByTag(item.occurrence.id);
            closeNotificationsByTag(item.occurrence.legacyLogId);
          }
          if (res.lowStock && res.lowStockMessage) {
            toast(res.lowStockMessage);
          } else {
            toast(`已完成 ${item.med.name} 服药打卡`);
          }
          onRefresh();
        } catch {
          toast('打卡失败');
        }
      }
    };

    card.onclick = () => {
      if (item.occurrence && !isTaken) {
        if (item.occurrence) {
          closeNotificationsByTag(item.occurrence.id);
          closeNotificationsByTag(item.occurrence.legacyLogId);
        }
        openTakeMedModal({
          med: item.med,
          revision: item.revision,
          occurrence: item.occurrence,
          dueAt: item.dueAt,
          slot: item.revision.slot,
          photoUrl: photoUrls.get(item.med.id),
          onDone: onRefresh,
        });
      }
    };

    card.append(thumb, info, radioBtn);
    container.append(card);
  }

  return container;
}

function toTodayItem(
  projection: ScheduleDayProjection,
  med: Medication,
  logs: readonly IntakeLog[],
): TodayItem {
  return {
    revision: projection.revision,
    med,
    dueAt: projection.dueAt,
    occurrence: projection.occurrence,
    log: projection.occurrence ? findLogForOccurrence(projection.occurrence, logs) : undefined,
    isRest: projection.isRest,
  };
}

export function preflightInventoryActions(_items: readonly TodayItem[]): boolean {
  return true;
}
