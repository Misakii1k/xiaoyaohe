// 主题（浅色 / 深色 / 跟随系统）三态管理。
// 视觉侧只写 <html data-theme="light|dark">，CSS 的暗色变体都挂在这个属性上；
// color-scheme 在 tokens.css 已声明 light dark，系统表单控件/滚动条会跟着走。

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'medbox.theme-preference';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** 与 index.html 的 theme-color meta、tokens.css 的暗色底色保持一致。 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: '#f2f3f6',
  dark: '#17181d',
};

let mediaListenerInstalled = false;
let currentPreference: ThemePreference | null = null;

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getThemePreference(): ThemePreference {
  if (currentPreference) return currentPreference;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(raw)) return raw;
  } catch {
    /* localStorage 可能不可用（隐私模式）；退回 system */
  }
  return 'system';
}

export function resolveTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  if (preference === 'system') {
    return typeof window.matchMedia === 'function' && window.matchMedia(MEDIA_QUERY).matches
      ? 'dark'
      : 'light';
  }
  return preference;
}

export function applyTheme(preference: ThemePreference = getThemePreference()): ResolvedTheme {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  syncThemeColorMeta(resolved);
  return resolved;
}

/** 让用户强制选择的主题盖过 index.html 里按系统默认的 theme-color meta。 */
function syncThemeColorMeta(resolved: ResolvedTheme): void {
  const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  if (metas.length === 0) return;
  const color = THEME_COLOR[resolved];
  metas.forEach((meta) => {
    meta.removeAttribute('media');
    meta.setAttribute('content', color);
  });
}

export function setThemePreference(preference: ThemePreference): ResolvedTheme {
  currentPreference = preference;
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    /* 存不进去也照常生效，仅本次会话内有效 */
  }
  return applyTheme(preference);
}

/** 启动时调用一次：应用已存偏好，并监听系统主题变化（仅当用户选「跟随系统」时跟随）。 */
export function initTheme(): void {
  applyTheme(getThemePreference());
  if (mediaListenerInstalled || typeof window.matchMedia !== 'function') return;
  mediaListenerInstalled = true;
  window.matchMedia(MEDIA_QUERY).addEventListener('change', () => {
    if (getThemePreference() === 'system') applyTheme('system');
  });
}

/** 测试辅助：清空内存中的偏好缓存。 */
export function resetThemePreferenceCacheForTests(): void {
  currentPreference = null;
}
