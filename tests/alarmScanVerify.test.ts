// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  bindCustomAlarmScanCode,
  disableAlarmScanVerify,
  enableAlarmScanVerify,
  getAlarmScanExpectedToken,
  getAlarmScanVerifyPreference,
  hasAlarmScanToken,
  isAlarmScanVerifyEnabled,
  rotateAlarmScanToken,
  setAlarmScanVerifyPreference,
} from '../src/features/alarmScanVerify';

describe('alarmScanVerify 扫码解除强制提醒偏好', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('初始状态未开启且 token 为空', () => {
    const pref = getAlarmScanVerifyPreference();
    expect(pref.enabled).toBe(false);
    expect(pref.mode).toBe('generated');
    expect(pref.token).toBe('');
    expect(isAlarmScanVerifyEnabled()).toBe(false);
    expect(hasAlarmScanToken()).toBe(false);
    expect(getAlarmScanExpectedToken()).toBe('');
  });

  it('enableAlarmScanVerify 默认生成专属二维码并带前缀', () => {
    const code = enableAlarmScanVerify();
    expect(code.startsWith('medbox-unlock:')).toBe(true);
    expect(code.length).toBeGreaterThan(30);

    const pref = getAlarmScanVerifyPreference();
    expect(pref.enabled).toBe(true);
    expect(pref.mode).toBe('generated');
    expect(pref.token.length).toBeGreaterThan(20);
    expect(isAlarmScanVerifyEnabled()).toBe(true);
    expect(hasAlarmScanToken()).toBe(true);
    expect(getAlarmScanExpectedToken()).toBe(code);
  });

  it('bindCustomAlarmScanCode 支持绑定现实生活中的已有条码或二维码', () => {
    bindCustomAlarmScanCode('6901234567890', 'ean_13');

    const pref = getAlarmScanVerifyPreference();
    expect(pref.enabled).toBe(true);
    expect(pref.mode).toBe('custom');
    expect(pref.token).toBe('6901234567890');
    expect(pref.customLabel).toBe('EAN_13: 6901234567890');
    expect(isAlarmScanVerifyEnabled()).toBe(true);

    // 自定义码比对时必须是原始串，绝不能加 medbox-unlock: 前缀
    expect(getAlarmScanExpectedToken()).toBe('6901234567890');
  });

  it('bindCustomAlarmScanCode 拒绝空串', () => {
    expect(() => bindCustomAlarmScanCode('')).toThrow('条形码/二维码内容不能为空');
    expect(() => bindCustomAlarmScanCode('   ')).toThrow('条形码/二维码内容不能为空');
  });

  it('disableAlarmScanVerify 关闭但保留已绑定的码', () => {
    bindCustomAlarmScanCode('MY-MEDICINE-BOX-QR');
    expect(isAlarmScanVerifyEnabled()).toBe(true);

    disableAlarmScanVerify();
    const pref = getAlarmScanVerifyPreference();
    expect(pref.enabled).toBe(false);
    expect(pref.token).toBe('MY-MEDICINE-BOX-QR');
    expect(pref.mode).toBe('custom');
    expect(isAlarmScanVerifyEnabled()).toBe(false);
    expect(hasAlarmScanToken()).toBe(true);
    expect(getAlarmScanExpectedToken()).toBe('');
  });

  it('rotateAlarmScanToken 重新生成专属码并切换回 generated 模式', () => {
    bindCustomAlarmScanCode('CUSTOM-CODE');
    expect(getAlarmScanVerifyPreference().mode).toBe('custom');

    const newCode = rotateAlarmScanToken();
    expect(newCode.startsWith('medbox-unlock:')).toBe(true);
    const pref = getAlarmScanVerifyPreference();
    expect(pref.mode).toBe('generated');
    expect(pref.token).not.toBe('CUSTOM-CODE');
    expect(pref.customLabel).toBeUndefined();
    expect(getAlarmScanExpectedToken()).toBe(newCode);
  });

  it('兼容旧版无 mode 字段的持久化数据', () => {
    localStorage.setItem(
      'medbox.alarm-scan-verify.v1',
      JSON.stringify({ enabled: true, token: '0123456789abcdef0123456789abcdef' }),
    );
    const pref = getAlarmScanVerifyPreference();
    expect(pref.enabled).toBe(true);
    expect(pref.mode).toBe('generated');
    expect(pref.token).toBe('0123456789abcdef0123456789abcdef');
    expect(getAlarmScanExpectedToken()).toBe('medbox-unlock:0123456789abcdef0123456789abcdef');
  });
});
