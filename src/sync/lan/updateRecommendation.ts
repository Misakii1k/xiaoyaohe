// 软件更新「推荐更新方式」纯函数。
//
// 软件更新界面固定保留「一键秒级更新」（下载网页资源包就地生效）与「下载完整包」（安装新版 APK）双通道。
// 这里根据现有元数据自动挑出推荐的那一个，并给出一句普通用户看得懂的理由。
//
// 推荐依据（全部来自 version.json / GitHub Release 已有字段，不新增任何线上字段）：
// 1. 本机原生版本号是否已知（网页端或测试环境为 0）；
// 2. 更新来源：局域网设备只分发完整安装包；
// 3. 是否存在可用的秒级更新资源（bundleUrl）；
// 4. 本机原生版本号是否达到 minNativeVersionCode（缺省 DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE）——
//    新版本如包含需要重新安装才能生效的改动，发布时会把这个门槛抬到新版本号，旧版本自然落到完整安装；
//    注意只与门槛比较，绝不与目标新版本号比较（见 AGENTS.md「Web 增量热更新机制守则」第 1 条）；
// 5. 本次是否已经尝试秒级更新失败（失败后改推完整包，秒级按钮仍保留供重试）；
// 6. 两种方式的下载体积：秒级资源并不比完整包小时，直接推荐完整包一次到位。

export type UpdateChannel = 'incremental' | 'full';

export interface UpdateRecommendationInput {
  /** 本机原生 APK 版本号（LOCAL_APP_VERSION_CODE；未知时为 0）。 */
  localNativeVersionCode: number;
  /** 更新来源。 */
  source?: 'github' | 'lan' | 'cloud';
  /** 秒级更新资源地址（没有则不能秒级更新）。 */
  bundleUrl?: string;
  /** 秒级更新资源体积（字节）。 */
  bundleSize?: number;
  /** 完整安装包体积（字节）。 */
  fileSize?: number;
  /** 完整安装包下载地址（局域网来源没有此字段，走对端设备）。 */
  downloadUrl?: string;
  /** 秒级更新需要的最低原生版本号。 */
  minNativeVersionCode?: number;
  /** 缺省门槛（DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE）。 */
  defaultMinNativeVersionCode: number;
  /** 本次是否已经尝试秒级更新并失败。 */
  incrementalFailed?: boolean;
}

export type UpdateRecommendationCode =
  | 'incremental-ready'
  | 'unknown-native'
  | 'lan-full-only'
  | 'no-bundle'
  | 'native-too-old'
  | 'incremental-failed'
  | 'bundle-not-smaller';

export interface UpdateRecommendation {
  /** 推荐的更新方式。 */
  recommended: UpdateChannel;
  /** 秒级更新通道当前是否可用（决定是否展示「一键秒级更新」按钮）。 */
  incrementalAvailable: boolean;
  /** 推荐理由编码（便于测试与埋点）。 */
  code: UpdateRecommendationCode;
  /** 给用户看的一句大白话理由。 */
  reason: string;
}

/** 字节数 → 「约 X MB」用的数字文本；未知或非法返回 null。 */
export function formatUpdateSizeMb(bytes: number | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return '0.1';
  return mb.toFixed(1);
}

function aboutSize(bytes: number | undefined): string {
  const mb = formatUpdateSizeMb(bytes);
  return mb ? `（约 ${mb} MB）` : '';
}

export function recommendUpdateChannel(input: UpdateRecommendationInput): UpdateRecommendation {
  const fullSize = aboutSize(input.fileSize);
  const full = (code: UpdateRecommendationCode, reason: string, incrementalAvailable = false): UpdateRecommendation => ({
    recommended: 'full',
    incrementalAvailable,
    code,
    reason,
  });

  if (input.source === 'lan') {
    return full('lan-full-only', '这次是从同一 Wi-Fi 下的其他设备获取新版本，只能安装完整安装包。');
  }

  const localCode = Number.isFinite(input.localNativeVersionCode) ? input.localNativeVersionCode : 0;
  if (localCode <= 0) {
    return full('unknown-native', `暂时无法确认手机上的版本，安装完整安装包${fullSize}最稳妥。`);
  }

  if (!input.bundleUrl) {
    return full('no-bundle', `这次更新只提供完整安装包${fullSize}，下载后按提示安装即可。`);
  }

  const threshold = typeof input.minNativeVersionCode === 'number' && Number.isFinite(input.minNativeVersionCode)
    ? input.minNativeVersionCode
    : input.defaultMinNativeVersionCode;
  if (localCode < threshold) {
    return full(
      'native-too-old',
      `你手机上的版本较旧，这次需要安装完整安装包${fullSize}；装好后，以后的小更新几秒就能完成。`,
    );
  }

  // 从这里起秒级更新通道可用：两个按钮都展示，只是推荐哪一个不同。
  const canFallbackToFull = Boolean(input.downloadUrl);
  if (input.incrementalFailed && canFallbackToFull) {
    return full('incremental-failed', `刚才的秒级更新没有成功，建议改用完整安装包${fullSize}。`, true);
  }

  const bundleBytes = input.bundleSize;
  const fullBytes = input.fileSize;
  if (
    canFallbackToFull
    && typeof bundleBytes === 'number' && bundleBytes > 0
    && typeof fullBytes === 'number' && fullBytes > 0
    && bundleBytes >= fullBytes
  ) {
    return full('bundle-not-smaller', '两种方式的下载量差不多，安装完整安装包一次到位。', true);
  }

  const bundleMb = formatUpdateSizeMb(bundleBytes);
  return {
    recommended: 'incremental',
    incrementalAvailable: true,
    code: 'incremental-ready',
    reason: bundleMb
      ? `只需下载约 ${bundleMb} MB，几秒完成，不用重新安装。`
      : '下载量很小，几秒完成，不用重新安装。',
  };
}
