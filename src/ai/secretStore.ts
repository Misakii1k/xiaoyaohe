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

export function isNativeSecretStore(): boolean {
  return Capacitor.isNativePlatform();
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
  // Web 预览兜底：Capacitor SecureStorage 不可用时，把密钥落到 localStorage
  // （仅在用户本地浏览器，刷新后保留）。生产 Capacitor Android 仍走 SecureStorage。
  const webKeys: readonly string[] = !isNativeSecretStore()
    ? Array.from(new Set<string>([...KNOWN_KEYS]))
    : [];
  for (const key of webKeys) {
    try {
      const value = localStorage.getItem(webSecretKey(key));
      if (value) sessionSecrets.set(key, value);
    } catch {
      /* ignore */
    }
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

export async function setSessionSecret(secret: string, key: string = SECRET_KEY): Promise<void> {
  const trimmed = secret.trim();
  sessionSecrets.set(key, trimmed);
  if (!isNativeSecretStore()) {
    // Web 预览：写到 localStorage 以便刷新后仍能读到。
    try {
      if (trimmed) localStorage.setItem(webSecretKey(key), trimmed);
      else localStorage.removeItem(webSecretKey(key));
    } catch {
      /* ignore */
    }
    return;
  }
  // 原生路径：清掉任何 web localStorage 残留（迁移兼容），再写到 SecureStorage。
  try { localStorage.removeItem(webSecretKey(key)); } catch { /* ignore */ }
  await SecureStorage.set(key, trimmed, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
}

export async function clearSessionSecret(key: string = SECRET_KEY): Promise<void> {
  sessionSecrets.set(key, '');
  try { localStorage.removeItem(webSecretKey(key)); } catch { /* ignore */ }
  if (!isNativeSecretStore()) return;
  await SecureStorage.remove(key).catch(() => false);
}

function webSecretKey(key: string): string {
  return `medbox_web_secret::${key}`;
}
