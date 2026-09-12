// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativePlugin = {
  getInstalledApkPath: vi.fn(),
  startServer: vi.fn(),
  stopServer: vi.fn(),
  download: vi.fn(),
  verifyApk: vi.fn(),
  installApk: vi.fn(),
  deleteApk: vi.fn(),
  probePeer: vi.fn(),
  scanSubnet: vi.fn(),
  downloadHttp: vi.fn(),
  downloadAndUnpackBundle: vi.fn(),
  applyWebBundle: vi.fn(),
  resetWebBundle: vi.fn(),
  getActiveWebBundle: vi.fn(),
  addListener: vi.fn(),
};

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: () => nativePlugin,
}));

vi.mock('../src/features/notifier', () => ({ showNotification: vi.fn() }));

const {
  checkFastCloudVersion,
  checkGithubRelease,
  downloadAndApplyWebBundle,
} = await import('../src/sync/lan/apkTransport');

describe('Web 增量热更新机制与判断逻辑', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('当云端 version.json 提供增量包且底座满足要求时，判定为 incremental', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '1.0.13',
        versionCode: 48,
        downloadUrl: '/api/download?tag=v1.0.13',
        fileSize: 18000000,
        bundleUrl: '/api/download?tag=v1.0.13&asset=bundle',
        bundleSize: 1800000,
        bundleSha256: 'b'.repeat(64),
        minNativeVersionCode: 40,
        releaseNotes: '增量热更新测试',
      }),
    });

    const update = await checkFastCloudVersion();
    expect(update).not.toBeNull();
    expect(update?.version).toBe('1.0.13');
    expect(update?.versionCode).toBe(48);
    expect(update?.updateType).toBe('incremental');
    expect(update?.bundleUrl).toBe('https://xiaoyaohe.pages.dev/api/download?tag=v1.0.13&asset=bundle');
    expect(update?.bundleSize).toBe(1800000);
    expect(update?.bundleSha256).toBe('b'.repeat(64));
    expect(update?.minNativeVersionCode).toBe(40);
  });

  it('当云端增量包要求的最低底座版本高于本机时，降级判定为 full 安装包更新', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '1.0.13',
        versionCode: 48,
        downloadUrl: '/api/download?tag=v1.0.13',
        fileSize: 18000000,
        bundleUrl: '/api/download?tag=v1.0.13&asset=bundle',
        bundleSize: 1800000,
        bundleSha256: 'c'.repeat(64),
        minNativeVersionCode: 9999, // 极高底座要求
        releaseNotes: '大版本原生升级',
      }),
    });

    const update = await checkFastCloudVersion();
    expect(update).not.toBeNull();
    expect(update?.version).toBe('1.0.13');
    expect(update?.updateType).toBe('full');
    expect(update?.downloadUrl).toBe('https://xiaoyaohe.pages.dev/api/download?tag=v1.0.13');
  });

  it('当 GitHub Release 包含 web-bundle.zip 资产时，正确解析增量包地址与体积', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: 'v1.0.13',
        body: 'GitHub 增量包发布说明',
        assets: [
          {
            name: 'xiaoyaohe-1.0.13-android-release.apk',
            size: 18500000,
            browser_download_url: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.13',
          },
          {
            name: 'xiaoyaohe-1.0.13-web-bundle.zip',
            size: 1950000,
            browser_download_url: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.13&asset=bundle',
          },
        ],
      }),
    });

    const update = await checkGithubRelease();
    expect(update).not.toBeNull();
    expect(update?.version).toBe('1.0.13');
    expect(update?.source).toBe('github');
    expect(update?.bundleUrl).toBe('https://xiaoyaohe.pages.dev/api/download?tag=v1.0.13&asset=bundle');
    expect(update?.bundleSize).toBe(1950000);
    expect(update?.fileSize).toBe(18500000);
  });

  it('downloadAndApplyWebBundle 成功调用原生插件下载解压并激活基座', async () => {
    nativePlugin.downloadAndUnpackBundle.mockResolvedValue({
      success: true,
      version: '1.0.9',
      basePath: '/data/user/0/com.medbox.app/files/bundles/1.0.9',
    });
    nativePlugin.applyWebBundle.mockResolvedValue({
      success: true,
      basePath: '/data/user/0/com.medbox.app/files/bundles/1.0.9',
    });

    const update = {
      version: '1.0.9',
      versionCode: 44,
      source: 'cloud' as const,
      updateType: 'incremental' as const,
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.9',
      bundleUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.9&asset=bundle',
      bundleSize: 1800000,
      bundleSha256: 'd'.repeat(64),
      discoveredAt: Date.now(),
    };

    const statusUpdates: string[] = [];
    const success = await downloadAndApplyWebBundle(update, (s) => statusUpdates.push(s));

    expect(success).toBe(true);
    expect(nativePlugin.downloadAndUnpackBundle).toHaveBeenCalledWith({
      url: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.9&asset=bundle',
      version: '1.0.9',
      sha256: 'd'.repeat(64),
    });
    expect(nativePlugin.applyWebBundle).toHaveBeenCalledWith({
      basePath: '/data/user/0/com.medbox.app/files/bundles/1.0.9',
    });
    expect(statusUpdates).toContain('正在下载轻量更新包...');
    expect(statusUpdates).toContain('正在激活新版本...');
  });

  it('downloadAndApplyWebBundle 在下载地址非白名单时安全拦截', async () => {
    const update = {
      version: '1.0.9',
      versionCode: 44,
      source: 'cloud' as const,
      updateType: 'incremental' as const,
      bundleUrl: 'https://evil-site.com/bundle.zip', // 非法域名
      discoveredAt: Date.now(),
    };

    await expect(downloadAndApplyWebBundle(update)).rejects.toThrow('增量更新包下载地址不可信');
  });
});
