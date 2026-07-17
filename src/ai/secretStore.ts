import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const SECRET_KEY = 'ai-api-key';
/** 腾讯云语音识别的 SecretKey 槽位（签名用，不随请求明文外发） */
export const ASR_SECRET_KEY = 'ai-asr-secret-key';

const KNOWN_KEYS = [SECRET_KEY, ASR_SECRET_KEY] as const;
const RETIRED_IMAGE_SECRET_KEY = 'ai-image-api-key';
const RETIRED_IMAGE_CONFIG_KEY = 'medbox.imageGenConfig.v1';
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
  } catch {
    /* localStorage may be unavailable in private browsing or native startup */
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
  if (!isNativeSecretStore()) return;
  await SecureStorage.set(key, trimmed, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
}

export async function clearSessionSecret(key: string = SECRET_KEY): Promise<void> {
  sessionSecrets.set(key, '');
  if (!isNativeSecretStore()) return;
  await SecureStorage.remove(key).catch(() => false);
}
