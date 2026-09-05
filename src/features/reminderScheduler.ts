// Android App 由原生闹钟负责后台提醒；网页端由 Service Worker 尽力补发。
// 两端的前台状态（本地计划、升级重复提醒）都在这里维护。
import {
  listLogs,
  listMeds,
  listPushStates,
  listReminderPeriodSettings,
  listRules,
  listScheduleRevisions,
  putPushState,
} from '../db/local';
import {
  type Medication,
  type MedicationReminderMode,
  type ReminderRule,
} from '../db/schema';
import {
  createScheduleRevision,
  isScheduleRestDay,
  toLocalDate,
} from '../domain/medicationSchedule';
import {
  REMINDER_CAPABILITY_CHANGE_EVENT,
  getPermission,
  isNativeReminderPlatform,
  notificationsSupported,
  reconcileScheduledNotifications,
  refreshPermission,
  showNotification,
} from './notifier';
import {
  NOTIFICATION_PREF_CHANGE_EVENT,
  isAppNotificationsEnabled,
} from './notificationPreference';
import {
  buildMedicationReminderPlan,
  buildReminderGroupBody,
  type ReminderGroupOccurrence,
} from './medicationReminderPlan';
import type { ScheduledReminderNotification } from './reminderTransport';
import { triggerReminderVibration } from './reminderVibration';
import { replayPendingMedicationReminderActions } from './reminderActions';

const TICK_MS = 60_000;
const NAVIGATION_RECONCILE_THROTTLE_MS = 2 * 60_000;
let timer: number | null = null;
let tickInFlight: Promise<void> | null = null;
let lastReconcileAt = 0;
const onVisibilityChange = (): void => {
  if (!document.hidden) void tick();
};
const onOnline = (): void => void tick();
const onNavigation = (): void => {
  // 路由切换会频繁触发 hashchange；距上次 reconcile 不足 2 分钟就跳过，
  // 避免每次切页都全量重建原生闹钟。
  if (Date.now() - lastReconcileAt < NAVIGATION_RECONCILE_THROTTLE_MS) return;
  void tick();
};
const onTimezoneChange = (): void => void tick();
const onCapabilityChange = (): void => void tick();
const onNotificationPrefChange = (): void => void tick();

export function startReminderScheduler(): void {
  if (timer != null) return;
  if (!notificationsSupported()) return;
  // 原生端首次调度延迟一点，给 WebView/插件初始化时间；
  // 且 Android 上若旧闹钟已顶满，立刻 schedule 会在原生线程直接杀进程。
  void refreshPermission().then((permission) => {
    if (permission !== 'granted') return;
    const delayMs = isNativeReminderPlatform() ? 1500 : 0;
    window.setTimeout(() => void tick(), delayMs);
  });
  timer = window.setInterval(() => void tick(), TICK_MS);
  // 回到前台立即追一次（设备可能挂起期间错过若干 tick）
  document.addEventListener('visibilitychange', onVisibilityChange);
  // 联网恢复后追一次，便于系统服务恢复时重建提醒。
  window.addEventListener('online', onOnline);
  window.addEventListener('hashchange', onNavigation);
  // 时区变更后原排程时刻全部失效，立即重排
  window.addEventListener('timezonechange', onTimezoneChange);
  window.addEventListener(REMINDER_CAPABILITY_CHANGE_EVENT, onCapabilityChange);
  window.addEventListener(NOTIFICATION_PREF_CHANGE_EVENT, onNotificationPrefChange);
}

export function stopReminderScheduler(): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('online', onOnline);
  window.removeEventListener('hashchange', onNavigation);
  window.removeEventListener('timezonechange', onTimezoneChange);
  window.removeEventListener(REMINDER_CAPABILITY_CHANGE_EVENT, onCapabilityChange);
  window.removeEventListener(NOTIFICATION_PREF_CHANGE_EVENT, onNotificationPrefChange);
}

/**
 * 判断今日是否为该 rule 的停药期（rest 日）。
 * - rule 无 cycle：返回 false（每日服药）
 * - rule 有 cycle 但 med.createdAt 缺失：返回 false（无法计算，按每日处理）
 * - 有明确 cycleStartDate 时按本地日历天计算，避免夏令时和创建时刻错位
 * - 旧数据缺少周期首日时暂按服药日处理，并由 schedule revision 标记待复核
 */
export function isRestDay(med: Medication, rule: ReminderRule, now: number): boolean {
  if (!rule.cycle) return false;
  const date = toLocalDate(now);
  const revision = createScheduleRevision(med, rule, {
    effectiveDate: date,
    createdAt: rule.updatedAt || now,
  });
  return isScheduleRestDay(revision, date);
}

/** 立即跑一次（暴露给测试按钮 / 设置页） */
export async function runOnce(): Promise<void> {
  await refreshPermission();
  await tick();
}

/**
 * 规则、时区或权限变化后重建排期。
 * 原生端重建系统闹钟，网页端刷新交给 Service Worker 的补发计划——
 * 两者都必须在用户改完规则的当下就更新，否则会按旧规则提醒。
 */
export async function rescheduleMedicationReminders() {
  if (!notificationsSupported()) return undefined;
  await refreshPermission();
  if (getPermission() !== 'granted') return undefined;
  let result;
  if (!isAppNotificationsEnabled()) {
    // Clear OS schedules when the in-app switch is off.
    result = await reconcileScheduledNotifications([]);
  } else {
    const [meds, rules, revisions, logs, periodSettings] = await Promise.all([
      listMeds(),
      listRules(),
      listScheduleRevisions(),
      listLogs(),
      listReminderPeriodSettings(),
    ]);
    result = await reconcileScheduledNotifications(
      buildMedicationReminderPlan({ meds, rules, revisions, logs, periodSettings }),
    );
  }
  lastReconcileAt = Date.now();
  warnIfTruncated(result);
  return result;
}

async function tick(): Promise<void> {
  tickInFlight ??= runTick().finally(() => {
    tickInFlight = null;
  });
  return tickInFlight;
}

/** planner 生成的组载荷（V2）：一个 (日期, 时段) 的整体提醒 */
interface ReminderGroupData {
  kind: 'reminder-group';
  groupId: string;
  dueAt: number;
  mode: MedicationReminderMode;
  reminderCount: number;
  occurrences: ReminderGroupOccurrence[];
}

function isReminderGroupData(data: unknown): data is ReminderGroupData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'reminder-group'
  );
}

/** 网页轮询视角的一个提醒组 */
interface DueReminderGroup {
  /** 组触发时刻（时段设置 timeLocal 当日） */
  dueAt: number;
  /** 时段提醒方式：振动等行为按组 mode 执行 */
  mode: MedicationReminderMode;
  /** 组内待服药物明细（用于实时生成正文，反映当前迟到分钟数） */
  occurrences: ReminderGroupOccurrence[];
  /** 该组在计划中的各跳提醒（dose / repeat-N） */
  notifications: ScheduledReminderNotification[];
}

async function runTick(): Promise<void> {
  if (getPermission() !== 'granted') return;
  // 原生端后台或定时唤醒时，优先把 SharedPreferences 中未处理的原生打卡动作补收入库，
  // 确保随后的 buildMedicationReminderPlan 能基于最新服药状态计算，避免旧闹钟重复提醒。
  await replayPendingMedicationReminderActions().catch(() => 0);
  if (!isAppNotificationsEnabled()) {
    // 关掉应用内开关时两端都要清空已下发的排期，否则系统闹钟／SW 计划会继续响。
    const result = await reconcileScheduledNotifications([]);
    lastReconcileAt = Date.now();
    warnIfTruncated(result);
    return;
  }
  const native = isNativeReminderPlatform();
  const [meds, rules, revisions, logs, periodSettings] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
    listLogs(),
    listReminderPeriodSettings(),
  ]);
  const plan = buildMedicationReminderPlan({ meds, rules, revisions, logs, periodSettings });
  const result = await reconcileScheduledNotifications(plan);
  lastReconcileAt = Date.now();
  warnIfTruncated(result);
  // 原生端到此为止：系统闹钟会自己响，前台再发一遍就是重复通知。
  if (native) return;
  // 网页端上面那次 reconcile 只是把计划交给 Service Worker 兜底补发；
  // 页面开着的这段时间仍由下面的轮询负责准点提醒和升级重复。
  if (!rules.length) return;
  // 前台轮询视图保留已过点阶段：到点组的「当前跳」即使时刻已过也要能发出去
  // （reconcile 给 SW 的计划已过滤过点项，两者互不干扰）。
  const tickPlan = buildMedicationReminderPlan({
    meds,
    rules,
    revisions,
    logs,
    periodSettings,
    keepPastPhases: true,
  });

  // 按 (日期, 时段) 组轮询：每组到点发一条整体提醒，pushState 按组 id 计数。
  const now = Date.now();
  const groups = new Map<string, DueReminderGroup>();
  for (const notification of tickPlan) {
    if (!isReminderGroupData(notification.data)) continue;
    let group = groups.get(notification.data.groupId);
    if (!group) {
      group = {
        dueAt: notification.data.dueAt,
        mode: notification.data.mode,
        occurrences: notification.data.occurrences,
        notifications: [],
      };
      groups.set(notification.data.groupId, group);
    }
    group.notifications.push(notification);
  }
  const dueGroupIds = [...groups.entries()]
    .filter(([, group]) => group.dueAt <= now)
    .map(([groupId]) => groupId);
  if (!dueGroupIds.length) return;
  const pushStates = await listPushStates(dueGroupIds);
  const pushStateMap = new Map(pushStates.map((state) => [state.id, state]));

  for (const groupId of dueGroupIds) {
    const group = groups.get(groupId)!;
    const ps = pushStateMap.get(groupId) ?? { id: groupId, count: 0, lastSentAt: 0 };
    // 按组依次发出计划中的 dose / repeat-N；各跳 at 已由时段设置的重复策略
    // （repeatEveryMin）编码，到点即发，不依赖上次发送时刻，页面挂起恢复后也能跟上节奏。
    const next = ps.count + 1;
    const notification = group.notifications.find(
      (candidate) => isReminderGroupData(candidate.data) && candidate.data.reminderCount === next,
    );
    if (!notification || notification.at > now) continue;
    const minsLate = Math.floor((now - group.dueAt) / 60000);
    const sent = await showNotification(notification.title, {
      body: buildReminderGroupBody(group.occurrences, minsLate),
      tag: groupId,
      key: notification.key ?? 'dose',
      data: notification.data,
    });
    if (sent) {
      // 振动按组 mode 执行（与原生闹钟一致的强提醒行为）
      triggerReminderVibration(group.mode);
      await putPushState({ id: groupId, count: next, lastSentAt: now });
    }
  }
}

function warnIfTruncated(result: { truncated?: number } | undefined): void {
  const truncated = result?.truncated ?? 0;
  if (truncated > 0) {
    console.warn(`[medbox] 提醒数量已达上限，部分提醒未排入（${truncated} 条）。`);
  }
}
