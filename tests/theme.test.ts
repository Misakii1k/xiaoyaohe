// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getThemePreference,
  setThemePreference,
  resolveTheme,
  applyTheme,
  initTheme,
  resetThemePreferenceCacheForTests,
} from '../src/ui/theme';

describe('theme.ts - 主题切换与跟随系统契约', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetThemePreferenceCacheForTests();
    delete document.documentElement.dataset.theme;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('默认偏好为 system，解析为 light（当 matchMedia 未匹配 dark）', () => {
    expect(getThemePreference()).toBe('system');
    expect(resolveTheme('system')).toBe('light');
  });

  it('setThemePreference 会更新 localStorage 并绑定 data-theme 到 <html>', () => {
    setThemePreference('dark');
    expect(getThemePreference()).toBe('dark');
    expect(window.localStorage.getItem('medbox.theme-preference')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    setThemePreference('light');
    expect(getThemePreference()).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('initTheme 挂载初始化主题并保持 DOM dataset 同步', () => {
    setThemePreference('dark');
    document.documentElement.dataset.theme = '';

    initTheme();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
