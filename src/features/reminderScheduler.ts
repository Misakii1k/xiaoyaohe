// 主线程提醒调度：每分钟检查到点规则 → 复用系统通知发提醒 + 防重复 + 升级文案。
// 应用前台时可靠；挂后台时取决于浏览器对标签页 setInterval 的节流（Android Chrome 仍会跑，
// 仅频率被压低，配合"应用添加到主屏 + 电池白名单"基本可用）。锁屏/应用完全关闭场景：
// 未来用 Web Push（自建 VAPID）兜底，不接入微信。
import {
  listMeds,
  listRules,
  getLog,
  putLog,
  getPushState,
  putPushState,
} from '../db/local';
import {
  SLOT_LABEL,
  formatMealRelsForSlot,
  type IntakeLog,
  type Medication,
  type ReminderRule,
  type Slot,
} from '../db/schema';
import { showNotification, getPermission, notificationsSupported } from './notifier';
import { getSyncConfig } from '../sync/config';

const TICK_MS = 60_000;
let timer: number | null = null;

export function startReminderScheduler(): void {
  if (timer != null) return;
  if (!notificationsSupported()) return;
  // 立即跑一次（启动追账），然后每分钟一次
  void tick();
  timer = window.setInterval(() => void tick(), TICK_MS);
  // 回到前台立即追一次（设备可能挂起期间错过若干 tick）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void tick();
  });
  // 联网恢复后追一次（顺便会触发同步走自己的通道）
  window.addEventListener('online', () => void tick());
}

export function stopReminderScheduler(): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 取传入时间戳当天的本地 0 点（毫秒） */
function startOfDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 判断今日是否为该 rule 的停药期（rest 日）。
 * - rule 无 cycle：返回 false（每日服药）
 * - rule 有 cycle 但 med.createdAt 缺失：返回 false（无法计算，按每日处理）
 * - 否则按 (今日 0 点 - createdAt) % (activeDays + restDays) 判断：
 *   dayInCycle >= activeDays 即为 rest 日
 */
export function isRestDay(med: Medication, rule: ReminderRule, now: number): boolean {
  if (!rule.cycle) return false;
  if (!med.createdAt) return false;
  const todayStartMs = startOfDayMs(now);
  const daysSinceStart = Math.floor((todayStartMs - med.createdAt) / MS_PER_DAY);
  if (daysSinceStart < 0) return false;
  const cycleLength = rule.cycle.activeDays + rule.cycle.restDays;
  if (cycleLength <= 0) return false;
  const dayInCycle = daysSinceStart % cycleLength;
  return dayInCycle >= rule.cycle.activeDays;
}

/** 立即跑一次（暴露给测试按钮 / 设置页） */
export async function runOnce(): Promise<void> {
  await tick();
}

async function tick(): Promise<void> {
  if (getPermission() !== 'granted') return;
  const [meds, rules] = await Promise.all([listMeds(), listRules()]);
  if (!rules.length) return;
  const medMap = new Map(meds.map((m) => [m.id, m]));
  const cfg = getSyncConfig();
  const role = cfg?.role; // 未配置同步则 undefined → 既不当照护者也不当患者，纯单机
  const now = new Date();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const med = medMap.get(rule.medId);
    if (!med) continue;
    if (med.daysOfWeek.length > 0 && !med.daysOfWeek.includes(now.getDay())) continue;
    // 周期用药：今日若为 rest 日则跳过该 rule（不生成提醒）
    if (isRestDay(med, rule, now.getTime())) continue;

    const dueAt = todayDueAt(now, rule.timeLocal);
    if (dueAt > now.getTime()) continue; // 还没到点

    const logId = `${rule.id}_${ymd(now)}`;
    let log = await getLog(logId);
    if (!log) {
      log = {
        id: logId,
        medId: med.id,
        slot: rule.slot,
        dueAt,
        status: 'pending',
        updatedAt: Date.now(),
      } satisfies IntakeLog;
      await putLog(log);
    }
    if (log.status !== 'pending') continue; // taken / skipped

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
        await showNotification(buildTitle(med, next), {
          body: buildBody(med, rule, minsLate),
          tag: logId,
          data: { kind: 'reminder', logId, medId: med.id },
        });
        await putPushState({ id: logId, count: next, lastSentAt: Date.now() });
      }
    }

    // 照护者升级：超时仍 pending → 提醒照护者去关心
    if (role === 'caregiver' && minsLate >= policy.notifyCaregiverAfterMin) {
      const careTag = logId + '_care';
      const carePs = await getPushState(careTag);
      // 只发一次升级通知，避免重复打扰照护者
      if (!carePs || carePs.count === 0) {
        await showNotification('⚠️ 患者未确认服药', {
          body: `${med.name}（${SLOT_LABEL[rule.slot]}）已超 ${minsLate} 分钟未确认`,
          tag: careTag,
          data: { kind: 'escalate', logId, medId: med.id },
        });
        await putPushState({ id: careTag, count: 1, lastSentAt: Date.now() });
      }
    }
  }
}

function todayDueAt(now: Date, timeLocal: string): number {
  const [h, m] = timeLocal.split(':').map((n) => parseInt(n, 10));
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function buildTitle(med: Medication, count: number): string {
  const icon = count === 1 ? '🔔' : count === 2 ? '⚠️' : '‼️';
  const prefix = count >= 3 ? `第 ${count} 次提醒` : '';
  return `${icon} ${prefix ? prefix + ' · ' : ''}该吃 ${med.name} 了`;
}

function buildBody(med: Medication, rule: ReminderRule, minsLate: number): string {
  const parts: string[] = [];
  if (med.amountPerDose) parts.push('每次 ' + med.amountPerDose);
  else if (med.dosageText) parts.push(med.dosageText);
  const meal = formatMealRelsForSlot(rule.slot, med.mealRelsBySlot);
  if (meal) parts.push(meal);
  parts.push(SLOT_LABEL[rule.slot as Slot]);
  if (minsLate >= 2) parts.push(`已迟 ${minsLate} 分钟`);
  return parts.join(' · ');
}
