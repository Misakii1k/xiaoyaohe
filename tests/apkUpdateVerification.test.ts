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
};

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => true,
  },
  registerPlugin: () => nativePlugin,
}));

vi.mock('../src/features/notifier', () => ({ showNotification: vi.fn() }));

const { downloadUpdate } = await import('../src/sync/lan/apkTransport');

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
});
