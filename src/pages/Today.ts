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
  type LocalDate,
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
let selectedWeekOffset = 0;
let selectedScheduleDate: LocalDate | null = null;

const todayPageCleanupByRoot = new WeakMap<HTMLElement, () => void>();

export async function renderTodayPage(root: HTMLElement, signal?: AbortSignal): Promise<void | (() => void)> {
  todayPageCleanupByRoot.get(root)?.();
  const now = new Date();
  const realToday = toLocalDate(now);
  const currentViewDate = selectedScheduleDate || realToday;
  const isViewingToday = currentViewDate === realToday;

  const { start, end } = localDayBounds(currentViewDate);
  const [meds, revisions, logs] = await Promise.all([
    listMeds(),
    listScheduleRevisions(),
    listLogsByDay(start, end),
  ]);
  if (signal?.aborted) return;
  const medById = new Map(meds.map((med) => [med.id, med]));
  const projections = projectScheduleDate(revisions, currentViewDate);
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
  const greetingEl = el('h2', { text: greeting });
  const subtitleRow = el('div', { class: 'today-subtitle-row' });
  const subtitleText = el('p', {
    text: isViewingToday ? '规律的小事，也值得认真对待。' : `正在查看 ${currentViewDate} 安排`,
  });
  subtitleRow.append(subtitleText);

  if (!isViewingToday) {
    const returnBtn = el('button', {
      class: 'today-return-btn',
      type: 'button',
      'aria-label': '返回今天',
      title: '返回今天',
    } as any);
    returnBtn.append(icon('calendar'), el('span', { text: '回到今天' }));
    returnBtn.onclick = () => {
      selectedWeekOffset = 0;
      selectedScheduleDate = realToday;
      void renderTodayPage(root, signal);
    };
    subtitleRow.append(returnBtn);
  }
  headerLeft.append(greetingEl, subtitleRow);

  const headerRight = el('div', { class: 'today-head-right' });
  const aiBtn = el('button', {
    class: 'today-ai-btn',
    type: 'button',
    'aria-label': '打开 AI 助手',
    title: '打开 AI 助手',
  } as any);
  aiBtn.append(icon('sparkles'), el('span', { text: 'AI 助手' }));
  aiBtn.onclick = () => void import('../ui/AiAssistant').then((m) => m.openAssistantPanel());
  headerRight.append(aiBtn);

  headerRow.append(headerLeft, headerRight);
  content.append(headerRow);

  // 2. 本周日期栏 (周一到周日，支持翻周与点击高亮)
  const baseDate = new Date(now);
  baseDate.setDate(baseDate.getDate() + selectedWeekOffset * 7);
  const baseDay = baseDate.getDay();
  const mondayOffset = (baseDay + 6) % 7;
  const weekDays = ['一', '二', '三', '四', '五', '六', '日'];

  const weekContainer = el('div', { class: 'week-container' });

  // 翻周导航条 (月份提示与翻周按钮)
  const weekNavBar = el('div', { class: 'week-nav-bar' });
  const mondayDate = new Date(baseDate);
  mondayDate.setDate(baseDate.getDate() - mondayOffset);
  const sundayDate = new Date(baseDate);
  sundayDate.setDate(baseDate.getDate() - mondayOffset + 6);

  const monthRangeStr = mondayDate.getMonth() === sundayDate.getMonth()
    ? `${mondayDate.getMonth() + 1}月`
    : `${mondayDate.getMonth() + 1}月 - ${sundayDate.getMonth() + 1}月`;
  const weekRangeLabel = el('span', { class: 'week-range-label', text: monthRangeStr });

  const weekNavActions = el('div', { class: 'week-nav-actions' });
  const prevWeekBtn = el('button', {
    class: 'week-nav-btn',
    type: 'button',
    'aria-label': '上一周',
    title: '上一周',
  } as any);
  prevWeekBtn.append(icon('chevron-left'));
  prevWeekBtn.onclick = () => {
    selectedWeekOffset -= 1;
    const d = new Date(currentViewDate);
    d.setDate(d.getDate() - 7);
    selectedScheduleDate = toLocalDate(d);
    void renderTodayPage(root, signal);
  };

  const nextWeekBtn = el('button', {
    class: 'week-nav-btn',
    type: 'button',
    'aria-label': '下一周',
    title: '下一周',
  } as any);
  nextWeekBtn.append(icon('chevron-right'));
  nextWeekBtn.onclick = () => {
    selectedWeekOffset += 1;
    const d = new Date(currentViewDate);
    d.setDate(d.getDate() + 7);
    selectedScheduleDate = toLocalDate(d);
    void renderTodayPage(root, signal);
  };

  weekNavActions.append(prevWeekBtn, nextWeekBtn);
  weekNavBar.append(weekRangeLabel, weekNavActions);
  weekContainer.append(weekNavBar);

  const weekRow = el('div', { class: 'week', 'aria-label': '周历日期' });
  for (let i = 0; i < 7; i++) {
    const d = new Date(baseDate);
    d.setDate(baseDate.getDate() - mondayOffset + i);
    const dateStr = toLocalDate(d);
    const isDaySelected = dateStr === currentViewDate;
    const isDayRealToday = dateStr === realToday;

    const dayEl = el('div', {
      class: `day${isDaySelected ? ' selected' : ''}${isDayRealToday ? ' is-real-today' : ''}`,
      'aria-label': `${dateStr} 周${weekDays[i]}${isDayRealToday ? '（今天）' : ''}${isDaySelected ? '（已选）' : ''}`,
      role: 'button',
      tabIndex: 0,
    } as any);

    const nameSpan = el('span', { class: 'day-name', text: weekDays[i] || '' });
    const numBold = el('b', { text: String(d.getDate()) });
    dayEl.append(nameSpan, numBold);

    // 现实今天且未被选中时，底部渲染小绿点
    if (isDayRealToday && !isDaySelected) {
      dayEl.append(el('span', { class: 'day-today-indicator', title: '今天' }));
    }

    dayEl.onclick = () => {
      if (selectedScheduleDate === dateStr) return;
      selectedScheduleDate = dateStr;
      void renderTodayPage(root, signal);
    };

    weekRow.append(dayEl);
  }

  // 触摸轻滑切换周手势支持
  let touchStartX = 0;
  let touchStartY = 0;
  weekRow.addEventListener('touchstart', (e: TouchEvent) => {
    touchStartX = e.touches[0]?.clientX ?? 0;
    touchStartY = e.touches[0]?.clientY ?? 0;
  }, { passive: true });
  weekRow.addEventListener('touchend', (e: TouchEvent) => {
    const touchEndX = e.changedTouches[0]?.clientX ?? 0;
    const touchEndY = e.changedTouches[0]?.clientY ?? 0;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      if (diffX > 0) {
        prevWeekBtn.click();
      } else {
        nextWeekBtn.click();
      }
    }
  }, { passive: true });

  weekContainer.append(weekRow);
  content.append(weekContainer);

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
  const encourageText = total === 0
    ? (isViewingToday ? '今日没有用药计划' : `${currentViewDate} 没有用药计划`)
    : pending === 0
      ? (isViewingToday ? '今天已完成全部用药' : `${currentViewDate} 已完成全部用药`)
      : `已完成 ${taken} 次，剩余 ${pending} 次待服`;
  summaryLeft.append(countLarge, el('p', { text: encourageText }));

  const ringWrap = el('div', { class: 'today-summary-progress today-progress-ring-wrap ring' });
  ringWrap.append(progressRing(taken, total));

  progressCard.append(summaryLeft, ringWrap);
  content.append(progressCard);

  // 4. 下一次用药 / 待服聚焦大卡片 (仅当处于现实今天时置顶在进度卡片下方)
  if (isViewingToday) {
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
          await renderTodayPage(root, signal);
        } catch {
          toast('记录失败');
          takeBtn.disabled = false;
        }
      };

      doseBottom.append(takeBtn);
      doseCard.append(doseInfo, doseBottom);
      focusSection.append(doseCard);
      content.append(focusSection);
    } else if (total > 0 && pending === 0) {
      const handledItems = activeItems.filter((i) => i.log?.status === 'taken' || i.log?.status === 'skipped');
      const lastHandledItem = handledItems[handledItems.length - 1];
      const allTaken = taken === total;
      const allSkipped = skipped === total;

      const focusSection = el('section', { class: 'today-focus-section' });
      const timeLabel = el('div', { class: 'time-label' });
      timeLabel.append(
        document.createTextNode('今日安排 '),
        el('span', {
          class: 'tag',
          text: allTaken ? '已全部完成' : allSkipped ? '已全部跳过' : '已全部处理',
        })
      );
      focusSection.append(timeLabel);

      const doseCard = el('article', { class: 'dose today-focus-card today-focus-done' });
      const doseInfo = el('div', { class: 'dose-info' });
      const doseImage = el('div', { class: 'dose-image done-check' });
      doseImage.append(icon(allSkipped ? 'info' : 'check'));

      const doseMeta = el('div', { class: 'dose-meta' });
      doseMeta.append(
        el('h3', {
          text: allTaken
            ? '今日用药已全部完成'
            : allSkipped
              ? '今日用药已全部跳过'
              : '今日安排已全部处理',
        }),
        el('p', {
          text: allTaken
            ? '照顾好自己，从每一件小事开始。'
            : allSkipped
              ? '今日用药已跳过，可随时按需恢复。'
              : `已完成 ${taken} 项，跳过 ${skipped} 项。`,
        })
      );
      doseInfo.append(doseImage, doseMeta);

      const doseBottom = el('div', { class: 'dose-bottom' });
      doseBottom.append(
        el('small', {
          id: 'doseStatus',
          text: allSkipped
            ? '如需服药，可撤销跳过记录'
            : '今日计划已达成，状态随时可撤销',
        })
      );

      if (lastHandledItem && lastHandledItem.occurrence) {
        const isLastSkipped = lastHandledItem.log?.status === 'skipped';
        const undoBtn = el('button', {
          class: 'secondary today-secondary-btn',
          type: 'button',
          text: isLastSkipped
            ? `撤销跳过 (${lastHandledItem.med.name})`
            : `撤销最近记录 (${lastHandledItem.med.name})`,
        });
        undoBtn.onclick = async () => {
          if (!lastHandledItem.occurrence) return;
          undoBtn.disabled = true;
          try {
            await setOccurrenceAction(lastHandledItem.occurrence, undefined);
            if (lastHandledItem.occurrence) {
              closeNotificationsByTag(lastHandledItem.occurrence.id);
              closeNotificationsByTag(lastHandledItem.occurrence.legacyLogId);
            }
            toast(`已撤销 ${lastHandledItem.med.name} 记录`);
            await renderTodayPage(root, signal);
          } catch {
            toast('撤销失败');
            undoBtn.disabled = false;
          }
        };
        doseBottom.append(undoBtn);
      }

      doseCard.append(doseInfo, doseBottom);
      focusSection.append(doseCard);
      content.append(focusSection);
    }
  }

  // 5. 今日用药计划
  const sectionHeader = el('div', { class: 'today-section-header' });
  sectionHeader.append(el('h2', { class: 'today-section-title', text: isViewingToday ? '今日用药安排' : `${currentViewDate} 用药安排` }));
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
        content.append(renderSlotGroup(group, photoUrls, () => void renderTodayPage(root, signal), !isViewingToday));
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
  let lastDate = realToday;
  const onActivated = async () => {
    const currentToday = toLocalDate(new Date());
    const currentRev = getDatabaseRevision();
    if (currentRev <= lastRevision && currentToday === lastDate) return;
    lastRevision = currentRev;
    if (currentToday !== lastDate) {
      lastDate = currentToday;
      if (!selectedScheduleDate || selectedScheduleDate === lastDate) {
        selectedScheduleDate = currentToday;
      }
    }
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
  onRefresh: () => void,
  isReadOnly = false
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
  } else if (isReadOnly) {
    const statusPill = el('span', {
      class: 'today-time-status-pill',
      text: pendingItems.length > 0 ? '待服用' : '部分已服',
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

    // 缩略图（三级降级管线：实拍照/AI白底大图 -> 3D 拟物图 -> B 方案色块药盒矢量占位）
    const thumb = el('div', { class: 'today-card-thumb' });
    const photoUrl = photoUrls.get(item.med.id);
    if (photoUrl) {
      const img = el('img', {
        src: photoUrl,
        alt: item.med.name,
        loading: 'lazy',
      }) as HTMLImageElement;
      img.onerror = () => {
        thumb.replaceChildren(parseSvg(renderBPackageSvg(item.med)));
      };
      thumb.append(img);
    } else {
      const threeD = getOrCreateMed3DImage(item.med.id, item.med.name, item.med.amountPerDose || item.med.dosageText);
      if (threeD && !threeD.startsWith('data:image/svg+xml')) {
        const img = el('img', {
          src: threeD,
          alt: item.med.name,
          loading: 'lazy',
        }) as HTMLImageElement;
        img.onerror = () => {
          thumb.replaceChildren(parseSvg(renderBPackageSvg(item.med)));
        };
        thumb.append(img);
      } else {
        thumb.replaceChildren(parseSvg(renderBPackageSvg(item.med)));
      }
    }

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
      if (isReadOnly) {
        toast(isTaken ? '正在查看历史记录，仅当天可操作打卡' : '非今日用药安排仅供查看，当天方可打卡');
        return;
      }
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
      if (isReadOnly) {
        toast(`正在查看 ${item.med.name} 记录，当天方可打卡`);
        return;
      }
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
