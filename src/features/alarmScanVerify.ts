/**
 * 「扫码解除强制提醒」偏好。
 *
 * 开启后，Android 原生全屏用药提醒（含增强通知入口）必须先扫描与本应用配对的
 * 解锁二维码才能出现「已服用 / 贪睡 / 跳过」等操作按钮——防止睡迷糊时随手关掉提醒，
 * 也保证服药动作发生在人已经起身走动之后。
 *
 * token 生成后展示为二维码（设置页可查看/保存），用户把它打印贴在药箱、
 * 冰箱门等远离床的位置。闹钟页相机扫到内容等于 token 才解锁。
 */

const STORAGE_KEY = 'medbox.alarm-scan-verify.v1';
const TOKEN_PREFIX = 'medbox-unlock:';

export interface AlarmScanVerifyPreference {
  enabled: boolean;
  /** 无前缀的裸随机串；native 端比对完整 `prefix + token` */
  token: string;
}

function randomToken(): string {
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    /* 极老 WebView 兜底：Math.random 足够用于本机自比对场景 */
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isValid(value: Partial<AlarmScanVerifyPreference> | null): value is AlarmScanVerifyPreference {
  return !!value && typeof value.token === 'string' && value.token.length >= 24
    && typeof value.enabled === 'boolean';
}

export function getAlarmScanVerifyPreference(): AlarmScanVerifyPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AlarmScanVerifyPreference>;
      if (isValid(parsed)) return parsed;
    }
  } catch {
    /* 解析失败按未配置处理 */
  }
  return { enabled: false, token: '' };
}

export function setAlarmScanVerifyPreference(preference: AlarmScanVerifyPreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    /* 写不进去仅影响本次会话持久性 */
  }
}

export function isAlarmScanVerifyEnabled(): boolean {
  const preference = getAlarmScanVerifyPreference();
  return preference.enabled && preference.token.length > 0;
}

/** 开启并生成新 token；返回可用于 QRCode 的完整码内容（带前缀）。 */
export function enableAlarmScanVerify(): string {
  const current = getAlarmScanVerifyPreference();
  const token = current.token || randomToken();
  setAlarmScanVerifyPreference({ enabled: true, token });
  return `${TOKEN_PREFIX}${token}`;
}

export function disableAlarmScanVerify(): void {
  const current = getAlarmScanVerifyPreference();
  setAlarmScanVerifyPreference({ enabled: false, token: current.token });
}

/** 重置令牌：旧二维码作废，需重新打印粘贴。返回新的完整码内容。 */
export function rotateAlarmScanToken(): string {
  setAlarmScanVerifyPreference({ enabled: true, token: randomToken() });
  return `${TOKEN_PREFIX}${getAlarmScanVerifyPreference().token}`;
}

/** 当前是否已生成过 token（决定能否直接查看二维码）。 */
export function hasAlarmScanToken(): boolean {
  return getAlarmScanVerifyPreference().token.length > 0;
}
