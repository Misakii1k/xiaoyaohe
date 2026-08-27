// 液态玻璃（Liquid Glass）效果开关。
// 与 theme.ts 同一条路径：视觉侧只看 <html data-liquid="on|off">，
// CSS（liquid-glass.css）只在属性为 on 时命中；off 时完全回退普通毛玻璃。

export type LiquidGlassPreference = 'on' | 'off';

const STORAGE_KEY = 'medbox.liquid-glass';

let currentPreference: LiquidGlassPreference | null = null;

function isLiquidGlassPreference(value: unknown): value is LiquidGlassPreference {
  return value === 'on' || value === 'off';
}

export function getLiquidGlassPreference(): LiquidGlassPreference {
  if (currentPreference) return currentPreference;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isLiquidGlassPreference(raw)) return raw;
  } catch {
    /* localStorage 可能不可用（隐私模式）；退回默认开启 */
  }
  // 默认开启：低端设备用户可在 设置→外观 手动关闭以省电。
  return 'on';
}

export function isLiquidGlassEnabled(): boolean {
  return getLiquidGlassPreference() === 'on';
}

export function applyLiquidGlassPreference(
  preference: LiquidGlassPreference = getLiquidGlassPreference(),
): void {
  document.documentElement.dataset.liquid = preference;
}

export function setLiquidGlassPreference(preference: LiquidGlassPreference): void {
  currentPreference = preference;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* 存不进去也照常生效，仅本次会话内有效 */
  }
  applyLiquidGlassPreference(preference);
}

/** 启动时调用一次：尽早落属性，避免首帧材质闪变。 */
export function initLiquidGlass(): void {
  applyLiquidGlassPreference(getLiquidGlassPreference());
}

/** 测试辅助：清空内存中的偏好缓存。 */
export function resetLiquidGlassPreferenceCacheForTests(): void {
  currentPreference = null;
}
