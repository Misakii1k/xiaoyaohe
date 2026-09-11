import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const SECRET_KEY = 'ai-api-key';
/** 新版把地址、模型和密钥放在同一条安全存储记录中，避免新旧配置交叉。 */
export const LLM_CONFIG_SECRET_KEY = 'ai-llm-config-v1';
export const IMAGE_GEN_CONFIG_SECRET_KEY = 'ai-image-config-v2';
export const IMAGE_GEN_PROFILES_SECRET_KEY = 'ai-image-profiles-v1';
const KNOWN_KEYS = [
  SECRET_KEY,
  LLM_CONFIG_SECRET_KEY,
  IMAGE_GEN_CONFIG_SECRET_KEY,
  IMAGE_GEN_PROFILES_SECRET_KEY,
] as const;
const RETIRED_IMAGE_SECRET_KEY = 'ai-image-api-key';
const RETIRED_IMAGE_CONFIG_KEY = 'medbox.imageGenConfig.v1';
const sessionSecrets = new Map<string, string>();
let initializationPromise: Promise<void> | undefined;
let webStorageMutation: Promise<void> = Promise.resolve();

export type SecretStoreErrorCode =
  | 'initialization-failed'
  | 'write-failed'
  | 'remove-failed'
  | 'migration-failed'
  | 'state-unknown';

export class SecretStoreError extends Error {
  constructor(
    readonly code: SecretStoreErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

/**
 * 网页端密钥的存放方式（原生端一律走系统安全存储，与此设置无关）。
 * - 'device'：存 localStorage，关掉浏览器再打开还在，但**明文**留在本机磁盘上。
 * - 'session'：存 sessionStorage，关掉标签页即失效，适合公用电脑。
 */
export type WebSecretPersistence = 'device' | 'session';

const WEB_PERSISTENCE_KEY = 'medbox.web-secret-persistence.v1';
const WEB_STORAGE_LOCK_KEY = 'medbox.web-secret-storage-lock.v1';
/** 仅在浏览器拒绝持久化偏好时使用；成功持久化后不遮蔽跨标签页更新。 */
let volatileWebPersistence: WebSecretPersistence | undefined;

interface WebLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>;
}

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
  if (volatileWebPersistence) return volatileWebPersistence;
  // sessionStorage 只在 localStorage 偏好无法更新时写入，因此它代表当前标签页
  // 更新、更保守的选择；成功持久化到 localStorage 时会立即清掉这份回退值。
  try {
    const sessionChoice = sessionStorage.getItem(WEB_PERSISTENCE_KEY);
    if (sessionChoice === 'session' || sessionChoice === 'device') return sessionChoice;
  } catch {
    /* fall through to the persisted preference */
  }
  try {
    const persisted = localStorage.getItem(WEB_PERSISTENCE_KEY);
    if (persisted === 'session' || persisted === 'device') return persisted;
  } catch {
    /* fall through to the default */
  }
  return 'device';
}

/** 切换网页端密钥存放方式；写入目标、验证和清理源存储作为一次串行迁移。 */
export function setWebSecretPersistence(mode: WebSecretPersistence): Promise<void> {
  if (isNativeSecretStore()) return Promise.resolve();
  return serializeWebStorageMutation(async () => {
    await initializeSecretStore();
    await migrateWebSecrets(mode);
  });
}

export function initializeSecretStore(): Promise<void> {
  if (!initializationPromise) {
    const pending = initializeSecretStoreOnce().catch((cause) => {
      if (initializationPromise === pending) initializationPromise = undefined;
      throw asSecretStoreError('initialization-failed', '本机安全存储暂时不可用，请重试', cause);
    });
    initializationPromise = pending;
  }
  return initializationPromise;
}

async function initializeSecretStoreOnce(): Promise<void> {
  try {
    localStorage.removeItem(RETIRED_IMAGE_CONFIG_KEY);
  } catch {
    /* localStorage may be unavailable in private browsing or native startup */
  }

  // 网页端没有系统安全存储，按用户选择落到浏览器存储；风险提示见上方常量。
  if (!isNativeSecretStore()) {
    const restored = new Map<string, string>();
    for (const key of KNOWN_KEYS) restored.set(key, readWebSecret(key));
    replaceSessionSecrets(restored);
    return;
  }

  await SecureStorage.setKeyPrefix('medbox_');
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
  await SecureStorage.remove(RETIRED_IMAGE_SECRET_KEY).catch(() => false);
  const restored = new Map<string, string>();
  for (const key of KNOWN_KEYS) {
    const value = await SecureStorage.get(key, false);
    restored.set(key, typeof value === 'string' ? value : '');
  }
  replaceSessionSecrets(restored);
}

export function getSessionSecret(key: string = SECRET_KEY): string {
  return sessionSecrets.get(key) ?? '';
}

export async function setSessionSecret(secret: string, key: string = SECRET_KEY): Promise<void> {
  await initializeSecretStore();
  const trimmed = secret.trim();
  if (!isNativeSecretStore()) {
    return serializeWebStorageMutation(async () => {
      try {
        persistWebSecret(key, trimmed);
      } catch (cause) {
        throw asSecretStoreError('write-failed', '浏览器无法保存密钥，请检查存储权限', cause);
      }
      sessionSecrets.set(key, trimmed);
    });
  }

  try {
    await SecureStorage.set(key, trimmed, false, false, KeychainAccess.whenUnlockedThisDeviceOnly);
  } catch (cause) {
    throw asSecretStoreError('write-failed', '系统安全存储写入失败，请重试', cause);
  }
  sessionSecrets.set(key, trimmed);
  clearWebSecretCopies(key);
}

export async function clearSessionSecret(key: string = SECRET_KEY): Promise<void> {
  await initializeSecretStore();
  if (!isNativeSecretStore()) {
    return serializeWebStorageMutation(async () => {
      try {
        persistWebSecret(key, '');
      } catch (cause) {
        throw asSecretStoreError('remove-failed', '浏览器无法清除密钥，请检查存储权限', cause);
      }
      sessionSecrets.set(key, '');
    });
  }

  try {
    await SecureStorage.remove(key);
  } catch (cause) {
    throw asSecretStoreError('remove-failed', '系统安全存储清除失败，请重试', cause);
  }
  sessionSecrets.set(key, '');
  clearWebSecretCopies(key);
}

function replaceSessionSecrets(values: ReadonlyMap<string, string>): void {
  sessionSecrets.clear();
  for (const [key, value] of values) sessionSecrets.set(key, value);
}

function serializeWebStorageMutation(operation: () => Promise<void>): Promise<void> {
  const lockedOperation = () => withWebStorageLock(operation);
  const result = webStorageMutation.then(lockedOperation, lockedOperation);
  webStorageMutation = result.catch(() => undefined);
  return result;
}

async function withWebStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const lockManager = typeof navigator !== 'undefined'
    ? (navigator as Navigator & { locks?: WebLockManager }).locks
    : undefined;
  if (lockManager?.request) {
    return lockManager.request('medbox-web-secret-storage', { mode: 'exclusive' }, operation);
  }

  // Safari 等尚无 Web Locks 的浏览器用 localStorage 短租约兜底；存储本身不可用时，
  // 后续写入验证仍会失败关闭，不会为获得锁而吞掉真正的存储错误。
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    let acquired = false;
    try {
      const now = Date.now();
      const current = parseWebStorageLease(localStorage.getItem(WEB_STORAGE_LOCK_KEY));
      if (!current || current.expiresAt <= now) {
        const lease = JSON.stringify({ owner, expiresAt: now + 5_000 });
        localStorage.setItem(WEB_STORAGE_LOCK_KEY, lease);
        // localStorage 没有原子 compare-and-set；短暂让出执行权后再次确认所有权，
        // 可避免两个标签页同拍写入时都在第一次回读后误以为自己获得了租约。
        await new Promise((resolve) => setTimeout(resolve, 20));
        acquired = localStorage.getItem(WEB_STORAGE_LOCK_KEY) === lease;
      }
    } catch {
      return operation();
    }
    if (acquired) {
      try {
        return await operation();
      } finally {
        try {
          const latest = parseWebStorageLease(localStorage.getItem(WEB_STORAGE_LOCK_KEY));
          if (latest?.owner === owner) localStorage.removeItem(WEB_STORAGE_LOCK_KEY);
        } catch {
          /* 租约会自动过期；清理失败不能把已完成的密钥写入误报为失败。 */
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new SecretStoreError('write-failed', '浏览器密钥存储正被其他页面使用，请重试');
}

function parseWebStorageLease(raw: string | null): { owner: string; expiresAt: number } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { owner?: unknown; expiresAt?: unknown };
    if (typeof parsed.owner !== 'string' || typeof parsed.expiresAt !== 'number') return undefined;
    return { owner: parsed.owner, expiresAt: parsed.expiresAt };
  } catch {
    return undefined;
  }
}

async function migrateWebSecrets(mode: WebSecretPersistence): Promise<void> {
  const previousMode = getWebSecretPersistence();
  if (mode === previousMode) return;
  const source = storageForMode(previousMode);
  const target = storageForMode(mode);
  const snapshots = new Map<string, { source: string | null; target: string | null }>();
  const migratedValues = new Map<string, string>();
  let localPreference: string | null = null;
  let sessionPreference: string | null = null;
  let preferencesReadable = true;
  try {
    localPreference = localStorage.getItem(WEB_PERSISTENCE_KEY);
    sessionPreference = sessionStorage.getItem(WEB_PERSISTENCE_KEY);
  } catch {
    preferencesReadable = false;
  }

  try {
    for (const key of KNOWN_KEYS) {
      const storageKey = webSecretKey(key);
      const sourceValue = source.getItem(storageKey);
      const targetValue = target.getItem(storageKey);
      snapshots.set(key, { source: sourceValue, target: targetValue });
      // 持有跨标签锁后重读真实存储。共享 localStorage 中若已有值，说明其他标签页
      // 已提交了更新，迁移不能再用本标签页的旧内存快照覆盖它。
      const localValue = localStorage.getItem(storageKey);
      const nextValue = mode === 'session'
        ? localValue ?? sourceValue ?? targetValue ?? ''
        : sourceValue ?? targetValue ?? localValue ?? '';
      migratedValues.set(key, nextValue);
      setStorageValue(target, storageKey, nextValue);
    }
    try {
      setStorageValue(localStorage, WEB_PERSISTENCE_KEY, mode);
      setStorageValue(sessionStorage, WEB_PERSISTENCE_KEY, '');
      volatileWebPersistence = undefined;
    } catch {
      // localStorage 被禁用时，把偏好和 session-only 密钥一起保留到标签页生命周期。
      setStorageValue(sessionStorage, WEB_PERSISTENCE_KEY, mode);
      volatileWebPersistence = mode;
    }
    for (const [key, snapshot] of snapshots) {
      if (snapshot.source !== null) setStorageValue(source, webSecretKey(key), '');
    }
    replaceSessionSecrets(migratedValues);
  } catch (cause) {
    let rollbackFailed = false;
    for (const [key, snapshot] of snapshots) {
      const storageKey = webSecretKey(key);
      try {
        restoreStorageValue(source, storageKey, snapshot.source);
        restoreStorageValue(target, storageKey, snapshot.target);
      } catch {
        rollbackFailed = true;
      }
    }
    if (preferencesReadable) {
      try {
        restoreStorageValue(localStorage, WEB_PERSISTENCE_KEY, localPreference);
        restoreStorageValue(sessionStorage, WEB_PERSISTENCE_KEY, sessionPreference);
      } catch {
        rollbackFailed = true;
      }
    }
    volatileWebPersistence = preferencesReadable ? undefined : previousMode;
    throw asSecretStoreError(
      rollbackFailed ? 'state-unknown' : 'migration-failed',
      rollbackFailed ? '密钥存储状态无法确认，请重新填写密钥' : '密钥存放方式切换失败，原设置已保留',
      cause,
    );
  }
}

/** 单个密钥也采用写入验证 + 双存储回滚，避免目标失败后删除唯一副本。 */
function persistWebSecret(key: string, value: string): void {
  const active = storageForMode(getWebSecretPersistence());
  const inactive = active === sessionStorage ? localStorage : sessionStorage;
  const storageKey = webSecretKey(key);
  const activeBefore = active.getItem(storageKey);
  const inactiveBefore = inactive.getItem(storageKey);
  try {
    setStorageValue(active, storageKey, value);
    if (inactiveBefore !== null) setStorageValue(inactive, storageKey, '');
  } catch (cause) {
    let rollbackFailed = false;
    try { restoreStorageValue(active, storageKey, activeBefore); } catch { rollbackFailed = true; }
    try { restoreStorageValue(inactive, storageKey, inactiveBefore); } catch { rollbackFailed = true; }
    if (rollbackFailed) {
      throw new SecretStoreError('state-unknown', '密钥存储状态无法确认，请重新填写密钥', cause);
    }
    throw cause;
  }
}

function setStorageValue(storage: Storage, key: string, value: string): void {
  if (value) storage.setItem(key, value);
  else storage.removeItem(key);
  const actual = storage.getItem(key);
  if (actual !== (value || null)) throw new Error('Storage verification failed');
}

function restoreStorageValue(storage: Storage, key: string, value: string | null): void {
  if (value == null) storage.removeItem(key);
  else storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error('Storage rollback verification failed');
}

function storageForMode(mode: WebSecretPersistence): Storage {
  return mode === 'session' ? sessionStorage : localStorage;
}

/** 当前模式优先，另一处只用于读取旧版或上次未完成迁移留下的值。 */
function readWebSecret(key: string): string {
  const primary = storageForMode(getWebSecretPersistence());
  const secondary = primary === sessionStorage ? localStorage : sessionStorage;
  const storageKey = webSecretKey(key);
  try {
    const value = primary.getItem(storageKey);
    if (value) return value;
  } catch {
    /* fall back to the other browser store */
  }
  try {
    return secondary.getItem(storageKey) ?? '';
  } catch {
    return '';
  }
}

function clearWebSecretCopies(key: string): void {
  const storageKey = webSecretKey(key);
  try { localStorage.removeItem(storageKey); } catch { /* ignore migration residue */ }
  try { sessionStorage.removeItem(storageKey); } catch { /* ignore migration residue */ }
}

function webSecretKey(key: string): string {
  return `medbox_web_secret::${key}`;
}

function asSecretStoreError(
  code: SecretStoreErrorCode,
  message: string,
  cause: unknown,
): SecretStoreError {
  return cause instanceof SecretStoreError ? cause : new SecretStoreError(code, message, cause);
}
