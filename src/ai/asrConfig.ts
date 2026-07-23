// 腾讯云 ASR 本机配置：SecretId/SecretKey 走 SecureStorage，region 可进 localStorage。
import {
  ASR_SECRET_ID_KEY,
  ASR_SECRET_KEY_KEY,
  clearSessionSecret,
  getSessionSecret,
  setSessionSecret,
} from './secretStore';

const LS_REGION_KEY = 'medbox.asrRegion.v1';
const DEFAULT_REGION = 'ap-guangzhou';

export interface AsrConfig {
  secretId: string;
  secretKey: string;
  region: string;
}

export function getAsrConfig(): AsrConfig {
  return {
    secretId: getSessionSecret(ASR_SECRET_ID_KEY),
    secretKey: getSessionSecret(ASR_SECRET_KEY_KEY),
    region: readRegion(),
  };
}

export function isAsrCredentialsConfigured(): boolean {
  const cfg = getAsrConfig();
  return Boolean(cfg.secretId && cfg.secretKey);
}

export async function setAsrConfig(cfg: Partial<AsrConfig>): Promise<void> {
  if (cfg.secretId !== undefined) await setSessionSecret(cfg.secretId, ASR_SECRET_ID_KEY);
  if (cfg.secretKey !== undefined) await setSessionSecret(cfg.secretKey, ASR_SECRET_KEY_KEY);
  if (cfg.region !== undefined) {
    const region = cfg.region.trim() || DEFAULT_REGION;
    try {
      localStorage.setItem(LS_REGION_KEY, region);
    } catch {
      /* ignore */
    }
  }
}

export async function clearAsrConfig(): Promise<void> {
  await clearSessionSecret(ASR_SECRET_ID_KEY);
  await clearSessionSecret(ASR_SECRET_KEY_KEY);
  try {
    localStorage.removeItem(LS_REGION_KEY);
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
