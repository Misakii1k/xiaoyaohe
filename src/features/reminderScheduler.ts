// PWA 前台尽力提醒：浏览器后台会节流，页面关闭后不保证送达。
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
  SLOT_LABEL,
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
  buildMedicationReminderPlan,
  buildReminderBody,
  buildReminderTitle,
} from './medicationReminderPlan';
import { getSyncV2PublicConfig } from '../sync/v2/publicConfig';

const TICK_MS = 60_000;
let timer: number | null = null;
let tickInFlight: Promise<void> | null = null;
const onVisibilityChange = (): void => {
  if (!document.hidden) void tick();
};
const onOnline = (): void => void tick();
const onNavigation = (): void => void tick();
const onCapabilityChange = (): void => void tick();

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
  // 联网恢复后追一次（顺便会触发同步走自己的通道）
  window.addEventListener('online', onOnline);
  window.addEventListener('hashchange', onNavigation);
  window.addEventListener(REMINDER_CAPABILITY_CHANGE_EVENT, onCapabilityChange);
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
  const [meds, rules, revisions, logs] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
    listLogs(),
  ]);
  const role = getSyncV2PublicConfig()?.role;
  return reconcileScheduledNotifications(
    buildMedicationReminderPlan({ meds, rules, revisions, logs, role }),
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
  const native = isNativeReminderPlatform();
  const [meds, rules, revisions, logs] = await Promise.all([
    listMeds(),
    listRules(),
    listScheduleRevisions(),
    native ? listLogs() : Promise.resolve([]),
  ]);
  const cfg = getSyncV2PublicConfig();
  const role = cfg?.role; // 未配置同步则 undefined → 既不当照护者也不当患者，纯单机
  if (native) {
    await reconcileScheduledNotifications(
      buildMedicationReminderPlan({ meds, rules, revisions, logs, role }),
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

    // 患者侧（或未配置同步的单机）发吃药通知；纯照护者不发患者通知（避免吵到照护者）
    const sendPatientPing = role !== 'caregiver';
    if (sendPatientPing) {
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

    // 照护者升级：超时仍 pending → 提醒照护者去关心
    if (role === 'caregiver' && minsLate >= policy.notifyCaregiverAfterMin) {
      const careTag = logId + '_care';
      const carePs = await getPushState(careTag);
      // 只发一次升级通知，避免重复打扰照护者
      if (!carePs || carePs.count === 0) {
        const sent = await showNotification('⚠️ 患者未确认服药', {
          body: `${med.name}（${SLOT_LABEL[rule.slot]}）已超 ${minsLate} 分钟未确认`,
          tag: careTag,
          key: 'care',
          data: { kind: 'escalate', logId, occurrenceId: logId, medId: med.id },
        });
        if (sent) await putPushState({ id: careTag, count: 1, lastSentAt: Date.now() });
      }
    }
  }
}
