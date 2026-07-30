// 应用设置的统一白名单入口：小助手通过 update_app_settings 工具修改设置时，
// 只能触碰在此处声明的可调项；敏感项（AI 授权、API 密钥、原生权限）不在白名单内。
//
// 设计原则：
// - 每个可调项都有明确的 key / label / 类型 / 取值范围。
// - set() 内部调用对应业务模块的 setter，保证状态同步（开关、提醒重排等）。
// - 不暴露任何会改写密钥、原生权限或用户授权记录的项。
import {
  isAppNotificationsEnabled,
  setAppNotificationsEnabled,
  NOTIFICATION_PREF_CHANGE_EVENT,
} from './notificationPreference';
import {
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  isLanAutoSyncSilent,
  setLanAutoSyncSilent,
} from '../sync/lan/autoSync';
import {
  isLanAllowRemoteOverwrite,
  setLanAllowRemoteOverwrite,
} from '../sync/lan/policy';
import { rescheduleMedicationReminders } from './reminderScheduler';

export type AppSettingType = 'boolean' | 'number' | 'string';

export interface AppSettingDescriptor {
  key: string;
  label: string;
  type: AppSettingType;
  /** 对 boolean：[false, true]；对 string/number：允许的取值列表（不传则不限制） */
  allowedValues?: readonly unknown[];
  get(): unknown;
  set(value: unknown): Promise<void>;
}

const APP_SETTINGS_CHANGE_EVENT = 'medbox:app-settings-change';

/** 通知 UI 某项设置被改动，便于设置页刷新。 */
export function dispatchAppSettingsChange(key: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(APP_SETTINGS_CHANGE_EVENT, { detail: { key } }));
  // 通知开关修改同时触发通用通知偏好事件，保持与设置面板一致
  if (key === 'appNotificationsEnabled') {
    window.dispatchEvent(new CustomEvent(NOTIFICATION_PREF_CHANGE_EVENT, {
      detail: { enabled: isAppNotificationsEnabled() },
    }));
  }
}

export const APP_SETTINGS_CHANGE_EVENT_NAME = APP_SETTINGS_CHANGE_EVENT;

const adjustableSettings: readonly AppSettingDescriptor[] = [
  {
    key: 'appNotificationsEnabled',
    label: '应用内用药提醒',
    type: 'boolean',
    get: () => isAppNotificationsEnabled(),
    async set(value) {
      const enabled = coerceBoolean(value);
      setAppNotificationsEnabled(enabled);
      try { await rescheduleMedicationReminders(); } catch { /* 重排失败由下次启动兜底 */ }
    },
  },
  {
    key: 'lanAutoSyncEnabled',
    label: '局域网自动同步',
    type: 'boolean',
    get: () => isAutoSyncEnabled(),
    async set(value) {
      setAutoSyncEnabled(coerceBoolean(value));
    },
  },
  {
    key: 'lanAutoSyncSilent',
    label: '自动同步冲突静默处理',
    type: 'boolean',
    get: () => isLanAutoSyncSilent(),
    async set(value) {
      setLanAutoSyncSilent(coerceBoolean(value));
    },
  },
  {
    key: 'lanAllowRemoteOverwrite',
    label: '允许同局域网设备覆盖本机数据',
    type: 'boolean',
    get: () => isLanAllowRemoteOverwrite(),
    async set(value) {
      setLanAllowRemoteOverwrite(coerceBoolean(value));
    },
  },
];

export function listAdjustableSettings(): readonly AppSettingDescriptor[] {
  return adjustableSettings;
}

export function getSettingDescriptor(key: string): AppSettingDescriptor | undefined {
  return adjustableSettings.find((s) => s.key === key);
}

export function getSetting(key: string): unknown {
  const descriptor = getSettingDescriptor(key);
  if (!descriptor) return undefined;
  return descriptor.get();
}

/** 把任意输入转成符合 descriptor 类型/取值范围的值；不合法返回 undefined。 */
export function coerceSettingValue(
  descriptor: AppSettingDescriptor,
  value: unknown,
): unknown | undefined {
  if (descriptor.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'on' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') return false;
    }
    if (typeof value === 'number') return value !== 0;
    return undefined;
  }
  if (descriptor.type === 'number') {
    const n = typeof value === 'string' ? Number(value) : value;
    if (typeof n !== 'number' || !Number.isFinite(n)) return undefined;
    if (descriptor.allowedValues && !descriptor.allowedValues.includes(n)) return undefined;
    return n;
  }
  // string
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (descriptor.allowedValues && !descriptor.allowedValues.includes(trimmed)) return undefined;
  return trimmed;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const descriptor = getSettingDescriptor(key);
  if (!descriptor) {
    throw new Error(`不支持的设置项：${key}`);
  }
  const coerced = coerceSettingValue(descriptor, value);
  if (coerced === undefined) {
    throw new Error(`设置项 ${descriptor.label} 的值无效：${String(value)}`);
  }
  await descriptor.set(coerced);
  dispatchAppSettingsChange(key);
}

function coerceBoolean(value: unknown): boolean {
  return value === true;
}
