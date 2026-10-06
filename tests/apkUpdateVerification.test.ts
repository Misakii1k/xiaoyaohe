// @vitest-environment happy-dom
//
// APK 更新包的完整性防线。
//
// APK 字节流走的是明文 TCP 38473（见 ApkDistributionPlugin.java 的协议说明），
// 同网段的第三方有机会抢占端口或中间人掉包。真正的验签在原生侧（包名 + 签名证书 +
// 版本号），这里守的是 TS 侧的接线：下载完必须验、验不过必须删文件并中止，
// 绝不能把一个没验过的路径交给 installApk。
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  addListener: vi.fn(),
};

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: () => nativePlugin,
}));

import { showNotification } from '../src/features/notifier';

vi.mock('../src/features/notifier', () => ({ showNotification: vi.fn() }));

const {
  downloadUpdate,
  installApk,
  deleteApk,
  scanLanForUpdates,
  checkFastCloudVersion,
  checkGithubRelease,
  checkOnlineRelease,
  checkForAppUpdates,
  notifyIfUpdateAvailable,
  saveAvailableUpdate,
} = await import('../src/sync/lan/apkTransport');

const UPDATE = {
  version: '0.9.4',
  versionCode: 23,
  peerHost: '192.168.1.50',
  peerPort: 38473,
  discoveredAt: 0,
};

describe('局域网 APK 更新的安装前校验', () => {
  beforeEach(() => {
    for (const fn of Object.values(nativePlugin)) fn.mockReset();
    nativePlugin.download.mockResolvedValue({ bytes: 1024, destPath: '/cache/medbox-update-23.apk' });
    nativePlugin.deleteApk.mockResolvedValue({ deleted: true });
  });

  it('把「对方公告的版本号」作为期望值传给原生校验', async () => {
    nativePlugin.verifyApk.mockResolvedValue({
      packageName: 'com.medbox.app',
      versionCode: 23,
      versionName: '0.9.4',
    });

    const path = await downloadUpdate(UPDATE);

    expect(path).toBe('/cache/medbox-update-23.apk');
    // versionCode 来自已加密的同步通道，用它把不可信的明文下载绑到可信公告上
    expect(nativePlugin.verifyApk).toHaveBeenCalledWith({
      apkPath: '/cache/medbox-update-23.apk',
      expectedVersionCode: 23,
    });
  });

  it('校验不通过时中止、删除坏包，且绝不返回路径', async () => {
    nativePlugin.verifyApk.mockRejectedValue(new Error('安装包的签名与本机应用不一致，可能已被掉包'));

    await expect(downloadUpdate(UPDATE)).rejects.toThrow(/校验未通过/);

    // 坏包必须落地即删，不能给用户留一个「点一下就装」的文件
    expect(nativePlugin.deleteApk).toHaveBeenCalledWith({ apkPath: '/cache/medbox-update-23.apk' });
    expect(nativePlugin.installApk).not.toHaveBeenCalled();
  });

  it('下载本身失败时不会误报成校验问题', async () => {
    nativePlugin.download.mockRejectedValue(new Error('connection refused'));

    await expect(downloadUpdate(UPDATE)).rejects.toThrow(/下载更新失败/);
    expect(nativePlugin.verifyApk).not.toHaveBeenCalled();
  });

  it('调用 installApk 时将 expectedVersionCode 传递给原生层以防止篡改', async () => {
    nativePlugin.installApk.mockResolvedValue(undefined);

    await installApk('/cache/medbox-update-23.apk', 23);
    expect(nativePlugin.installApk).toHaveBeenCalledWith({
      apkPath: '/cache/medbox-update-23.apk',
      expectedVersionCode: 23,
    });
  });

  it('调用 deleteApk 时调用原生层安全删除', async () => {
    nativePlugin.deleteApk.mockResolvedValue({ deleted: true });

    await deleteApk('/cache/medbox-update-23.apk');
    expect(nativePlugin.deleteApk).toHaveBeenCalledWith({
      apkPath: '/cache/medbox-update-23.apk',
    });
  });

  describe('主动扫描局域网获取新版本 (scanLanForUpdates)', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('当同子网设备有更高版本时，成功发现并记录到 localStorage', async () => {
      nativePlugin.scanSubnet.mockResolvedValue({ peers: [{ host: '192.168.1.120' }] });
      nativePlugin.probePeer.mockResolvedValue({ reachable: true });
      nativePlugin.download.mockResolvedValue({ bytes: 2048, destPath: 'medbox-update-probe.apk' });
      nativePlugin.verifyApk.mockResolvedValue({
        packageName: 'com.medbox.app',
        versionCode: 76,
        versionName: '1.2.6',
      });
      nativePlugin.deleteApk.mockResolvedValue({ deleted: true });

      const update = await scanLanForUpdates();

      expect(update).not.toBeNull();
      expect(update?.version).toBe('1.2.6');
      expect(update?.versionCode).toBe(76);
      expect(update?.peerHost).toBe('192.168.1.120');
      expect(update?.peerPort).toBe(38473);

      // 验证 probe 临时包已自动删除
      expect(nativePlugin.deleteApk).toHaveBeenCalledWith({ apkPath: 'medbox-update-probe.apk' });

      // 验证写入 localStorage
      const saved = localStorage.getItem('medbox.lan-sync.available-update.v1');
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!);
      expect(parsed.versionCode).toBe(76);
    });

    it('当探测到的版本不高于本机版本时，删除 probe 且返回 null', async () => {
      nativePlugin.scanSubnet.mockResolvedValue({ peers: [{ host: '192.168.1.120' }] });
      nativePlugin.probePeer.mockResolvedValue({ reachable: true });
      nativePlugin.download.mockResolvedValue({ bytes: 2048, destPath: 'medbox-update-probe.apk' });
      nativePlugin.verifyApk.mockResolvedValue({
        packageName: 'com.medbox.app',
        versionCode: 0, // 测试环境 LOCAL_APP_VERSION_CODE 为 0
        versionName: '0.0.0',
      });
      nativePlugin.deleteApk.mockResolvedValue({ deleted: true });

      const update = await scanLanForUpdates();

      expect(update).toBeNull();
      expect(nativePlugin.deleteApk).toHaveBeenCalledWith({ apkPath: 'medbox-update-probe.apk' });
      expect(localStorage.getItem('medbox.lan-sync.available-update.v1')).toBeNull();
    });

    it('当探测包签名验证失败时，删除坏包并跳过该设备', async () => {
      nativePlugin.scanSubnet.mockResolvedValue({ peers: [{ host: '192.168.1.120' }] });
      nativePlugin.probePeer.mockResolvedValue({ reachable: true });
      nativePlugin.download.mockResolvedValue({ bytes: 2048, destPath: 'medbox-update-probe.apk' });
      nativePlugin.verifyApk.mockRejectedValue(new Error('签名不匹配'));
      nativePlugin.deleteApk.mockResolvedValue({ deleted: true });

      const update = await scanLanForUpdates();

      expect(update).toBeNull();
      expect(nativePlugin.deleteApk).toHaveBeenCalledWith({ apkPath: 'medbox-update-probe.apk' });
    });

    it('无候选设备时直接返回 null', async () => {
      nativePlugin.scanSubnet.mockResolvedValue({ peers: [] });

      const update = await scanLanForUpdates();

      expect(update).toBeNull();
      expect(nativePlugin.download).not.toHaveBeenCalled();
    });
  });

  describe('GitHub Releases 官方更新检测与 HTTP 流式下载', () => {
    it('正确解析 GitHub Releases 响应并生成 AvailableUpdate', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v1.2.6',
          body: '1. 新增强提醒无障碍保护\n2. 优化音频焦点恢复',
          assets: [
            {
              name: 'xiaoyaohe-1.2.6-android-release.apk',
              size: 18646307,
              browser_download_url: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v1.2.6/xiaoyaohe-1.2.6-android-release.apk',
            },
          ],
        }),
      });

      try {
        const update = await checkGithubRelease();
        expect(update).not.toBeNull();
        expect(update?.version).toBe('1.2.6');
        expect(update?.source).toBe('github');
        expect(update?.downloadUrl).toContain('xiaoyaohe-1.2.6-android-release.apk');
        expect(update?.fileSize).toBe(18646307);
        expect(update?.releaseNotes).toContain('新增强提醒无障碍保护');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('调用 downloadHttp 下载 GitHub 安装包并通过 verifyApk 校验', async () => {
      nativePlugin.downloadHttp.mockResolvedValue({
        bytes: 18646307,
        destPath: '/cache/medbox-update-99.apk',
      });
      nativePlugin.verifyApk.mockResolvedValue({
        packageName: 'com.medbox.app',
        versionCode: 99,
        versionName: '0.9.99',
      });

      const ghUpdate = {
        version: '0.9.99',
        versionCode: 99,
        source: 'github' as const,
        downloadUrl: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v0.9.99/app.apk',
        discoveredAt: Date.now(),
      };

      const path = await downloadUpdate(ghUpdate);
      expect(path).toBe('/cache/medbox-update-99.apk');
      expect(nativePlugin.downloadHttp).toHaveBeenCalled();
      expect(nativePlugin.verifyApk).toHaveBeenCalledWith({
        apkPath: '/cache/medbox-update-99.apk',
      });
    });

    it('统一检查更新 (checkForAppUpdates) 并行比较择优最高版本', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v1.2.6',
          assets: [
            {
              name: 'xiaoyaohe-1.2.6-android-release.apk',
              size: 18000000,
              browser_download_url: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v1.2.6/xiaoyaohe-1.2.6-android-release.apk',
            },
          ],
        }),
      });

      nativePlugin.scanSubnet.mockResolvedValue({ peers: [] });

      try {
        const best = await checkForAppUpdates();
        expect(best).not.toBeNull();
        expect(best?.version).toBe('1.2.6');
        expect(best?.source).toBe('github');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('checkFastCloudVersion 正确解析 Cloudflare Pages 边缘元数据', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: '1.2.6',
          versionCode: 76,
          releaseDate: '2026-09-08',
          downloadUrl: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v1.2.6/xiaoyaohe-1.2.6-android-release.apk',
          fileSize: 19123456,
          releaseNotes: '云端极速通道更新测试',
        }),
      });

      try {
        const update = await checkFastCloudVersion();
        expect(update).not.toBeNull();
        expect(update?.version).toBe('1.2.6');
        expect(update?.versionCode).toBe(76);
        expect(update?.source).toBe('cloud');
        expect(update?.fileSize).toBe(19123456);
        expect(update?.releaseNotes).toBe('云端极速通道更新测试');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('checkFastCloudVersion 当版本不高于当前版本时返回 null', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: '0.0.0', // 本机测试环境版本为 0.0.0
          versionCode: 0,
        }),
      });

      try {
        const update = await checkFastCloudVersion();
        expect(update).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('调用 downloadUpdate 下载云端极速通道更新并通过 verifyApk 校验', async () => {
      nativePlugin.downloadHttp.mockResolvedValue({
        bytes: 19123456,
        destPath: '/cache/medbox-update-cloud.apk',
      });
      nativePlugin.verifyApk.mockResolvedValue({
        packageName: 'com.medbox.app',
        versionCode: 38,
        versionName: '0.9.18',
      });

      const cloudUpdate = {
        version: '0.9.18',
        versionCode: 38,
        source: 'cloud' as const,
        downloadUrl: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v0.9.18/app.apk',
        discoveredAt: Date.now(),
      };

      const path = await downloadUpdate(cloudUpdate);
      expect(path).toBe('/cache/medbox-update-cloud.apk');
      expect(nativePlugin.downloadHttp).toHaveBeenCalled();
      expect(nativePlugin.verifyApk).toHaveBeenCalledWith({
        apkPath: '/cache/medbox-update-cloud.apk',
      });
    });

    it('云端发现新版本时极速拦截返回，无需等待局域网扫描', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('version.json')) {
          return {
            ok: true,
            json: async () => ({
              version: '1.2.6',
              versionCode: 76,
              downloadUrl: 'https://github.com/Misakii1k/xiaoyaohe/releases/download/v1.2.6/app.apk',
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      // 模拟局域网探测耗时 8000ms（若未被拦截会导致测试严重超时或挂起）
      nativePlugin.scanSubnet.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ peers: [] }), 8000)));

      const statuses: string[] = [];
      try {
        const result = await checkForAppUpdates({
          onStatus: (st) => statuses.push(st),
          timeoutLanMs: 200,
        });
        expect(result).not.toBeNull();
        expect(result?.version).toBe('1.2.6');
        expect(result?.source).toBe('cloud');
        // 验证第一步提示为检查云端
        expect(statuses).toContain('正在检查云端最新版本...');
        // 验证由于云端已有更新，未发出扫描周边设备的提示
        expect(statuses).not.toContain('云端已是最新，正在扫描周边设备...');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('云端已是最新时，通知 UI 并转入局域网扫描', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          version: '0.0.0', // 无新版本
        }),
      });

      // 局域网无候选
      nativePlugin.scanSubnet.mockResolvedValue({ peers: [] });

      const statuses: string[] = [];
      try {
        const result = await checkForAppUpdates({
          onStatus: (st) => statuses.push(st),
          timeoutLanMs: 100,
        });
        expect(result).toBeNull();
        expect(statuses).toContain('正在检查云端最新版本...');
        expect(statuses).toContain('云端已是最新，正在扫描周边设备...');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

describe('云端更新通道的下载地址与完整性校验', () => {
  beforeEach(() => {
    for (const fn of Object.values(nativePlugin)) fn.mockReset();
    nativePlugin.deleteApk.mockResolvedValue({ deleted: true });
  });

  it('元数据声明的字节数与实际下载不符时删除并中止', async () => {
    nativePlugin.downloadHttp.mockResolvedValue({ bytes: 111, destPath: '/cache/medbox-update-cloud.apk' });

    await expect(downloadUpdate({
      version: '1.0.1',
      versionCode: 36,
      source: 'cloud',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.1',
      fileSize: 32095374,
      discoveredAt: Date.now(),
    })).rejects.toThrow(/大小不符/);

    expect(nativePlugin.deleteApk).toHaveBeenCalledWith({ apkPath: '/cache/medbox-update-cloud.apk' });
    expect(nativePlugin.verifyApk).not.toHaveBeenCalled();
  });

  it('字节数一致时继续走原生验签', async () => {
    nativePlugin.downloadHttp.mockResolvedValue({ bytes: 32095374, destPath: '/cache/medbox-update-cloud.apk' });
    nativePlugin.verifyApk.mockResolvedValue({ packageName: 'com.medbox.app', versionCode: 36, versionName: '1.0.1' });

    await downloadUpdate({
      version: '1.0.1',
      versionCode: 36,
      source: 'cloud',
      downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.0.1',
      fileSize: 32095374,
      discoveredAt: Date.now(),
    });

    expect(nativePlugin.verifyApk).toHaveBeenCalledWith({ apkPath: '/cache/medbox-update-cloud.apk' });
  });

  it('拒绝白名单之外的主机，且不发起下载', async () => {
    await expect(downloadUpdate({
      version: '1.0.1',
      versionCode: 36,
      source: 'cloud',
      downloadUrl: 'https://evil.example/xiaoyaohe.apk',
      discoveredAt: Date.now(),
    })).rejects.toThrow(/不可信/);

    expect(nativePlugin.downloadHttp).not.toHaveBeenCalled();
  });

  it('version.json 的相对直链解析为同源代理地址，并透传 sha256', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: '1.2.6',
        versionCode: 76,
        downloadUrl: '/api/download?tag=v1.2.6',
        fileSize: 32095374,
        sha256: 'a'.repeat(64),
      }),
    }) as unknown as typeof fetch;

    try {
      const found = await checkFastCloudVersion();
      expect(found?.downloadUrl).toBe('https://xiaoyaohe.pages.dev/api/download?tag=v1.2.6');
      expect(found?.fileSize).toBe(32095374);
      expect(found?.sha256).toBe('a'.repeat(64));
      expect(String((globalThis.fetch as any).mock.calls[0][0])).toBe('https://xiaoyaohe.pages.dev/version.json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('GitHub 通道只走自家代理，不再直连 api.github.com 与公开镜像', async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      requested.push(String(input));
      return {
        ok: true,
        json: async () => ({
          tag_name: 'v1.2.6',
          body: 'notes',
          assets: [{
            name: 'xiaoyaohe-1.2.6-android-release.apk',
            size: 32095374,
            browser_download_url: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.6',
          }],
        }),
      };
    }) as unknown as typeof fetch;

    try {
      const found = await checkGithubRelease();
      expect(requested).toEqual(['https://xiaoyaohe.pages.dev/api/releases']);
      expect(found?.downloadUrl).toBe('https://xiaoyaohe.pages.dev/api/download?tag=v1.2.6');
      expect(found?.fileSize).toBe(32095374);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  describe('notifyIfUpdateAvailable (轻提醒体验)', () => {
    it('前台活跃时抑制系统级推送通知，仅分发更新事件静默刷新界面', async () => {
      const showNotificationMock = vi.mocked(showNotification);
      showNotificationMock.mockClear();
      localStorage.clear();

      saveAvailableUpdate({
        version: '1.2.6',
        versionCode: 76,
        source: 'cloud',
        downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.6',
        discoveredAt: Date.now(),
      });

      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });

      let eventFired = false;
      const handler = () => {
        eventFired = true;
      };
      window.addEventListener('medbox:app-update-changed', handler);

      await notifyIfUpdateAvailable();

      window.removeEventListener('medbox:app-update-changed', handler);
      expect(eventFired).toBe(true);
      expect(showNotificationMock).not.toHaveBeenCalled();
      // 前台静默分支不得写入防抖时间戳，保证稍后切到后台仍可收到轻提醒
      expect(localStorage.getItem('medbox.lan-sync.last-update-notify.v1')).toBeNull();
    });

    it('前台静默后切到后台，仍能在防抖窗口内收到一次轻提醒', async () => {
      const showNotificationMock = vi.mocked(showNotification);
      showNotificationMock.mockClear();
      localStorage.clear();

      saveAvailableUpdate({
        version: '1.2.6',
        versionCode: 76,
        source: 'cloud',
        downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.6',
        discoveredAt: Date.now(),
      });

      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      await notifyIfUpdateAvailable();
      expect(showNotificationMock).not.toHaveBeenCalled();

      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      await notifyIfUpdateAvailable();
      expect(showNotificationMock).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('medbox.lan-sync.last-update-notify.v1')).toBeTruthy();
    });

    it('后台或页面非可见时，通过轻提醒通道发送静默通知且不带服药操作按钮', async () => {
      const showNotificationMock = vi.mocked(showNotification);
      showNotificationMock.mockClear();
      localStorage.clear();

      saveAvailableUpdate({
        version: '1.2.6',
        versionCode: 76,
        source: 'cloud',
        downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.2.6',
        discoveredAt: Date.now(),
      });

      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });

      await notifyIfUpdateAvailable();

      expect(showNotificationMock).toHaveBeenCalledTimes(1);
      const [title, options] = showNotificationMock.mock.calls[0];
      expect(title).toBe('发现新版本 v1.2.6');
      expect(options).toMatchObject({
        tag: 'medbox-app-update',
        silent: true,
        data: {
          deepLink: '/settings?action=app-update',
          mode: 'light',
          channel: 'update',
        },
      });
    });
  });
});
