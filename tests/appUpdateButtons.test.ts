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
      version: '1.1.6',
      versionCode: 64,
      source: 'cloud',
      updateType: 'full',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.1.6',
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
      version: '1.1.6',
      versionCode: 64,
      source: 'cloud',
      updateType: 'incremental',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.1.6',
      bundleUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.1.6&asset=bundle',
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
});
