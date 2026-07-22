// Android App 由原生闹钟负责后台提醒；这里维护本地计划与前台状态。
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

const TICK_MS = 60_000;
let timer: number | null = null;
let tickInFlight: Promise<void> | null = null;
const onVisibilityChange = (): void => {
  if (!document.hidden) void tick();
};
const onOnline = (): void => void tick();
const onNavigation = (): void => void tick();
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

/** Rebuild the native OS schedule after rules, timezone, or permissions change. */
export async function rescheduleMedicationReminders() {
  if (!isNativeReminderPlatform()) return undefined;
  await refreshPermission();
  if (getPermission() !== 'granted') return undefined;
  if (!isAppNotificationsEnabled()) {
    // Clear OS schedules when the in-app switch is off.
    return reconcileScheduledNotifications([]);
  }
  const [meds, rules, revisions, logs] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
    listLogs(),
  ]);
  return reconcileScheduledNotifications(
    buildMedicationReminderPlan({ meds, rules, revisions, logs }),
  );
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
    if (isNativeReminderPlatform()) {
      await reconcileScheduledNotifications([]);
    }
    return;
  }
  const native = isNativeReminderPlatform();
  const [meds, rules, revisions, logs] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
    native ? listLogs() : Promise.resolve([]),
  ]);
  if (native) {
    await reconcileScheduledNotifications(
      buildMedicationReminderPlan({ meds, rules, revisions, logs }),
    );
    return;
  }
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
      const sent = await showNotification(buildReminderTitle(med, next), {
        body: buildReminderBody(med, entry.revision, minsLate),
        tag: logId,
        key: next === 1 ? 'dose' : `repeat-${next}`,
        data: { kind: 'reminder', logId, occurrenceId: logId, medId: med.id, reminderCount: next },
      });
      if (sent) await putPushState({ id: logId, count: next, lastSentAt: Date.now() });
    }
  }
}
