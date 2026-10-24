// 提醒触发时调用振动：覆盖所有提醒模式。
// - web/PWA 路径用 navigator.vibrate（不支持的环境静默 no-op）。
// - Android strong 模式由原生 NotificationChannel 配置 + 原生显式 Vibrator 兜底；
//   这里在 web 层即时通知后补一次，确保非原生路径与 PWA 也有触觉反馈。
// - 全屏模式原生 MedicicationAlarmActivity 已显式振动，这里不重复驱动（pattern 与原生一致仅作 web 兜底）。

type ReminderMode = 'strong' | 'fullscreen-short' | 'fullscreen-persistent' | undefined;

const PATTERNS: Record<NonNullable<ReminderMode>, number[]> = {
  strong: [0, 400, 200, 400],
  'fullscreen-short': [0, 700, 250, 700, 250, 700],
  'fullscreen-persistent': [0, 700, 250, 700, 250, 700],
};

/** 在提醒通知发出后调用一次。pattern 按模式选；mode 未知时走 strong 节奏。 */
export function triggerReminderVibration(mode?: ReminderMode): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (pattern: number[] | number) => boolean };
    if (typeof nav.vibrate !== 'function') return;
    const pattern = (mode && PATTERNS[mode]) || PATTERNS.strong;
    nav.vibrate(pattern);
  } catch {
    /* 振动不可用或不被允许时静默 */
  }
}

/**
 * 触感微反馈：轻微触感（12ms 极短微振动），用于服药打卡、核心保存与关键交互。
 * 平台不支持或权限未授予时静默降级。
 */
export function triggerHapticFeedback(durationMs = 12): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (pattern: number[] | number) => boolean };
    if (typeof nav.vibrate === 'function') {
      nav.vibrate(durationMs);
    }
  } catch {
    /* 振动不可用或不被允许时静默 */
  }
}
