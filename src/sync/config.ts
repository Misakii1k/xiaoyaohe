// 云同步配置：Worker 地址、共享空间 household、共享密钥。
// 存 localStorage（非健康数据，仅连接参数）。household 用不可猜随机 id 隔离两端。

const KEY = 'medbox.sync.config.v1';

/** Temporary product switch: keep the app local-only while cloud sync is paused. */
export const CLOUD_SYNC_ENABLED = false;

export interface SyncConfig {
  /** Worker 基址，如 https://medbox.xxx.workers.dev */
  workerUrl: string;
  /** 共享空间 id：两台手机填同一个即看同一份数据 */
  household: string;
  /** 轻量共享密钥，Worker 侧校验，防止 household 被猜中后乱写 */
  secret: string;
  /** 角色：照护者 / 患者（M3 升级推送用） */
  role: 'caregiver' | 'patient';
}

export function getSyncConfig(): SyncConfig | null {
  if (!CLOUD_SYNC_ENABLED) return null;
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const c = JSON.parse(s) as SyncConfig;
    if (!c.workerUrl || !c.household || !c.secret) return null;
    return c;
  } catch {
    return null;
  }
}

export function setSyncConfig(c: SyncConfig): void {
  localStorage.setItem(KEY, JSON.stringify(c));
}

export function clearSyncConfig(): void {
  localStorage.removeItem(KEY);
}

export function isSyncConfigured(): boolean {
  return getSyncConfig() !== null;
}

/** 生成不可猜的随机 household / secret（base36，约 80bit 熵） */
export function genId(): string {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(36).padStart(2, '0')).join('');
}
