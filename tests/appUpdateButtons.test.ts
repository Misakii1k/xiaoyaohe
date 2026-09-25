// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildAppUpdateBody } from '../src/pages/settings/panels/AppUpdatePanel';
import { saveAvailableUpdate, clearAvailableUpdate, type AvailableUpdate } from '../src/sync/lan/apkTransport';

describe('软件更新操作按钮展示策略 (用户规则验证)', () => {
  let body: HTMLElement;
  let panelEl: HTMLElement;

  beforeEach(() => {
    clearAvailableUpdate();
    body = document.createElement('div');
    panelEl = document.createElement('section');
  });

  it('若更新的内容通过增量更新无法落实 (updateType === full)，只提供全量更新按钮', () => {
    const fullOnlyUpdate: AvailableUpdate = {
      version: '1.2.2',
      versionCode: 70,
      source: 'cloud',
      updateType: 'full',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.2',
      minNativeVersionCode: 58,
      releaseNotes: '包含全屏滑动解锁原生组件升级',
      discoveredAt: Date.now(),
    };
    saveAvailableUpdate(fullOnlyUpdate);

    buildAppUpdateBody(body, panelEl, true);

    const buttons = Array.from(body.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('下载并安装');
    expect(buttons).not.toContain('一键秒级更新');
    expect(buttons).not.toContain('下载完整包');
  });

  it('反之若支持增量更新 (updateType === incremental)，则两个按钮都提供 (一键秒级更新 + 下载完整包)', () => {
    const incrementalUpdate: AvailableUpdate = {
      version: '1.2.2',
      versionCode: 70,
      source: 'cloud',
      updateType: 'incremental',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.2',
      bundleUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.2&asset=bundle',
      bundleSize: 1800000,
      bundleSha256: 'a'.repeat(64),
      minNativeVersionCode: 58,
      releaseNotes: '前端优化更新',
      discoveredAt: Date.now(),
    };
    saveAvailableUpdate(incrementalUpdate);

    buildAppUpdateBody(body, panelEl, true);

    const buttons = Array.from(body.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('一键秒级更新');
    expect(buttons).toContain('下载完整包');
  });

  it('只能完整安装时，推荐行指向「下载并安装」并给出一句大白话理由', () => {
    saveAvailableUpdate({
      version: '1.2.2',
      versionCode: 70,
      source: 'cloud',
      updateType: 'full',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.2',
      fileSize: 20 * 1024 * 1024,
      discoveredAt: Date.now(),
    });
    buildAppUpdateBody(body, panelEl, true);

    const rec = body.querySelector('.app-update-recommend') as HTMLElement;
    expect(rec).not.toBeNull();
    expect(rec.dataset.recommend).toBe('full');
    expect(rec.textContent).toContain('推荐');
    expect(rec.textContent).toContain('下载并安装');
    expect(rec.textContent).not.toMatch(/增量|底座|versionCode|热更新/);
    const recommendedBtn = body.querySelector('button[data-recommended="true"]');
    expect(recommendedBtn?.textContent).toBe('下载并安装');
  });

  it('展示的更新说明剥掉注释元数据与黑话行', () => {
    saveAvailableUpdate({
      version: '1.2.2',
      versionCode: 70,
      source: 'cloud',
      updateType: 'full',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.2',
      releaseNotes: '# 小药盒 v1.2.2 更新说明\n\n1. 打卡更顺手。\n2. 优化 DOM 渲染。\n\n<!-- versionCode: 70 -->',
      discoveredAt: Date.now(),
    });
    buildAppUpdateBody(body, panelEl, true);

    const notes = body.querySelector('.app-update-release-notes')?.textContent ?? '';
    expect(notes).toContain('打卡更顺手');
    expect(notes).not.toContain('DOM');
    expect(notes).not.toContain('versionCode');
    expect(notes).not.toContain('<!--');
  });
});
