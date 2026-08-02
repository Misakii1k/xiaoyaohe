import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const SECRET_KEY = 'ai-api-key';
/** 腾讯云 ASR SecretId / SecretKey：存在本机安全存储，不进 APK、不上传备份。 */
export const ASR_SECRET_ID_KEY = 'ai-asr-secret-id';
export const ASR_SECRET_KEY_KEY = 'ai-asr-secret-key';
const KNOWN_KEYS = [SECRET_KEY, ASR_SECRET_ID_KEY, ASR_SECRET_KEY_KEY] as const;
const RETIRED_IMAGE_SECRET_KEY = 'ai-image-api-key';
const RETIRED_IMAGE_CONFIG_KEY = 'medbox.imageGenConfig.v1';
const RETIRED_ASR_CONFIG_KEY = 'medbox.asrConfig.v1';
const sessionSecrets = new Map<string, string>();
let initialized = false;

/**
 * 网页端密钥的存放方式（原生端一律走系统安全存储，与此设置无关）。
 * - 'device'：存 localStorage，关掉浏览器再打开还在，但**明文**留在本机磁盘上。
 * - 'session'：存 sessionStorage，关掉标签页即失效，适合公用电脑。
 */
export type WebSecretPersistence = 'device' | 'session';

const WEB_PERSISTENCE_KEY = 'medbox.web-secret-persistence.v1';
let volatileWebPersistence: WebSecretPersistence | undefined;

/**
 * 网页端密钥存储的风险提示文案。
 *
 * 这里刻意**不做**前端加密：密钥和解密它所需的一切都在同一个浏览器里，
 * 任何能读 localStorage 的代码同样能拿到解密逻辑，那只是安全剧场。
 * 与其假装加密，不如如实告知，并给出「仅本次会话」这个真正有效的选项。
 */
export const WEB_SECRET_STORAGE_NOTICE =
  '浏览器端的密钥以明文保存在本机，任何能访问此浏览器的人或恶意扩展都可能读到。'
  + '公用电脑请选「仅本次会话」，或改用手机 App（App 走系统安全存储）。';

export function isNativeSecretStore(): boolean {
  return Capacitor.isNativePlatform();
}

/** 当前网页端密钥的存放方式；原生端恒为 'device'（实际走 SecureStorage）。 */
export function getWebSecretPersistence(): WebSecretPersistence {
  if (isNativeSecretStore()) return 'device';
  try {
    const persisted = localStorage.getItem(WEB_PERSISTENCE_KEY);
    if (persisted === 'session' || persisted === 'device') return persisted;
  } catch {
    return volatileWebPersistence ?? 'device';
  }
  return volatileWebPersistence ?? 'device';
}

/** 切换网页端密钥存放方式，并把已存的密钥就地搬到新位置（不必让用户重输）。 */
export function setWebSecretPersistence(mode: WebSecretPersistence): void {
  if (isNativeSecretStore()) return;
  volatileWebPersistence = mode;
  try {
    localStorage.setItem(WEB_PERSISTENCE_KEY, mode);
  } catch {
    /* 无痕模式下写不进去，此时只影响本次会话的选择 */
  }
  for (const key of KNOWN_KEYS) {
    writeWebSecret(key, sessionSecrets.get(key) ?? '');
  }
}

export async function initializeSecretStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    localStorage.removeItem(RETIRED_IMAGE_CONFIG_KEY);
    localStorage.removeItem(RETIRED_ASR_CONFIG_KEY);
  } catch {
    /* localStorage may be unavailable in private browsing or native startup */
  }
  // 网页端兜底：Capacitor SecureStorage 不可用，密钥只能落在浏览器存储里（明文）。
  // 按用户选择放 sessionStorage 或 localStorage，风险提示见 WEB_SECRET_STORAGE_NOTICE。
  // 生产 Capacitor Android 仍走 SecureStorage。
  const webKeys: readonly string[] = !isNativeSecretStore()
    ? Array.from(new Set<string>([...KNOWN_KEYS]))
    : [];
  for (const key of webKeys) {
    const value = readWebSecret(key);
    if (value) sessionSecrets.set(key, value);
  }
  if (!isNativeSecretStore()) return;
  try {
    await SecureStorage.setKeyPrefix('medbox_');
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    await SecureStorage.remove(RETIRED_IMAGE_SECRET_KEY).catch(() => false);
    for (const key of KNOWN_KEYS) {
      const value = await SecureStorage.get(key, false).catch(() => '');
      sessionSecrets.set(key, typeof value === 'string' ? value : '');
    }
  } catch {
    sessionSecrets.clear();
  }
}

export function getSessionSecret(key: string = SECRET_KEY): string {
  return sessionSecrets.get(key) ?? '';
}

export async function setSessionSecret(secret: string, key: string = SECRET_KEY): Promise<boolean> {
  const trimmed = secret.trim();
  sessionSecrets.set(key, trimmed);
  if (!isNativeSecretStore()) {
    // 网页端：按用户选的存放方式落盘，刷新后仍能读到（'session' 则关标签页即失效）。
    writeWebSecret(key, trimmed);
    return true;
  }
  // 原生路径：清掉任何 web localStorage 残留（迁移兼容），再写到 SecureStorage。
  try { localStorage.removeItem(webSecretKey(key)); } catch { /* ignore */ }
  try {
    await SecureStorage.set(key, trimmed, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
    return true;
  } catch (error) {
    console.warn('密钥写入安全存储失败', error);
    return false;
  }
}

export async function clearSessionSecret(key: string = SECRET_KEY): Promise<void> {
  sessionSecrets.set(key, '');
  writeWebSecret(key, ''); // 两个浏览器存储都清，避免切换过存放方式后留下残留
  if (!isNativeSecretStore()) return;
  await SecureStorage.remove(key).catch(() => false);
}

/** 写入当前选定的浏览器存储，并顺手清掉另一个，避免两处残留不一致。 */
function writeWebSecret(key: string, value: string): void {
  const storageKey = webSecretKey(key);
  const useSession = getWebSecretPersistence() === 'session';
  try {
    const active = useSession ? sessionStorage : localStorage;
    if (value) active.setItem(storageKey, value);
    else active.removeItem(storageKey);
  } catch {
    /* 无痕模式/存储被禁用时降级为「只留在内存里」 */
  }
  try {
    (useSession ? localStorage : sessionStorage).removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

/** 两个存储都读：用户可能刚切换过存放方式，也可能是老版本留下的 localStorage 值。 */
function readWebSecret(key: string): string {
  const storageKey = webSecretKey(key);
  try {
    const fromSession = sessionStorage.getItem(storageKey);
    if (fromSession) return fromSession;
  } catch {
    /* ignore */
  }
  try {
    return localStorage.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

function webSecretKey(key: string): string {
  return `medbox_web_secret::${key}`;
}
