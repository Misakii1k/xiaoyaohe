import { describe, expect, it } from 'vitest';
import {
  formatUpdateSizeMb,
  recommendUpdateChannel,
  type UpdateRecommendationInput,
} from '../src/sync/lan/updateRecommendation';

const MB = 1024 * 1024;

const base = (over: Partial<UpdateRecommendationInput> = {}): UpdateRecommendationInput => ({
  localNativeVersionCode: 68,
  source: 'cloud',
  bundleUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.1.11&asset=bundle',
  bundleSize: 8.3 * MB,
  fileSize: 20 * MB,
  downloadUrl: 'https://xiaoyaohe.pages.dev/api/download?tag=v1.1.11',
  minNativeVersionCode: 58,
  defaultMinNativeVersionCode: 58,
  ...over,
});

describe('推荐更新方式（纯函数）', () => {
  it('手机版本满足门槛且有秒级资源：推荐一键秒级更新，并说明下载量', () => {
    const rec = recommendUpdateChannel(base());
    expect(rec.recommended).toBe('incremental');
    expect(rec.incrementalAvailable).toBe(true);
    expect(rec.code).toBe('incremental-ready');
    expect(rec.reason).toBe('只需下载约 8.3 MB，几秒完成，不用重新安装。');
  });

  it('门槛恰好相等也算满足；只与门槛比较，不与目标新版本号比较', () => {
    const rec = recommendUpdateChannel(base({ localNativeVersionCode: 58 }));
    expect(rec.recommended).toBe('incremental');
  });

  it('手机版本低于门槛：推荐完整包，秒级按钮不可用，理由说明版本较旧', () => {
    const rec = recommendUpdateChannel(base({ localNativeVersionCode: 57 }));
    expect(rec).toMatchObject({ recommended: 'full', incrementalAvailable: false, code: 'native-too-old' });
    expect(rec.reason).toContain('版本较旧');
    expect(rec.reason).toContain('约 20.0 MB');
  });

  it('新版本含需要重新安装的改动（门槛抬到新版本号）：旧手机推荐完整包', () => {
    const rec = recommendUpdateChannel(base({ localNativeVersionCode: 68, minNativeVersionCode: 69 }));
    expect(rec.recommended).toBe('full');
    expect(rec.code).toBe('native-too-old');
  });

  it('元数据没给门槛时退回缺省门槛', () => {
    expect(recommendUpdateChannel(base({ minNativeVersionCode: undefined, localNativeVersionCode: 57 })).code)
      .toBe('native-too-old');
    expect(recommendUpdateChannel(base({ minNativeVersionCode: undefined, localNativeVersionCode: 58 })).code)
      .toBe('incremental-ready');
  });

  it('没有秒级资源：推荐完整包', () => {
    const rec = recommendUpdateChannel(base({ bundleUrl: undefined, bundleSize: undefined }));
    expect(rec).toMatchObject({ recommended: 'full', incrementalAvailable: false, code: 'no-bundle' });
  });

  it('局域网来源只能完整安装', () => {
    const rec = recommendUpdateChannel(base({ source: 'lan', downloadUrl: undefined }));
    expect(rec).toMatchObject({ recommended: 'full', incrementalAvailable: false, code: 'lan-full-only' });
  });

  it('手机版本未知（0）时推荐完整包', () => {
    const rec = recommendUpdateChannel(base({ localNativeVersionCode: 0 }));
    expect(rec).toMatchObject({ recommended: 'full', incrementalAvailable: false, code: 'unknown-native' });
  });

  it('秒级更新失败过：改推荐完整包，但秒级通道仍保留', () => {
    const rec = recommendUpdateChannel(base({ incrementalFailed: true }));
    expect(rec).toMatchObject({ recommended: 'full', incrementalAvailable: true, code: 'incremental-failed' });
  });

  it('秒级失败但没有完整包地址时仍推荐秒级（不能推荐一个点不了的按钮）', () => {
    const rec = recommendUpdateChannel(base({ incrementalFailed: true, downloadUrl: undefined }));
    expect(rec.recommended).toBe('incremental');
  });

  it('秒级资源不比完整包小：推荐完整包一次到位，秒级仍可选', () => {
    const rec = recommendUpdateChannel(base({ bundleSize: 21 * MB, fileSize: 20 * MB }));
    expect(rec).toMatchObject({ recommended: 'full', incrementalAvailable: true, code: 'bundle-not-smaller' });
  });

  it('体积未知时的秒级理由不编造数字', () => {
    const rec = recommendUpdateChannel(base({ bundleSize: undefined }));
    expect(rec.recommended).toBe('incremental');
    expect(rec.reason).not.toMatch(/\d/);
  });

  it('所有理由都是大白话，不含技术黑话', () => {
    const cases: Partial<UpdateRecommendationInput>[] = [
      {}, { localNativeVersionCode: 1 }, { bundleUrl: undefined }, { source: 'lan' },
      { localNativeVersionCode: 0 }, { incrementalFailed: true }, { bundleSize: 30 * MB },
    ];
    for (const c of cases) {
      const { reason } = recommendUpdateChannel(base(c));
      expect(reason).not.toMatch(/增量|底座|versionCode|WebView|APK|热更新|bundle/i);
    }
  });

  it('formatUpdateSizeMb', () => {
    expect(formatUpdateSizeMb(undefined)).toBeNull();
    expect(formatUpdateSizeMb(0)).toBeNull();
    expect(formatUpdateSizeMb(1000)).toBe('0.1');
    expect(formatUpdateSizeMb(8297360)).toBe('7.9');
  });
});
