import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const SECRET_KEY = 'ai-api-key';
let sessionSecret = '';
let initialized = false;

export function isNativeSecretStore(): boolean {
  return Capacitor.isNativePlatform();
}

export async function initializeSecretStore(): Promise<void> {
  if (initialized) return;
  initialized = true;
  if (!isNativeSecretStore()) return;
  try {
    await SecureStorage.setKeyPrefix('medbox_');
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    const value = await SecureStorage.get(SECRET_KEY, false);
    sessionSecret = typeof value === 'string' ? value : '';
  } catch {
    sessionSecret = '';
  }
}

export function getSessionSecret(): string {
  return sessionSecret;
}

export async function setSessionSecret(secret: string): Promise<void> {
  sessionSecret = secret.trim();
  if (!isNativeSecretStore()) return;
  await SecureStorage.set(SECRET_KEY, sessionSecret, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
}

export async function clearSessionSecret(): Promise<void> {
  sessionSecret = '';
  if (!isNativeSecretStore()) return;
  await SecureStorage.remove(SECRET_KEY).catch(() => false);
}
