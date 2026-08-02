// 腾讯云 ASR 本机配置：凭据对走一条安全存储记录，region 可进 localStorage。
import {
  ASR_CREDENTIALS_SECRET_KEY,
  ASR_SECRET_ID_KEY,
  ASR_SECRET_KEY_KEY,
  clearSessionSecret,
  getSessionSecret,
  initializeSecretStore,
  setSessionSecret,
} from './secretStore';

const LS_REGION_KEY = 'medbox.asrRegion.v1';
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
    await setSessionSecret(JSON.stringify(next), ASR_CREDENTIALS_SECRET_KEY);
    await cleanupLegacyCredentials();
    if (cfg.region !== undefined) writeRegion(cfg.region.trim() || DEFAULT_REGION);
  });
}

export function clearAsrConfig(): Promise<void> {
  return serializeCredentialsMutation(async () => {
    await initializeSecretStore();
    // 一条权威空记录即可同时清除两项凭据；失败时旧凭据对完整保留。
    await setSessionSecret(JSON.stringify({ secretId: '', secretKey: '' }), ASR_CREDENTIALS_SECRET_KEY);
    await cleanupLegacyCredentials();
    try {
      localStorage.removeItem(LS_REGION_KEY);
    } catch {
      /* ignore */
    }
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
  try {
    localStorage.setItem(LS_REGION_KEY, region);
  } catch {
    /* ignore */
  }
}

function readRegion(): string {
  try {
    const raw = localStorage.getItem(LS_REGION_KEY)?.trim();
    return raw || DEFAULT_REGION;
  } catch {
    return DEFAULT_REGION;
  }
}
