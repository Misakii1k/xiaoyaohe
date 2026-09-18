// 局域网 APK 自动更新 TS 层封装。
//
// 设计要点：
// - 在 LAN 同步消息的 summary 中带本机 appVersion + versionCode。
// - 对方版本更高时，把可用更新信息写入 localStorage，由 autoSync/UI 订阅。
// - 「已升级设备」可调 startServingApk 让本机在 38473 端口对外分发 APK。
// - 「待升级设备」通过 downloadUpdate 拉取 APK 到 cacheDir，再调 installApk 调起系统安装器。
//
// 与 LanSync 协议完全解耦：APK 走独立 TCP 端口，不受单会话锁限制。
import { Capacitor, registerPlugin } from '@capacitor/core';
import { showNotification } from '../../features/notifier';
import { listKnownPeers } from './knownPeers';

/** 本机版本号（构建期注入；测试环境 fallback 到 0）。 */
export const LOCAL_APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
/** 本机 versionCode（构建期注入；测试环境 fallback 到 0）。 */
export const LOCAL_APP_VERSION_CODE: number = typeof __APP_VERSION_CODE__ !== 'undefined' ? __APP_VERSION_CODE__ : 0;

/** APK 分发端口（与 ApkDistributionPlugin.java 保持一致）。 */
export const APK_DISTRIBUTION_PORT = 38473;

/** 支持 Web 增量热更新的最低原生 APK versionCode（从提醒重复弹出根治与居底滑块起要求底座 >= 58）。 */
export const DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE = 58;

/**
 * 云端更新通道的部署源。换自定义域名时只改这一处。
 * 版本元数据 `version.json` 与私有仓库代理 `/api/releases`、`/api/download` 都在它下面。
 */
export const CLOUD_ORIGIN = 'https://xiaoyaohe.pages.dev';

/**
 * 允许下载 APK 的主机白名单。
 * 更新元数据来自网络，`downloadUrl` 不得把用户引到任意主机。
 */
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  new URL(CLOUD_ORIGIN).host,
  'github.com',
  'objects.githubusercontent.com',
  'ghfast.top',
  'ghproxy.net',
  'gh-proxy.com',
]);

const SHA256_RE = /^[0-9a-f]{64}$/;

/** 把元数据里的下载地址规范化：相对路径按部署源补全，绝对地址必须命中白名单。 */
export function resolveDownloadUrl(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed, CLOUD_ORIGIN);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!ALLOWED_DOWNLOAD_HOSTS.has(url.host)) return null;
  return url.toString();
}

const AVAILABLE_UPDATE_KEY = 'medbox.lan-sync.available-update.v1';
const LAST_UPDATE_NOTIFY_KEY = 'medbox.lan-sync.last-update-notify.v1';
const NOTIFY_DEBOUNCE_MS = 24 * 60 * 60 * 1000; // 24h

export type UpdateSource = 'github' | 'lan' | 'cloud';

export function saveAvailableUpdate(update: AvailableUpdate): void {
  try {
    localStorage.setItem(AVAILABLE_UPDATE_KEY, JSON.stringify(update));
  } catch {
    /* ignore */
  }
}

export type UpdateType = 'incremental' | 'full';

export interface AvailableUpdate {
  /** 更新版本号（如 "0.9.15"）。 */
  version: string;
  /** 更新 versionCode。 */
  versionCode: number;
  /** 更新来源类型。 */
  source?: UpdateSource;
  /** 更新方式类型：增量热更新（秒级就地生效）或全量安装包更新。 */
  updateType?: UpdateType;
  /** 分发源 IPv4（局域网更新有效）。 */
  peerHost?: string;
  /** 分发源 TCP 端口（一般是 38473，局域网更新有效）。 */
  peerPort?: number;
  /** 远程下载直链（GitHub/HTTP 更新有效）。 */
  downloadUrl?: string;
  /** Web 增量更新包直链（如有）。 */
  bundleUrl?: string;
  /** Web 增量更新包大小（字节数）。 */
  bundleSize?: number;
  /** Web 增量更新包 SHA256 校验码。 */
  bundleSha256?: string;
  /** Web 增量更新包依赖的最低底座原生版本代码。 */
  minNativeVersionCode?: number;
  /** 更新日志/说明。 */
  releaseNotes?: string;
  /** 安装包大小（字节数）。 */
  fileSize?: number;
  /** 安装包 SHA256（十六进制小写；version.json 提供时用于下载后校验）。 */
  sha256?: string;
  /** 发现时间戳（UTC ms）。 */
  discoveredAt: number;
}

interface ApkDistributionPlugin {
  getInstalledApkPath(): Promise<{ apkPath: string }>;
  startServer(options: { apkPath: string }): Promise<{ port: number; apkPath: string }>;
  stopServer(): Promise<void>;
  download(options: { host: string; port: number; destPath: string }): Promise<{ bytes: number; destPath: string }>;
  downloadHttp?(options: { url: string; destPath: string }): Promise<{ bytes: number; destPath: string }>;
  probePeer?(options: { host: string; port?: number; timeoutMs?: number }): Promise<{ reachable: boolean; host: string; port: number }>;
  scanSubnet?(options?: { port?: number; timeoutMs?: number }): Promise<{ peers: Array<{ host: string; port: number }> }>;
  verifyApk(options: { apkPath: string; expectedVersionCode?: number }): Promise<{
    packageName: string;
    versionCode: number;
    versionName: string;
  }>;
  installApk(options: { apkPath: string; expectedVersionCode?: number }): Promise<void>;
  deleteApk(options: { apkPath: string }): Promise<{ deleted: boolean }>;
  downloadAndUnpackBundle?(options: { url: string; version: string; sha256?: string }): Promise<{
    success: boolean;
    version: string;
    basePath: string;
  }>;
  applyWebBundle?(options: { basePath: string }): Promise<{ success: boolean; basePath: string }>;
  resetWebBundle?(): Promise<{ success: boolean }>;
  getActiveWebBundle?(): Promise<{ basePath: string; isDefault: boolean }>;
  getCacheSize?(): Promise<{ bytes: number; formatted: string }>;
  clearAppCache?(): Promise<{ success: boolean; freedBytes: number; formatted: string }>;
  addListener?(
    eventName: string,
    listenerFunc: (data: any) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const plugin = registerPlugin<ApkDistributionPlugin>('ApkDistribution');

export function isApkDistributionAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('ApkDistribution');
  } catch {
    return false;
  }
}

/** 获取当前已发现的可用更新（若无返回 null）。 */
export function getAvailableUpdate(): AvailableUpdate | null {
  try {
    const raw = localStorage.getItem(AVAILABLE_UPDATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AvailableUpdate>;
    if (
      typeof parsed.version !== 'string'
      || typeof parsed.versionCode !== 'number'
      || typeof parsed.discoveredAt !== 'number'
    ) {
      return null;
    }
    // 若记录的版本已不高于本机当前运行版本，视为过期历史记录自动清理
    if (
      LOCAL_APP_VERSION_CODE > 0
      && parsed.versionCode <= LOCAL_APP_VERSION_CODE
      && compareVersion(parsed.version, LOCAL_APP_VERSION) <= 0
    ) {
      clearAvailableUpdate();
      return null;
    }
    const source: UpdateSource = parsed.source === 'github' ? 'github' : parsed.source === 'cloud' ? 'cloud' : 'lan';
    if (source === 'lan' && (!parsed.peerHost || !parsed.peerPort)) {
      return null;
    }
    if ((source === 'github' || source === 'cloud') && !parsed.downloadUrl) {
      return null;
    }
    // 增量热更新元数据必须一并还原，否则界面永远识别不到「秒级更新」通道而退化为全量安装包
    const bundleUrl = typeof parsed.bundleUrl === 'string' && parsed.bundleUrl ? parsed.bundleUrl : undefined;
    const bundleSha256 = typeof parsed.bundleSha256 === 'string' && SHA256_RE.test(parsed.bundleSha256)
      ? parsed.bundleSha256
      : undefined;
    const minNativeVersionCode = typeof parsed.minNativeVersionCode === 'number'
      ? parsed.minNativeVersionCode
      : undefined;
    const canIncremental = Boolean(
      bundleUrl
      && LOCAL_APP_VERSION_CODE > 0
      && LOCAL_APP_VERSION_CODE >= (minNativeVersionCode ?? DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE),
    );
    const updateType: UpdateType = parsed.updateType === 'incremental' && canIncremental ? 'incremental' : 'full';
    return {
      version: parsed.version,
      versionCode: parsed.versionCode,
      source,
      updateType,
      peerHost: parsed.peerHost,
      peerPort: parsed.peerPort,
      downloadUrl: parsed.downloadUrl,
      bundleUrl,
      bundleSize: typeof parsed.bundleSize === 'number' && parsed.bundleSize > 0 ? parsed.bundleSize : undefined,
      bundleSha256,
      minNativeVersionCode,
      releaseNotes: parsed.releaseNotes,
      fileSize: parsed.fileSize,
      sha256: typeof parsed.sha256 === 'string' && SHA256_RE.test(parsed.sha256) ? parsed.sha256 : undefined,
      discoveredAt: parsed.discoveredAt,
    };
  } catch {
    return null;
  }
}

/**
 * 在收到对端 LAN 同步消息时调用：若对方 versionCode 高于本机，记录可用更新。
 * 已记录过同版本则不重复覆盖（保留首次发现时间用于通知去重）。
 */
export function recordPeerVersion(
  peerHost: string,
  peer: { appVersion?: string; versionCode?: number },
): void {
  const peerVersion = peer.appVersion;
  const peerCode = peer.versionCode;
  if (!peerVersion || !peerCode || peerCode <= LOCAL_APP_VERSION_CODE) {
    return;
  }
  const existing = getAvailableUpdate();
  if (existing && existing.versionCode === peerCode && existing.peerHost === peerHost) {
    return; // 已记录同版本，不重复覆盖
  }
  const update: AvailableUpdate = {
    version: peerVersion,
    versionCode: peerCode,
    source: 'lan',
    peerHost,
    peerPort: APK_DISTRIBUTION_PORT,
    discoveredAt: Date.now(),
  };
  try {
    localStorage.setItem(AVAILABLE_UPDATE_KEY, JSON.stringify(update));
  } catch {
    /* ignore */
  }
  dispatchUpdateChanged();
}

/** 清除已发现的可用更新（用户跳过或已升级）。 */
export function clearAvailableUpdate(): void {
  try {
    localStorage.removeItem(AVAILABLE_UPDATE_KEY);
  } catch {
    /* ignore */
  }
  dispatchUpdateChanged();
}

/** 通知 UI 订阅者（如 Settings 页）可用更新已变化。 */
function dispatchUpdateChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('medbox:app-update-changed'));
  } catch {
    /* ignore */
  }
}

/**
 * 在自动同步一轮结束后调用：若有可用更新且 24h 内未通知过，发本地通知。
 * 通知点击跳到 Settings 页（由通知 payload 的 deepLink 标识）。
 */
export async function notifyIfUpdateAvailable(): Promise<void> {
  const update = getAvailableUpdate();
  if (!update) return;
  try {
    const last = Number(localStorage.getItem(LAST_UPDATE_NOTIFY_KEY) ?? '0');
    if (Date.now() - last < NOTIFY_DEBOUNCE_MS) return;

    // 前台静默体验：若当前处于前台活跃状态，不通过系统推送打扰用户，
    // 仅分发事件更新界面轻红点/徽标；避免前台操作时突然弹出通知横幅。
    // 注意：此处不写入防抖时间戳，否则用户切到后台后在防抖窗口内将收不到任何轻提醒。
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      dispatchUpdateChanged();
      return;
    }

    await showNotification(`发现新版本 v${update.version}`, {
      body: '点击进入「应用更新」下载并安装。',
      tag: 'medbox-app-update',
      key: `update-${update.versionCode}`,
      silent: true,
      data: {
        deepLink: '/settings?action=app-update',
        mode: 'light',
        channel: 'update',
      },
    });
    localStorage.setItem(LAST_UPDATE_NOTIFY_KEY, String(Date.now()));
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/**
 * 把本机 APK 路径对外分发（在 38473 监听）。
 * - 已升级设备调用此函数后，其他设备才能通过 LAN 拉取新版本。
 * - 重复调用会先停旧监听再开新监听（避免端口占用）。
 * - 返回 false 表示当前环境不可用或 APK 文件不存在。
 */
export async function startServingApk(apkPath: string): Promise<boolean> {
  if (!isApkDistributionAvailable()) return false;
  try {
    await plugin.startServer({ apkPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * 便捷封装：自动获取本机已安装 APK 路径并启动分发。
 * - 适用于「已升级设备」在自动同步启动时调用，让其他设备能拉取新版本。
 * - 返回 true 表示分发已启动；false 表示当前环境不可用或获取路径失败。
 */
export async function startServingInstalledApk(): Promise<boolean> {
  if (!isApkDistributionAvailable()) return false;
  try {
    const { apkPath } = await plugin.getInstalledApkPath();
    if (!apkPath) return false;
    return startServingApk(apkPath);
  } catch {
    return false;
  }
}

/** 停止对外分发。 */
export async function stopServingApk(): Promise<void> {
  if (!isApkDistributionAvailable()) return;
  try {
    await plugin.stopServer();
  } catch {
    /* ignore */
  }
}

/**
 * 下载可用更新到本机 cacheDir，校验通过后返回 apkPath。
 * 支持传入 onProgress 回调展示实时下载百分比与字节数。
 * 失败时抛出错误（含中文文案）。
 */
export async function downloadUpdate(
  update: AvailableUpdate,
  onProgress?: (percent: number, received: number, total: number) => void,
): Promise<string> {
  if (!isApkDistributionAvailable()) {
    throw new Error('当前环境不支持 APK 自动更新');
  }
  const destPath = await resolveApkCachePath(update.versionCode);
  let downloadedPath = '';

  // 监听原生下载进度
  let progressHandle: { remove: () => Promise<void> } | null = null;
  if (typeof plugin.addListener === 'function' && onProgress) {
    try {
      progressHandle = await plugin.addListener(
        'downloadProgress',
        (data: { received: number; total: number; percent: number }) => {
          if (data && typeof data.percent === 'number') {
            onProgress(data.percent, data.received || 0, data.total || 0);
          }
        },
      );
    } catch {
      /* 忽略监听注册失败 */
    }
  }

  try {
    if ((update.source === 'github' || update.source === 'cloud') && update.downloadUrl) {
      if (typeof plugin.downloadHttp !== 'function') {
        throw new Error('原生下载模块未就绪（downloadHttp 不可用）');
      }
      // 只信任白名单主机：元数据来自网络，不能让 downloadUrl 把包引到任意地址。
      // （之前这里会给同一个 URL 套三个 ghproxy 前缀重试，对私有仓库毫无意义，
      //   还会把私有资产地址交给第三方镜像，已移除。）
      const target = resolveDownloadUrl(update.downloadUrl);
      if (!target) {
        throw new Error('更新包下载地址不可信，已拒绝下载。请稍后重试或改用官方渠道。');
      }
      const result = await plugin.downloadHttp({ url: target, destPath });
      downloadedPath = result.destPath;

      // 便宜的完整性前置校验：元数据给了字节数就必须对上，再进昂贵的验签。
      if (typeof update.fileSize === 'number' && update.fileSize > 0
        && typeof result.bytes === 'number' && result.bytes !== update.fileSize) {
        await deleteApk(downloadedPath);
        throw new Error(`更新包大小不符（预期 ${update.fileSize} 字节，实际 ${result.bytes} 字节），已自动删除。`);
      }
    } else {
      if (!update.peerHost || !update.peerPort) {
        throw new Error('局域网更新信息不完整（缺少主机或端口）');
      }
      const result = await plugin.download({
        host: update.peerHost,
        port: update.peerPort,
        destPath,
      });
      downloadedPath = result.destPath;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    throw new Error(`下载更新失败：${msg || '未知错误'}`);
  } finally {
    if (progressHandle) {
      void progressHandle.remove().catch(() => undefined);
    }
  }

  // APK 走的是明文 TCP 或外部网络，下载完必须严格验签：
  // 包名必须为 com.medbox.app，签名证书必须与本机一致。
  // 局域网更新时强制校验 expectedVersionCode；
  // GitHub / 云端更新时以 APK 内部实际版本号为准（原生验签强制要求 archiveCode >= installedCode）。
  try {
    await plugin.verifyApk({
      apkPath: downloadedPath,
      ...((update.source !== 'github' && update.source !== 'cloud') ? { expectedVersionCode: update.versionCode } : {}),
    });
  } catch (error) {
    await deleteApk(downloadedPath);
    const msg = error instanceof Error ? error.message : '';
    throw new Error(`更新包校验未通过，已自动删除：${msg || '未知原因'}。请改用官方渠道安装。`);
  }
  return downloadedPath;
}

/**
 * 调起系统安装器安装指定 APK。
 * expectedVersionCode 会一并传给原生侧再验一次（原生 installApk 内部强制验签，绕不过）。
 */
export async function installApk(apkPath: string, expectedVersionCode?: number): Promise<void> {
  if (!isApkDistributionAvailable()) {
    throw new Error('当前环境不支持 APK 安装');
  }
  try {
    await plugin.installApk({ apkPath, ...(expectedVersionCode ? { expectedVersionCode } : {}) });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    throw new Error(`调起安装器失败：${msg || '未知错误'}`);
  }
}

/** 删除 cache 中的 APK 文件（已安装或下载失败后清理）。 */
export async function deleteApk(apkPath: string): Promise<void> {
  if (!isApkDistributionAvailable()) return;
  try {
    await plugin.deleteApk({ apkPath });
  } catch {
    /* ignore */
  }
}

/**
 * 下载并就地激活 Web 增量热更新。
 * 成功后返回 true，调用方可通知用户或触发 window.location.reload()。
 */
export async function downloadAndApplyWebBundle(
  update: AvailableUpdate,
  onProgress?: (status: string) => void,
): Promise<boolean> {
  if (!isApkDistributionAvailable()) {
    throw new Error('当前环境不支持增量更新（仅 Android App 支持）');
  }
  if (!update.bundleUrl) {
    throw new Error('未提供增量更新包下载地址');
  }
  if (typeof plugin.downloadAndUnpackBundle !== 'function' || typeof plugin.applyWebBundle !== 'function') {
    throw new Error('原生增量更新模块未就绪');
  }

  const target = resolveDownloadUrl(update.bundleUrl);
  if (!target) {
    throw new Error('增量更新包下载地址不可信，已拒绝下载。');
  }

  onProgress?.('正在下载轻量更新包...');
  const unpackResult = await plugin.downloadAndUnpackBundle({
    url: target,
    version: update.version,
    sha256: update.bundleSha256,
  });

  if (!unpackResult || !unpackResult.success || !unpackResult.basePath) {
    throw new Error('解压增量更新包失败');
  }

  onProgress?.('正在激活新版本...');
  const applyResult = await plugin.applyWebBundle({
    basePath: unpackResult.basePath,
  });

  if (!applyResult || !applyResult.success) {
    throw new Error('激活增量更新失败');
  }

  // 清除可用更新提示，避免重复触发
  clearAvailableUpdate();
  return true;
}

/** 重置为 APK 内置资产。 */
export async function resetWebBundle(): Promise<void> {
  if (!isApkDistributionAvailable() || typeof plugin.resetWebBundle !== 'function') return;
  try {
    await plugin.resetWebBundle();
  } catch {
    /* ignore */
  }
}

/** 获取当前激活的 WebBundle 状态。 */
export async function getActiveWebBundle(): Promise<{ basePath: string; isDefault: boolean } | null> {
  if (!isApkDistributionAvailable() || typeof plugin.getActiveWebBundle !== 'function') return null;
  try {
    return await plugin.getActiveWebBundle();
  } catch {
    return null;
  }
}

export interface AppCacheInfo {
  bytes: number;
  formatted: string;
}

export interface AppCacheClearResult {
  success: boolean;
  freedBytes: number;
  formatted: string;
}

/**
 * 获取当前手机端缓存与临时文件占用大小。
 * 网页端或插件不可用时返回 0 B。
 */
export async function getAppCacheSize(): Promise<AppCacheInfo> {
  if (!isApkDistributionAvailable() || typeof plugin.getCacheSize !== 'function') {
    return { bytes: 0, formatted: '0 B' };
  }
  try {
    const res = await plugin.getCacheSize();
    return {
      bytes: res?.bytes ?? 0,
      formatted: res?.formatted ?? '0 B',
    };
  } catch {
    return { bytes: 0, formatted: '0 B' };
  }
}

/**
 * 清理手机端缓存与临时文件（旧安装包、临时压缩包、旧增量包与 WebView 缓存）。
 */
export async function clearAppCache(): Promise<AppCacheClearResult> {
  if (!isApkDistributionAvailable() || typeof plugin.clearAppCache !== 'function') {
    return { success: true, freedBytes: 0, formatted: '0 B' };
  }
  try {
    const res = await plugin.clearAppCache();
    return {
      success: res?.success ?? true,
      freedBytes: res?.freedBytes ?? 0,
      formatted: res?.formatted ?? '0 B',
    };
  } catch {
    throw new Error('清理缓存失败，请稍后重试');
  }
}

/**
 * 简单的 semver 比较：返回 >0 表示 a 更新，<0 表示 b 更新，0 相等。
 * 仅支持数字段（"0.9.1" → [0,9,1]），不支持预发布标签。
 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split('.').map((s) => Number.parseInt(s, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] ?? 0;
    const bi = pb[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/**
 * 解析本机 APK 在 cacheDir 中的路径（按 versionCode 命名，便于历史清理）。
 * 这里只生成路径字符串，不创建文件——由原生 Plugin 在写入时自动创建父目录。
 */
async function resolveApkCachePath(versionCode: number): Promise<string> {
  // Capacitor 在 WebView 中无法直接访问原生 cacheDir 路径。
  // 由 ApkDistributionPlugin 在原生侧若 destPath 为相对路径则解析到 cacheDir。
  // 这里使用一个明确约定的相对文件名，原生 Plugin 用 getContext().getCacheDir() 拼接。
  return `medbox-update-${versionCode}.apk`;
}

/**
 * 主动扫描局域网内的设备以发现可用新版本。
 * 优先级：
 * 1. 已配对过的已知设备列表（已知对方 IP 且通信过）；
 * 2. 同子网（/24）并发轻量探测（若原生提供 scanSubnet）。
 *
 * 发现新版本后会自动写入 localStorage 并派发 medbox:app-update-changed 事件，返回发现的更新；
 * 若未发现新版本则返回 null。
 */
export async function scanLanForUpdates(timeoutMs = 3000): Promise<AvailableUpdate | null> {
  if (!isApkDistributionAvailable()) {
    throw new Error('当前环境不支持局域网更新（仅 Android 原生 App 支持）');
  }

  const startTime = Date.now();
  const candidateHosts = new Set<string>();

  // 1. 收集已配对设备
  try {
    const peers = listKnownPeers();
    for (const p of peers) {
      if (p.host) candidateHosts.add(p.host);
    }
  } catch {
    /* ignore */
  }

  // 2. 原生并发子网扫描
  if (typeof plugin.scanSubnet === 'function') {
    try {
      const remainingMs = Math.max(500, timeoutMs - (Date.now() - startTime));
      const res = await plugin.scanSubnet({ port: APK_DISTRIBUTION_PORT, timeoutMs: Math.min(1000, remainingMs) });
      if (res && Array.isArray(res.peers)) {
        for (const p of res.peers) {
          if (p.host) candidateHosts.add(p.host);
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (candidateHosts.size === 0) {
    return null;
  }

  // 3. 逐个候选源探测
  for (const host of candidateHosts) {
    if (Date.now() - startTime > timeoutMs) {
      break;
    }
    try {
      if (typeof plugin.probePeer === 'function') {
        const remainingMs = Math.max(400, timeoutMs - (Date.now() - startTime));
        const probe = await plugin.probePeer({ host, port: APK_DISTRIBUTION_PORT, timeoutMs: Math.min(1200, remainingMs) });
        if (!probe.reachable) continue;
      }

      // 临时拉取 APK 并直接验证版本
      const probeDestPath = 'medbox-update-probe.apk';
      await plugin.download({
        host,
        port: APK_DISTRIBUTION_PORT,
        destPath: probeDestPath,
      });

      let archive: { packageName: string; versionCode: number; versionName: string };
      try {
        archive = await plugin.verifyApk({ apkPath: probeDestPath });
      } catch {
        await deleteApk(probeDestPath);
        continue;
      }

      // 如果版本高于当前版本，说明找到了有效更新
      if (archive.versionCode > LOCAL_APP_VERSION_CODE) {
        await deleteApk(probeDestPath);
        const update: AvailableUpdate = {
          version: archive.versionName,
          versionCode: archive.versionCode,
          source: 'lan',
          peerHost: host,
          peerPort: APK_DISTRIBUTION_PORT,
          discoveredAt: Date.now(),
        };
        saveAvailableUpdate(update);
        dispatchUpdateChanged();
        return update;
      } else {
        await deleteApk(probeDestPath);
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * 检查 Cloudflare 边缘托管的极速版本元数据（约 50~150ms 极低延迟响应）。
 */
export async function checkFastCloudVersion(): Promise<AvailableUpdate | null> {
  const metaUrl = `${CLOUD_ORIGIN}/version.json`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(metaUrl, {
      cache: 'no-cache',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      version?: string;
      versionCode?: number;
      downloadUrl?: string;
      fileSize?: number;
      sha256?: string;
      bundleUrl?: string;
      bundleSize?: number;
      bundleSha256?: string;
      minNativeVersionCode?: number;
      releaseNotes?: string;
    };
    if (!json || typeof json.version !== 'string') return null;

    const rawTag = json.version.trim();
    const remoteVersion = rawTag.startsWith('v') || rawTag.startsWith('V') ? rawTag.slice(1) : rawTag;
    if (!remoteVersion) return null;

    // 若版本低于或等于当前版本，则无需更新
    if (compareVersion(remoteVersion, LOCAL_APP_VERSION) <= 0) {
      return null;
    }

    const estimatedCode = typeof json.versionCode === 'number'
      ? json.versionCode
      : (LOCAL_APP_VERSION_CODE + Math.max(1, compareVersion(remoteVersion, LOCAL_APP_VERSION)));

    // 增量包校验与判断
    const bundleUrl = resolveDownloadUrl(json.bundleUrl);
    const bundleSha256 = typeof json.bundleSha256 === 'string' && SHA256_RE.test(json.bundleSha256.toLowerCase())
      ? json.bundleSha256.toLowerCase()
      : undefined;
    const minNativeCode = typeof json.minNativeVersionCode === 'number'
      ? json.minNativeVersionCode
      : DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE;
    const canIncremental = Boolean(
      bundleUrl
      && LOCAL_APP_VERSION_CODE > 0
      && LOCAL_APP_VERSION_CODE >= minNativeCode,
    );

    // 元数据里的直链是 `/api/download?tag=v…`（同源代理），也兼容绝对地址。
    const downloadUrl = resolveDownloadUrl(json.downloadUrl)
      ?? `${CLOUD_ORIGIN}/api/download?tag=v${encodeURIComponent(remoteVersion)}`;
    const sha256 = typeof json.sha256 === 'string' && SHA256_RE.test(json.sha256.toLowerCase())
      ? json.sha256.toLowerCase()
      : undefined;

    return {
      version: remoteVersion,
      versionCode: estimatedCode,
      source: 'cloud',
      updateType: canIncremental ? 'incremental' : 'full',
      downloadUrl,
      bundleUrl: bundleUrl ?? undefined,
      bundleSize: typeof json.bundleSize === 'number' && json.bundleSize > 0 ? json.bundleSize : undefined,
      bundleSha256,
      minNativeVersionCode: minNativeCode,
      fileSize: typeof json.fileSize === 'number' && json.fileSize > 0 ? json.fileSize : undefined,
      sha256,
      releaseNotes: typeof json.releaseNotes === 'string' ? json.releaseNotes.trim() : undefined,
      discoveredAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * 检查 GitHub Releases 官方最新版本（带国内镜像多源并发竞速加速与容错）。
 */
export async function checkGithubRelease(): Promise<AvailableUpdate | null> {
  interface GhRelease {
    tag_name?: string;
    body?: string;
    assets?: Array<{ name?: string; browser_download_url?: string; size?: number; digest?: string }>;
  }

  // 仓库是私有的：直连 api.github.com 与三个公开镜像一律 404（实测 2026-09-09），
  // 唯一可行通道是自家 Cloudflare 代理。代理会把 APK 资产的 browser_download_url
  // 改写成同源 `/api/download?tag=…`，所以这里拿到的直链就是可下载的。
  let releaseData: GhRelease | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`${CLOUD_ORIGIN}/api/releases`, {
      headers: { Accept: 'application/vnd.github.v3+json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return null;
    }
    const json = (await res.json()) as GhRelease;
    if (!json || !json.tag_name) {
      return null;
    }
    releaseData = json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }

  if (!releaseData || !releaseData.tag_name) {
    return null;
  }

  const rawTag = String(releaseData.tag_name).trim();
  const remoteVersion = rawTag.startsWith('v') || rawTag.startsWith('V') ? rawTag.slice(1) : rawTag;
  if (!remoteVersion) return null;

  // 若版本低于或等于当前版本，则无需更新
  if (compareVersion(remoteVersion, LOCAL_APP_VERSION) <= 0) {
    return null;
  }

  const assets = Array.isArray(releaseData.assets) ? releaseData.assets : [];
  const apkAsset = assets.find((a) => a.name?.endsWith('.apk') && !a.name.includes('unaligned'));
  if (!apkAsset || !apkAsset.browser_download_url) {
    return null;
  }
  const downloadUrl = resolveDownloadUrl(apkAsset.browser_download_url);
  if (!downloadUrl) {
    return null;
  }

  const bundleAsset = assets.find((a) => a.name?.endsWith('.zip') && (a.name.includes('bundle') || a.name.includes('web')));
  const bundleUrl = bundleAsset?.browser_download_url ? resolveDownloadUrl(bundleAsset.browser_download_url) : null;

  const rawBundleDigest = typeof bundleAsset?.digest === 'string' ? bundleAsset.digest : undefined;
  const bundleSha256 = rawBundleDigest && rawBundleDigest.startsWith('sha256:')
    ? rawBundleDigest.slice(7).toLowerCase()
    : undefined;

  const rawApkDigest = typeof apkAsset?.digest === 'string' ? apkAsset.digest : undefined;
  const apkSha256 = rawApkDigest && rawApkDigest.startsWith('sha256:')
    ? rawApkDigest.slice(7).toLowerCase()
    : undefined;

  const diff = compareVersion(remoteVersion, LOCAL_APP_VERSION);
  const estimatedCode = diff > 0 ? LOCAL_APP_VERSION_CODE + diff : LOCAL_APP_VERSION_CODE;
  const minNativeCode = DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE;
  const canIncremental = Boolean(
    bundleUrl
    && LOCAL_APP_VERSION_CODE > 0
    && LOCAL_APP_VERSION_CODE >= minNativeCode,
  );

  return {
    version: remoteVersion,
    versionCode: estimatedCode,
    source: 'github',
    updateType: canIncremental ? 'incremental' : 'full',
    downloadUrl,
    bundleUrl: bundleUrl ?? undefined,
    bundleSize: typeof bundleAsset?.size === 'number' && bundleAsset.size > 0 ? bundleAsset.size : undefined,
    bundleSha256,
    minNativeVersionCode: minNativeCode,
    fileSize: typeof apkAsset.size === 'number' && apkAsset.size > 0 ? apkAsset.size : undefined,
    sha256: apkSha256,
    releaseNotes: typeof releaseData.body === 'string' ? releaseData.body.trim() : undefined,
    discoveredAt: Date.now(),
  };
}

/**
 * 综合线上版本探测：优先竞速 Cloudflare 边缘极速通道（~50-150ms），
 * 同步并发 GitHub Releases 镜像源校验，择优返回最新可用版本。
 */
export async function checkOnlineRelease(): Promise<AvailableUpdate | null> {
  const cloudPromise = checkFastCloudVersion().catch(() => null);
  const ghPromise = checkGithubRelease().catch(() => null);

  // 极速竞速：若 Cloudflare 边缘在 1000ms 内直接返回了可用新版本，立即返回，免除等待
  const fastCloud = await Promise.race([
    cloudPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000)),
  ]);
  if (fastCloud) {
    return fastCloud;
  }

  // 否则等待两者完成，择优更高版本并互补权威资产哈希
  const [cloud, gh] = await Promise.all([cloudPromise, ghPromise]);
  if (cloud && gh) {
    if (compareVersion(cloud.version, gh.version) === 0) {
      return {
        ...cloud,
        bundleSha256: gh.bundleSha256 ?? cloud.bundleSha256,
        bundleSize: gh.bundleSize ?? cloud.bundleSize,
        sha256: gh.sha256 ?? cloud.sha256,
        fileSize: gh.fileSize ?? cloud.fileSize,
        updateType: (cloud.updateType === 'incremental' || gh.updateType === 'incremental') ? 'incremental' : 'full',
      };
    }
    return compareVersion(cloud.version, gh.version) > 0 ? cloud : gh;
  }
  return cloud || gh || null;
}

export interface CheckUpdateOptions {
  /** 状态变化回调，用于在 UI（如按钮文本）上展示分步进度 */
  onStatus?: (status: string) => void;
  /** 局域网探测最大超时毫秒数（默认 3000ms） */
  timeoutLanMs?: number;
}

/**
 * 统一检查更新：
 * 1. 优先通过云端极速通道（Cloudflare Anycast + GitHub 镜像竞速）在 0.3s 内极速确定是否有新版本；
 * 2. 一旦云端发现新版本，立即拦截返回并提示用户更新，不再无谓等待 8~10 秒局域网扫描；
 * 3. 仅当云端已是最新或离线时，才启动局域网周边设备探测（带 3 秒严格超时上限）。
 */
export async function checkForAppUpdates(options?: CheckUpdateOptions): Promise<AvailableUpdate | null> {
  const onStatus = options?.onStatus;
  const timeoutLanMs = options?.timeoutLanMs ?? 3000;

  onStatus?.('正在检查云端最新版本...');

  // 1. 并发启动云端检测与局域网探测
  const onlinePromise = checkOnlineRelease().catch(() => null);

  const lanScanPromise = isApkDistributionAvailable()
    ? Promise.race([
        scanLanForUpdates(timeoutLanMs).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutLanMs)),
      ])
    : Promise.resolve(null);

  // 2. 检查云端是否在极短时间内返回了新版本
  const onlineUpdate = await onlinePromise;
  if (onlineUpdate) {
    // 发现云端官方新版本，立即保存并派发，跳过漫长的局域网等待
    saveAvailableUpdate(onlineUpdate);
    dispatchUpdateChanged();
    return onlineUpdate;
  }

  // 3. 云端无更新或网络不可用：如果支持局域网分发，提示用户正在扫描周边设备
  if (isApkDistributionAvailable()) {
    onStatus?.('云端已是最新，正在扫描周边设备...');
    const lanUpdate = await lanScanPromise;
    if (lanUpdate) {
      saveAvailableUpdate(lanUpdate);
      dispatchUpdateChanged();
      return lanUpdate;
    }
  }

  return null;
}

