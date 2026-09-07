import '../ui/styles/pages/today.css';
import {
  listMeds,
  listLogsByDay,
  listScheduleRevisions,
  setOccurrenceAction,
  setOccurrenceActions,
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
import { getUserAvatar3dSvg, parseSvg } from '../ui/assets3d';
import { getAvatarById, getActiveAvatarId } from '../ui/avatars';
import { openTakeMedModal } from '../ui/TakeMedModal';
import { navigate } from '../router';
import { closeNotificationsByTag } from '../features/notifier';

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

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

let activeSlotFilter: 'all' | 'morning' | 'noon' | 'evening' = 'all';

export async function renderTodayPage(root: HTMLElement, signal?: AbortSignal): Promise<void> {
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

  const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAY_CN[now.getDay()]}`;

  // 1. 顶部问候栏
  const headerRow = el('div', { class: 'today-header-row' });
  const headerLeft = el('div', { class: 'today-header-left' });
  headerLeft.append(
    el('h1', { class: 'today-header-title', text: '今天' }),
    el('div', { class: 'today-header-date', text: dateStr })
  );

  const headerActions = el('div', { class: 'today-header-actions' });
  const aiBtn = el('button', {
    class: 'today-ai-btn',
    type: 'button',
    'aria-label': '打开 AI 助手',
    title: '打开 AI 助手',
  } as any);
  aiBtn.append(icon('sparkles'), el('span', { text: 'AI 助手' }));
  aiBtn.onclick = () => void import('../ui/AiAssistant').then((m) => m.openAssistantPanel());

  const activeAvatar = getAvatarById(getActiveAvatarId());
  const avatarBtn = el('button', {
    class: 'today-header-avatar-btn',
    type: 'button',
    'aria-label': '个人中心',
    style: `background-color: ${activeAvatar.bgColor};`,
  } as any);
  if (activeAvatar.imgUrl) {
    const avatarImg = el('img', {
      class: 'today-header-avatar-img',
      src: activeAvatar.imgUrl,
      alt: activeAvatar.name,
    });
    avatarBtn.append(avatarImg);
  } else {
    avatarBtn.append(parseSvg(getUserAvatar3dSvg()));
  }
  avatarBtn.onclick = () => navigate('/settings');

  headerActions.append(aiBtn, avatarBtn);
  headerRow.append(headerLeft, headerActions);
  content.append(headerRow);

  // 2. 今日用药进度卡片 (带 today-summary class)
  const progressCard = el('section', { class: 'today-summary' });
  progressCard.classList.add('today-progress-card');
  progressCard.append(el('div', { class: 'today-progress-title', text: '今日用药进度' }));

  const progressBody = el('div', { class: 'today-progress-body' });
  const ringWrap = el('div', { class: 'today-summary-progress' });
  ringWrap.classList.add('today-progress-ring-wrap');
  ringWrap.append(progressRing(taken, total));

  const legend = el('div', { class: 'today-progress-legend' });
  legend.append(
    createLegendRow('taken', '已服用', taken),
    createLegendRow('pending', '待服用', pending),
    createLegendRow('skipped', '跳过', skipped)
  );

  progressBody.append(ringWrap, legend);
  progressCard.append(progressBody);

  const encourage = el('div', {
    class: 'today-progress-encourage',
    text: total === 0 ? '今日没有用药计划' : pending === 0 ? '今日用药已全部完成' : `剩余 ${pending} 次用药待处理`,
  });
  progressCard.append(encourage);
  content.append(progressCard);

  // 3. 今日用药计划
  const sectionHeader = el('div', { class: 'today-section-header' });
  sectionHeader.append(el('h2', { class: 'today-section-title', text: '今日用药计划' }));
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

  if (!signal?.aborted) {
    renderPage({ root, title: '今天', activeTab: 'today', content });
  }
}

function createLegendRow(
  type: 'taken' | 'pending' | 'skipped',
  label: string,
  count: number
): HTMLElement {
  const row = el('div', { class: 'today-legend-item' });
  const dot = el('span', { class: `today-legend-dot ${type}` });
  dot.append(el('span', { class: 'today-legend-inner' }));

  const textWrap = el('span', { class: 'today-legend-text' });
  textWrap.append(
    document.createTextNode(`${label} `),
    el('strong', { class: 'today-legend-count', text: String(count) }),
    document.createTextNode(' 项')
  );

  row.append(dot, textWrap);
  return row;
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
  tag.append(icon(group.slot === 'morning' ? 'sun' : group.slot === 'noon' ? 'sun-high' : group.slot === 'evening' ? 'sunset' : 'moon'));
  tag.append(el('span', { text: `${group.earliestTime} ${slotName}` }));

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
    info.append(el('div', { class: 'today-card-meta', text: `${dose}${meal ? ' · ' + meal : ''} · 每日1次` }));

    const badges = el('div', { class: 'today-card-badges' });
    const stockCount = item.med.inventory?.remaining ?? 36;
    const isLow = stockCount <= (item.med.inventory?.lowThreshold ?? 5);
    const stockBadge = el('span', {
      class: `today-stock-tag ${isLow ? 'low' : 'ok'}`,
      text: isLow ? `库存不足 剩余${stockCount}片` : `库存充足 剩余${stockCount}片`,
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
