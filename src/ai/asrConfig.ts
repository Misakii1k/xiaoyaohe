// 腾讯云 ASR 本机配置：凭据对走一条安全存储记录，region 跟随网页端 device/session 模式。
import {
  ASR_CREDENTIALS_SECRET_KEY,
  ASR_REGION_STORAGE_KEY,
  ASR_SECRET_ID_KEY,
  ASR_SECRET_KEY_KEY,
  clearSessionSecret,
  getSessionSecret,
  getWebSecretPersistence,
  initializeSecretStore,
  isNativeSecretStore,
  SecretStoreError,
  setSessionSecret,
} from './secretStore';

const DEFAULT_REGION = 'ap-guangzhou';
let credentialsMutation: Promise<void> = Promise.resolve();

export interface AsrConfig {
  secretId: string;
  secretKey: string;
  region: string;
}

export function initializeAsrSecretStore(): Promise<void> {
  return serializeCredentialsMutation(async () => {
    await initializeSecretStore();
    if (!getSessionSecret(ASR_CREDENTIALS_SECRET_KEY)) {
      const legacy = readLegacyCredentials();
      await setSessionSecret(JSON.stringify(legacy), ASR_CREDENTIALS_SECRET_KEY);
    }
    await cleanupLegacyCredentials();
  });
}

export function getAsrConfig(): AsrConfig {
  const stored = getSessionSecret(ASR_CREDENTIALS_SECRET_KEY);
  const credentials = stored ? parseCredentials(stored) : readLegacyCredentials();
  return {
    ...credentials,
    region: readRegion(),
  };
}

export function isAsrCredentialsConfigured(): boolean {
  const cfg = getAsrConfig();
  return Boolean(cfg.secretId && cfg.secretKey);
}

export function setAsrConfig(cfg: Partial<AsrConfig>): Promise<void> {
  return serializeCredentialsMutation(async () => {
    await initializeSecretStore();
    const current = getAsrConfig();
    const next = {
      secretId: cfg.secretId !== undefined ? cfg.secretId.trim() : current.secretId,
      secretKey: cfg.secretKey !== undefined ? cfg.secretKey.trim() : current.secretKey,
    };
    const previousRegion = cfg.region !== undefined ? readStoredRegion() : null;
    if (cfg.region !== undefined) writeRegion(cfg.region.trim() || DEFAULT_REGION);
    try {
      await setSessionSecret(JSON.stringify(next), ASR_CREDENTIALS_SECRET_KEY);
    } catch (cause) {
      if (cfg.region !== undefined) {
        try {
          restoreRegion(previousRegion);
        } catch {
          throw new SecretStoreError('state-unknown', '语音配置状态无法确认，请重新填写', cause);
        }
      }
      throw cause;
    }
    await cleanupLegacyCredentials();
  });
}

export function clearAsrConfig(): Promise<void> {
  return serializeCredentialsMutation(async () => {
    await initializeSecretStore();
    // 一条权威空记录即可同时清除两项凭据；失败时旧凭据对完整保留。
    await setSessionSecret(JSON.stringify({ secretId: '', secretKey: '' }), ASR_CREDENTIALS_SECRET_KEY);
    await cleanupLegacyCredentials();
    try { localStorage.removeItem(ASR_REGION_STORAGE_KEY); } catch { /* ignore */ }
    try { sessionStorage.removeItem(ASR_REGION_STORAGE_KEY); } catch { /* ignore */ }
  });
}

function serializeCredentialsMutation(operation: () => Promise<void>): Promise<void> {
  const result = credentialsMutation.then(operation, operation);
  credentialsMutation = result.catch(() => undefined);
  return result;
}

function parseCredentials(raw: string): Pick<AsrConfig, 'secretId' | 'secretKey'> {
  try {
    const parsed = JSON.parse(raw) as Partial<AsrConfig>;
    return {
      secretId: typeof parsed.secretId === 'string' ? parsed.secretId : '',
      secretKey: typeof parsed.secretKey === 'string' ? parsed.secretKey : '',
    };
  } catch {
    // 权威记录损坏时失败关闭，不拼接旧版的两条记录。
    return { secretId: '', secretKey: '' };
  }
}

function readLegacyCredentials(): Pick<AsrConfig, 'secretId' | 'secretKey'> {
  return {
    secretId: getSessionSecret(ASR_SECRET_ID_KEY),
    secretKey: getSessionSecret(ASR_SECRET_KEY_KEY),
  };
}

async function cleanupLegacyCredentials(): Promise<void> {
  for (const key of [ASR_SECRET_ID_KEY, ASR_SECRET_KEY_KEY]) {
    if (!getSessionSecret(key)) continue;
    try {
      await clearSessionSecret(key);
    } catch {
      // 组合记录已成为唯一权威值；下次启动会继续清理迁移残留。
    }
  }
}

function writeRegion(region: string): void {
  const storage = regionStorage();
  try {
    storage.setItem(ASR_REGION_STORAGE_KEY, region);
    if (storage.getItem(ASR_REGION_STORAGE_KEY) !== region) throw new Error('Storage verification failed');
  } catch (cause) {
    throw new SecretStoreError('write-failed', '浏览器无法保存语音地域，请检查存储权限', cause);
  }
}

function readStoredRegion(): string | null {
  try {
    return regionStorage().getItem(ASR_REGION_STORAGE_KEY);
  } catch (cause) {
    throw new SecretStoreError('write-failed', '浏览器无法读取当前语音地域，请检查存储权限', cause);
  }
}

function restoreRegion(region: string | null): void {
  const storage = regionStorage();
  if (region == null) storage.removeItem(ASR_REGION_STORAGE_KEY);
  else storage.setItem(ASR_REGION_STORAGE_KEY, region);
  if (storage.getItem(ASR_REGION_STORAGE_KEY) !== region) throw new Error('Storage rollback verification failed');
}

function readRegion(): string {
  const primary = regionStorage();
  const secondary = primary === sessionStorage ? localStorage : sessionStorage;
  try {
    const raw = primary.getItem(ASR_REGION_STORAGE_KEY)?.trim();
    if (raw) return raw;
  } catch {
    /* fall back to the other browser store */
  }
  try {
    return secondary.getItem(ASR_REGION_STORAGE_KEY)?.trim() || DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}

function regionStorage(): Storage {
  if (isNativeSecretStore()) return localStorage;
  return getWebSecretPersistence() === 'session' ? sessionStorage : localStorage;
}
