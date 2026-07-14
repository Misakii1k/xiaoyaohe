import { normalizeEndpoint } from './api';
import { isValidHouseholdId, validateDeviceName } from './protocol';

const STORAGE_KEY = 'medbox.sync.v2.public-config';

export type SyncV2Role = 'caregiver' | 'patient';

/** Public routing metadata only. Tokens and encryption keys must never be added here. */
export interface SyncV2PublicConfig {
  endpoint: string;
  householdId: string;
  deviceName: string;
  role: SyncV2Role;
}

export function getSyncV2PublicConfig(): SyncV2PublicConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parsePublicConfig(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function setSyncV2PublicConfig(value: SyncV2PublicConfig): SyncV2PublicConfig {
  const parsed = parsePublicConfig(value);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

export function clearSyncV2PublicConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

function parsePublicConfig(value: unknown): SyncV2PublicConfig {
  if (!isRecord(value)) throw new Error('同步公开配置格式无效。');
  const endpoint = normalizeEndpoint(value.endpoint as string);
  if (!isValidHouseholdId(value.householdId)) throw new Error('家庭空间编号无效。');
  const deviceName = validateDeviceName(value.deviceName);
  if (!deviceName.ok) throw new Error(deviceName.issues[0]?.message ?? '设备名称无效。');
  if (value.role !== 'caregiver' && value.role !== 'patient') throw new Error('家庭角色无效。');
  return {
    endpoint,
    householdId: value.householdId,
    deviceName: deviceName.value,
    role: value.role,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
