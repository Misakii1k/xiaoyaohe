// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ALARM_RINGTONE_OPTIONS,
  ALARM_RINGTONE_STORAGE_KEY,
  getAlarmRingtonePreference,
  isRingtonePreviewPlaying,
  playRingtonePreview,
  setAlarmRingtonePreference,
  stopRingtonePreview,
} from '../src/features/alarmRingtone';

const root = resolve(import.meta.dirname, '..');

describe('alarmRingtone 铃声设置与试听', () => {
  beforeEach(() => {
    localStorage.clear();
    stopRingtonePreview();
  });

  afterEach(() => {
    stopRingtonePreview();
    vi.restoreAllMocks();
  });

  it('默认铃声应为 morning_energy（晨间活力专属音乐），而非系统铃声', () => {
    expect(localStorage.getItem(ALARM_RINGTONE_STORAGE_KEY)).toBeNull();
    const pref = getAlarmRingtonePreference();
    expect(pref).toBe('morning_energy');

    const defaultOpt = ALARM_RINGTONE_OPTIONS.find((opt) => opt.id === 'morning_energy');
    expect(defaultOpt).toBeDefined();
    expect(defaultOpt?.isDefault).toBe(true);
    expect(defaultOpt?.name).toContain('晨间活力');
  });

  it('允许切换为系统铃声并持久化，也可以切回专属音乐', async () => {
    await setAlarmRingtonePreference('system');
    expect(localStorage.getItem(ALARM_RINGTONE_STORAGE_KEY)).toBe('system');
    expect(getAlarmRingtonePreference()).toBe('system');

    await setAlarmRingtonePreference('morning_energy');
    expect(localStorage.getItem(ALARM_RINGTONE_STORAGE_KEY)).toBe('morning_energy');
    expect(getAlarmRingtonePreference()).toBe('morning_energy');
  });

  it('ALARM_RINGTONE_OPTIONS 包含且仅包含 morning_energy 与 system 两个选项', () => {
    const ids = ALARM_RINGTONE_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(['morning_energy', 'system']);
  });

  it('playRingtonePreview 对 morning_energy 发起音频播放，stopRingtonePreview 停止音频', () => {
    let playCalled = false;
    let pauseCalled = false;

    class MockAudio {
      src: string;
      paused = true;
      currentTime = 0;
      private listeners = new Map<string, Array<() => void>>();

      constructor(src: string) {
        this.src = src;
      }
      play() {
        playCalled = true;
        this.paused = false;
        return Promise.resolve();
      }
      pause() {
        pauseCalled = true;
        this.paused = true;
      }
      addEventListener(event: string, cb: () => void) {
        const list = this.listeners.get(event) || [];
        list.push(cb);
        this.listeners.set(event, list);
      }
      removeEventListener(event: string, cb: () => void) {
        const list = this.listeners.get(event) || [];
        this.listeners.set(event, list.filter((l) => l !== cb));
      }
    }

    vi.stubGlobal('Audio', MockAudio);

    const started = playRingtonePreview('morning_energy');
    expect(started).toBe(true);
    expect(playCalled).toBe(true);
    expect(isRingtonePreviewPlaying()).toBe(true);

    stopRingtonePreview();
    expect(pauseCalled).toBe(true);
    expect(isRingtonePreviewPlaying()).toBe(false);
  });

  it('playRingtonePreview 对 system 选项不执行 Web 音频播放（跟随系统）', () => {
    const started = playRingtonePreview('system');
    expect(started).toBe(false);
    expect(isRingtonePreviewPlaying()).toBe(false);
  });

  it('设置页 UI 契约：包含提醒铃声选择与试听按钮，文案符合 oil-tone 规范且无专业黑话', () => {
    const settingsSource = readFileSync(join(root, 'src/pages/settings/panels/ReminderPanel.ts'), 'utf8');
    const stylesSource = readFileSync(join(root, 'src/ui/styles/pages/settings.css'), 'utf8');

    expect(settingsSource).toContain('function renderAlarmRingtoneCard');
    expect(settingsSource).toContain('body.append(renderAlarmRingtoneCard(rerender));');
    expect(settingsSource).toContain('用药提醒铃声');
    expect(settingsSource).toContain('专属音乐（默认）');
    expect(settingsSource).toContain('系统自带铃声');
    expect(settingsSource).toContain('试听专属提醒音乐（晨间活力）');
    expect(settingsSource).toContain('停止试听专属铃声');

    expect(stylesSource).toContain('.settings-ringtone-card');
    expect(stylesSource).toContain('.settings-ringtone-list');
    expect(stylesSource).toContain('.settings-ringtone-item');
    expect(stylesSource).toContain('.settings-ringtone-preview-btn');
  });
});
