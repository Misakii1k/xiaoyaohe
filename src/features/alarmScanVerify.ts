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

export type AlarmScanVerifyMode = 'generated' | 'custom';

export interface AlarmScanVerifyPreference {
  enabled: boolean;
  /** 解锁码类型：'generated' 为系统专属二维码，'custom' 为生活中的已有条码或二维码 */
  mode?: AlarmScanVerifyMode;
  /**
   * 当 mode === 'generated' 时，为无前缀的裸随机串；比对时加 TOKEN_PREFIX。
   * 当 mode === 'custom' 时，为扫描到的原始条形码或二维码串。
   */
  token: string;
  /** 仅 custom 模式下记录，用于在设置界面展示给用户确认（如 "EAN_13: 6901234567890"） */
  customLabel?: string;
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
  return !!value && typeof value.token === 'string' && value.token.length > 0
    && typeof value.enabled === 'boolean';
}

export function getAlarmScanVerifyPreference(): AlarmScanVerifyPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AlarmScanVerifyPreference>;
      if (isValid(parsed)) {
        return {
          enabled: parsed.enabled,
          mode: parsed.mode ?? 'generated',
          token: parsed.token,
          customLabel: parsed.customLabel,
        };
      }
    }
  } catch {
    /* 解析失败按未配置处理 */
  }
  return { enabled: false, mode: 'generated', token: '' };
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

/** 获取闹钟界面摄像头扫码时比对的期望完整字符串。 */
export function getAlarmScanExpectedToken(): string {
  const preference = getAlarmScanVerifyPreference();
  if (!preference.enabled || !preference.token) return '';
  if (preference.mode === 'custom') {
    return preference.token.trim();
  }
  return `${TOKEN_PREFIX}${preference.token.trim()}`;
}

/** 开启并生成/保留专属二维码 token；返回可用于 QRCode 的完整码内容（带前缀）。 */
export function enableAlarmScanVerify(mode: AlarmScanVerifyMode = 'generated'): string {
  const current = getAlarmScanVerifyPreference();
  if (mode === 'custom' && current.token) {
    setAlarmScanVerifyPreference({ ...current, enabled: true, mode: 'custom' });
    return current.token;
  }
  const token = (current.mode === 'generated' && current.token) ? current.token : randomToken();
  setAlarmScanVerifyPreference({ enabled: true, mode: 'generated', token, customLabel: undefined });
  return `${TOKEN_PREFIX}${token}`;
}

/** 绑定生活中的已有二维码/条形码作为解锁条件。 */
export function bindCustomAlarmScanCode(code: string, format?: string): void {
  const trimmed = code.trim();
  if (!trimmed) throw new Error('条形码/二维码内容不能为空');
  const label = format ? `${format.toUpperCase()}: ${trimmed}` : trimmed;
  setAlarmScanVerifyPreference({
    enabled: true,
    mode: 'custom',
    token: trimmed,
    customLabel: label,
  });
}

export function disableAlarmScanVerify(): void {
  const current = getAlarmScanVerifyPreference();
  setAlarmScanVerifyPreference({ ...current, enabled: false });
}

/** 重置令牌：旧专属二维码作废，需重新打印粘贴。返回新的完整码内容。 */
export function rotateAlarmScanToken(): string {
  const token = randomToken();
  setAlarmScanVerifyPreference({ enabled: true, mode: 'generated', token, customLabel: undefined });
  return `${TOKEN_PREFIX}${token}`;
}

/** 当前是否已设置过 token（决定能否直接查看或使用）。 */
export function hasAlarmScanToken(): boolean {
  return getAlarmScanVerifyPreference().token.length > 0;
}

