// Android App 由原生闹钟负责后台提醒；网页端由 Service Worker 尽力补发。
// 两端的前台状态（本地计划、升级重复提醒）都在这里维护。
import {
  listMeds,
  listLogs,
  listRules,
  listScheduleRevisions,
  getLogForOccurrence,
  getPushState,
  putPushState,
} from '../db/local';
import {
  type Medication,
  type ReminderRule,
} from '../db/schema';
import {
  createScheduleRevision,
  projectScheduleDate,
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
  buildReminderBody,
  buildReminderTitle,
} from './medicationReminderPlan';
import { triggerReminderVibration } from './reminderVibration';

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
    const [meds, rules, revisions, logs] = await Promise.all([
      listMeds(),
      listRules(),
      listScheduleRevisions(),
      listLogs(),
    ]);
    result = await reconcileScheduledNotifications(
      buildMedicationReminderPlan({ meds, rules, revisions, logs }),
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

async function runTick(): Promise<void> {
  if (getPermission() !== 'granted') return;
  if (!isAppNotificationsEnabled()) {
    // 关掉应用内开关时两端都要清空已下发的排期，否则系统闹钟／SW 计划会继续响。
    const result = await reconcileScheduledNotifications([]);
    lastReconcileAt = Date.now();
    warnIfTruncated(result);
    return;
  }
  const native = isNativeReminderPlatform();
  const [meds, rules, revisions, logs] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
    listLogs(),
  ]);
  const result = await reconcileScheduledNotifications(
    buildMedicationReminderPlan({ meds, rules, revisions, logs }),
  );
  lastReconcileAt = Date.now();
  warnIfTruncated(result);
  // 原生端到此为止：系统闹钟会自己响，前台再发一遍就是重复通知。
  if (native) return;
  // 网页端上面那次 reconcile 只是把计划交给 Service Worker 兜底补发；
  // 页面开着的这段时间仍由下面的轮询负责准点提醒和升级重复。
  if (!rules.length) return;
  const medMap = new Map(meds.map((m) => [m.id, m]));
  const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
  const now = new Date();
  const date = toLocalDate(now);
  const entries = projectScheduleDate(revisions, date);

  for (const entry of entries) {
    const occurrence = entry.occurrence;
    if (!occurrence) continue;
    const med = medMap.get(occurrence.medId);
    const rule = ruleMap.get(occurrence.sourceRuleId);
    if (!med || !rule) continue;
    const dueAt = occurrence.dueAt;
    if (dueAt > now.getTime()) continue; // 还没到点

    const log = await getLogForOccurrence(occurrence);
    if (log?.status === 'taken' || log?.status === 'skipped') continue;

    const logId = occurrence.id;
    const ps = (await getPushState(logId)) ?? { id: logId, count: 0, lastSentAt: 0 };
    const minsLate = Math.floor((Date.now() - dueAt) / 60000);
    const minsSinceLast = (Date.now() - ps.lastSentAt) / 60000;
    const policy = rule.escalate;

    let shouldSend = false;
    if (ps.count === 0) shouldSend = true;
    else if (ps.count < policy.maxRepeats + 1 && minsSinceLast >= policy.repeatEveryMin) shouldSend = true;
    if (shouldSend) {
      const next = ps.count + 1;
      const reminderMode = med.reminderMode;
      const sent = await showNotification(buildReminderTitle(med, next), {
        body: buildReminderBody(med, entry.revision, minsLate),
        tag: logId,
        key: next === 1 ? 'dose' : `repeat-${next}`,
        data: { kind: 'reminder', logId, occurrenceId: logId, medId: med.id, reminderCount: next, reminderMode },
      });
      if (sent) {
        // 所有提醒模式都补一次 web 层振动；原生路径若已振动也会被覆盖，不影响效果
        triggerReminderVibration(reminderMode);
        await putPushState({ id: logId, count: next, lastSentAt: Date.now() });
      }
    }
  }
}

function warnIfTruncated(result: { truncated?: number } | undefined): void {
  const truncated = result?.truncated ?? 0;
  if (truncated > 0) {
    console.warn(`[medbox] 提醒数量已达上限，部分提醒未排入（${truncated} 条）。`);
  }
}
