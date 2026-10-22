// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISMISSED_UPDATE_VERSION_KEY,
  LAST_UPDATE_PROMPT_DATE_KEY,
  maybeShowHomeUpdatePrompt,
  openHomeUpdateBottomSheet,
  shouldShowHomeUpdatePrompt,
} from '../src/ui/HomeUpdateBottomSheet';
import { closeAllBottomSheets } from '../src/ui/primitives/BottomSheet';
import type { AvailableUpdate } from '../src/sync/lan/apkTransport';
import { toLocalDate } from '../src/domain/medicationSchedule';

const mockUpdate: AvailableUpdate = {
  version: '2.0.0',
  versionCode: 100,
  source: 'cloud',
  updateType: 'incremental',
  downloadUrl: 'https://example.com/medbox.apk',
  bundleUrl: 'https://example.com/bundle.zip',
  bundleSize: 1024 * 1024,
  fileSize: 20 * 1024 * 1024,
  releaseNotes: '1. 修复用药提醒通知声音延迟问题。\n2. 优化药品清单加载速度。',
  discoveredAt: Date.now(),
};

describe('首页更新提醒抽屉（career-ops 规范）', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
  });

  afterEach(() => {
    closeAllBottomSheets();
    vi.restoreAllMocks();
  });

  it('展示数据安全承诺、版本跃迁与类型徽章（秒级更新/完整更新，绝无黑话）', () => {
    const handle = openHomeUpdateBottomSheet(mockUpdate);
    const sheet = handle.overlay.querySelector('.bottom-sheet.home-update-sheet')!;
    expect(sheet).not.toBeNull();

    // 1. 数据安全保障承诺
    const safetyText = sheet.querySelector('.home-update-safety-text')?.textContent;
    expect(safetyText).toBe('升级不会清除您的服药记录、药品清单或库存数据，请放心升级。');

    // 2. 版本跃迁
    const versionTo = sheet.querySelector('.home-update-version-to')?.textContent;
    expect(versionTo).toBe('v2.0.0');

    // 3. 类型徽章
    const badge = sheet.querySelector('.home-update-badge')?.textContent;
    expect(badge).toBe('秒级更新');
    expect(sheet.textContent).not.toContain('热更新');
    expect(sheet.textContent).not.toContain('DOM');
    expect(sheet.textContent).not.toContain('FAB');

    // 4. 双通道与本次跳过按钮
    const buttons = Array.from(sheet.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('一键秒级更新');
    expect(buttons).toContain('下载完整包');
    expect(buttons).toContain('本次跳过');

    handle.close();
  });

  it('当仅支持完整更新时展示完整更新徽章与单通道', () => {
    const fullOnlyUpdate: AvailableUpdate = {
      ...mockUpdate,
      updateType: 'full',
      bundleUrl: undefined,
    };
    const handle = openHomeUpdateBottomSheet(fullOnlyUpdate);
    const sheet = handle.overlay.querySelector('.bottom-sheet.home-update-sheet')!;

    const badge = sheet.querySelector('.home-update-badge')?.textContent;
    expect(badge).toBe('完整更新');

    const buttons = Array.from(sheet.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).not.toContain('一键秒级更新');
    expect(buttons).toContain('下载完整包');
    expect(buttons).toContain('本次跳过');

    handle.close();
  });

  it('遇到打卡弹窗（.take-med-overlay）或已有 bottom-sheet 时自动避让', () => {
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(true);

    // 存在打卡弹窗
    const takeMedOverlay = document.createElement('div');
    takeMedOverlay.className = 'take-med-overlay';
    document.body.append(takeMedOverlay);
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(false);
    takeMedOverlay.remove();
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(true);

    // 存在已有 bottom-sheet
    const sheetOverlay = document.createElement('div');
    sheetOverlay.className = 'bottom-sheet-overlay';
    document.body.append(sheetOverlay);
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(false);
    sheetOverlay.remove();
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(true);

    // 存在确认弹窗（confirm-dialog-overlay）
    const confirmOverlay = document.createElement('div');
    confirmOverlay.className = 'confirm-dialog-overlay';
    document.body.append(confirmOverlay);
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(false);
    confirmOverlay.remove();
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(true);
  });

  it('当更新版本不高于本机当前运行版本时自动避让不弹窗', () => {
    // 假设备用版本与本机一致或低于本机
    expect(shouldShowHomeUpdatePrompt({ ...mockUpdate, version: '1.0.0' })).toBe(false);
    expect(shouldShowHomeUpdatePrompt({ ...mockUpdate, version: 'v1.0.0' })).toBe(false);
  });

  it('用户点击“本次跳过”记录跳过版本号，该版本不再弹窗直到有更高版本', () => {
    const handle = openHomeUpdateBottomSheet(mockUpdate);
    const sheet = handle.overlay.querySelector('.bottom-sheet')!;
    const skipBtn = Array.from(sheet.querySelectorAll('button')).find((b) => b.textContent?.includes('本次跳过'))!;

    skipBtn.click();
    expect(localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY)).toBe('2.0.0');

    // 相同版本或更低版本不再弹出（支持带 v 前缀与不带 v 前缀）
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(false);
    expect(shouldShowHomeUpdatePrompt({ ...mockUpdate, version: 'v2.0.0' })).toBe(false);
    expect(shouldShowHomeUpdatePrompt({ ...mockUpdate, version: '1.9.9' })).toBe(false);

    // 有更高版本时恢复提醒
    expect(shouldShowHomeUpdatePrompt({ ...mockUpdate, version: '2.0.1' })).toBe(true);
    expect(shouldShowHomeUpdatePrompt({ ...mockUpdate, version: 'v2.0.1' })).toBe(true);
  });

  it('用户点击遮罩关闭记录当日已提醒日期，当天首屏不重复弹出，次日若仍有新版再次提醒', () => {
    const handle = openHomeUpdateBottomSheet(mockUpdate);
    // 模拟点击遮罩关闭（不点跳过）
    handle.overlay.click();

    const todayStr = toLocalDate(new Date());
    expect(localStorage.getItem(LAST_UPDATE_PROMPT_DATE_KEY)).toBe(todayStr);

    // 当天不重复弹出
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(false);

    // 次日（模拟修改记录日期）若仍有新版再次提醒
    localStorage.setItem(LAST_UPDATE_PROMPT_DATE_KEY, '2026-01-01');
    expect(shouldShowHomeUpdatePrompt(mockUpdate)).toBe(true);
  });

  it('秒级更新失败时自动切换至完整包下载通道并聚焦', async () => {
    const handle = openHomeUpdateBottomSheet(mockUpdate);
    const sheet = handle.overlay.querySelector('.bottom-sheet')!;
    const incBtn = Array.from(sheet.querySelectorAll('button')).find((b) => b.textContent?.includes('一键秒级更新'))!;
    const fullBtn = Array.from(sheet.querySelectorAll('button')).find((b) => b.textContent?.includes('下载完整包'))!;

    // 模拟秒级更新触发失败
    incBtn.click();
    await new Promise((r) => setTimeout(r, 50));

    expect(incBtn.style.display).toBe('none');
    expect(fullBtn.className).toContain('ui-button-primary');

    handle.close();
  });
});
