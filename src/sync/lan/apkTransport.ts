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

const AVAILABLE_UPDATE_KEY = 'medbox.lan-sync.available-update.v1';
const LAST_UPDATE_NOTIFY_KEY = 'medbox.lan-sync.last-update-notify.v1';
const NOTIFY_DEBOUNCE_MS = 24 * 60 * 60 * 1000; // 24h

export type UpdateSource = 'github' | 'lan';

export interface AvailableUpdate {
  /** 更新版本号（如 "0.9.15"）。 */
  version: string;
  /** 更新 versionCode。 */
  versionCode: number;
  /** 更新来源类型。 */
  source?: UpdateSource;
  /** 分发源 IPv4（局域网更新有效）。 */
  peerHost?: string;
  /** 分发源 TCP 端口（一般是 38473，局域网更新有效）。 */
  peerPort?: number;
  /** 远程下载直链（GitHub/HTTP 更新有效）。 */
  downloadUrl?: string;
  /** 更新日志/说明。 */
  releaseNotes?: string;
  /** 安装包大小（字节数）。 */
  fileSize?: number;
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
    const source: UpdateSource = parsed.source === 'github' ? 'github' : 'lan';
    if (source === 'lan' && (!parsed.peerHost || !parsed.peerPort)) {
      return null;
    }
    if (source === 'github' && !parsed.downloadUrl) {
      return null;
    }
    return {
      version: parsed.version,
      versionCode: parsed.versionCode,
      source,
      peerHost: parsed.peerHost,
      peerPort: parsed.peerPort,
      downloadUrl: parsed.downloadUrl,
      releaseNotes: parsed.releaseNotes,
      fileSize: parsed.fileSize,
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
    await showNotification(`发现新版本 v${update.version}`, {
      body: '点击进入「应用更新」下载并安装。',
      tag: 'medbox-app-update',
      key: `update-${update.versionCode}`,
      data: { deepLink: '/settings?action=app-update' },
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
    if (update.source === 'github' && update.downloadUrl) {
      if (typeof plugin.downloadHttp !== 'function') {
        throw new Error('原生下载模块未就绪（downloadHttp 不可用）');
      }
      const candidates = [
        update.downloadUrl,
        `https://ghfast.top/${update.downloadUrl}`,
        `https://ghproxy.net/${update.downloadUrl}`,
        `https://gh-proxy.com/${update.downloadUrl}`,
      ];
      let lastErr: Error | null = null;
      let success = false;
      for (const url of candidates) {
        try {
          const result = await plugin.downloadHttp({ url, destPath });
          downloadedPath = result.destPath;
          success = true;
          break;
        } catch (error) {
          lastErr = error instanceof Error ? error : new Error(String(error));
        }
      }
      if (!success) {
        throw new Error(`下载更新失败：${lastErr?.message || '网络连接超时'}`);
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
  // GitHub 更新时以 APK 内部实际版本号为准（原生验签强制要求 archiveCode >= installedCode）。
  try {
    await plugin.verifyApk({
      apkPath: downloadedPath,
      ...(update.source !== 'github' ? { expectedVersionCode: update.versionCode } : {}),
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
export async function scanLanForUpdates(): Promise<AvailableUpdate | null> {
  if (!isApkDistributionAvailable()) {
    throw new Error('当前环境不支持局域网更新（仅 Android 原生 App 支持）');
  }

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
      const res = await plugin.scanSubnet({ port: APK_DISTRIBUTION_PORT, timeoutMs: 1000 });
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
    try {
      if (typeof plugin.probePeer === 'function') {
        const probe = await plugin.probePeer({ host, port: APK_DISTRIBUTION_PORT, timeoutMs: 1200 });
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
        try {
          localStorage.setItem(AVAILABLE_UPDATE_KEY, JSON.stringify(update));
        } catch {
          /* ignore */
        }
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
 * 检查 GitHub Releases 官方最新版本（带国内镜像加速容错）。
 */
export async function checkGithubRelease(): Promise<AvailableUpdate | null> {
  const repo = 'Misakii1k/xiaoyaohe';
  const apiUrls = [
    `https://api.github.com/repos/${repo}/releases/latest`,
    `https://ghfast.top/https://api.github.com/repos/${repo}/releases/latest`,
    `https://ghproxy.net/https://api.github.com/repos/${repo}/releases/latest`,
    `https://gh-proxy.com/https://api.github.com/repos/${repo}/releases/latest`,
  ];

  interface GhRelease {
    tag_name?: string;
    body?: string;
    assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>;
  }

  let releaseData: GhRelease | null = null;
  for (const url of apiUrls) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as GhRelease;
        if (json && json.tag_name) {
          releaseData = json;
          break;
        }
      }
    } catch {
      continue;
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

  const diff = compareVersion(remoteVersion, LOCAL_APP_VERSION);
  const estimatedCode = diff > 0 ? LOCAL_APP_VERSION_CODE + diff : LOCAL_APP_VERSION_CODE;

  return {
    version: remoteVersion,
    versionCode: estimatedCode,
    source: 'github',
    downloadUrl: apkAsset.browser_download_url,
    fileSize: apkAsset.size,
    releaseNotes: typeof releaseData.body === 'string' ? releaseData.body.trim() : undefined,
    discoveredAt: Date.now(),
  };
}

/**
 * 统一检查更新：并行发起 GitHub 线上官方检测与局域网 Wi-Fi 设备探测，
 * 自动比对版本号，择优返回最新可用更新。
 */
export async function checkForAppUpdates(): Promise<AvailableUpdate | null> {
  const [ghResult, lanResult] = await Promise.allSettled([
    checkGithubRelease().catch(() => null),
    isApkDistributionAvailable() ? scanLanForUpdates().catch(() => null) : Promise.resolve(null),
  ]);

  const ghUpdate = ghResult.status === 'fulfilled' ? ghResult.value : null;
  const lanUpdate = lanResult.status === 'fulfilled' ? lanResult.value : null;

  let best: AvailableUpdate | null = null;
  if (ghUpdate && lanUpdate) {
    const cmp = compareVersion(ghUpdate.version, lanUpdate.version);
    best = cmp >= 0 ? ghUpdate : lanUpdate;
  } else {
    best = ghUpdate || lanUpdate;
  }

  if (best) {
    try {
      localStorage.setItem(AVAILABLE_UPDATE_KEY, JSON.stringify(best));
    } catch {
      /* ignore */
    }
    dispatchUpdateChanged();
    return best;
  }

  return null;
}
