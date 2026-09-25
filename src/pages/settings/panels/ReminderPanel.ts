import { el, toast, icon, field, confirmDialog } from '../../../ui/components';
import { openBottomSheet } from '../../../ui/primitives/BottomSheet';
import { createTimeControl } from '../../../ui/primitives/Pickers';
import { createStepper } from '../../../ui/primitives/Stepper';
import QRCode from 'qrcode';
import {
  notificationsSupported,
  getPermission,
  getExactAlarmCapability,
  isNativeReminderPlatform,
  requestPermission,
  requestExactAlarmCapability,
  getFullScreenAlarmCapability,
  refreshFullScreenAlarmCapability,
  requestFullScreenAlarmCapability,
  getOverlayAlarmCapability,
  refreshOverlayAlarmCapability,
  requestOverlayAlarmCapability,
  showNotification,
} from '../../../features/notifier';
import {
  isAppNotificationsEnabled,
  setAppNotificationsEnabled,
} from '../../../features/notificationPreference';
import { runOnce as runReminderOnce, rescheduleMedicationReminders } from '../../../features/reminderScheduler';
import {
  ALARM_RINGTONE_OPTIONS,
  getAlarmRingtonePreference,
  isRingtonePreviewPlaying,
  playRingtonePreview,
  setAlarmRingtonePreference,
  stopRingtonePreview,
} from '../../../features/alarmRingtone';
import {
  bindCustomAlarmScanCode,
  disableAlarmScanVerify,
  enableAlarmScanVerify,
  getAlarmScanVerifyPreference,
  getOrCreateGeneratedScanToken,
  rotateAlarmScanToken,
} from '../../../features/alarmScanVerify';
import {
  isAlarmSlideUnlockEnabled,
  setAlarmSlideUnlockEnabled,
} from '../../../features/alarmSlideUnlock';
import { startScan, scanCodeFromImage, type Scanner } from '../../../features/scanner';
import {
  checkAccessibilityGuardEnabled,
  fireNativeMedicationAlarmNow,
  nativeMedicationAlarmAvailable,
  openAccessibilityGuardSettings,
} from '../../../features/nativeMedicationAlarm';
import { isIgnoringBatteryOptimizations } from '../../../features/keepAlive';
import {
  listReminderPeriodSettings,
  getReminderPeriodSetting,
  updateReminderPeriodSetting,
  deleteReminderPeriodSetting,
} from '../../../db/local';
import {
  SLOT_LABEL,
  MEDICATION_REMINDER_MODE_LABEL,
  type ReminderPeriodSetting,
  type MedicationReminderMode,
  type Slot,
} from '../../../db/schema';
import { panel, setChip } from '../components/panelPrimitives';
import type { PanelChip } from '../types';
import { openKeepAliveGuideModal, openKeepAlivePromptSheet } from './KeepAlivePanel';
import { LOCAL_APP_VERSION_CODE } from '../../../sync/lan/apkTransport';

/** ---------------- 通知面板 ---------------- */
export function reminderPanelChip(): PanelChip {
  if (!notificationsSupported()) return { text: '不支持', tone: 'warn' };
  if (!isAppNotificationsEnabled()) return { text: '已暂停', tone: 'muted' };
  const perm = getPermission();
  if (perm === 'granted') return { text: '已开启', tone: 'ok' };
  if (perm === 'denied') return { text: '被拒绝', tone: 'warn' };
  return { text: '未开启', tone: 'muted' };
}

export function renderReminderPanel(): HTMLElement {
  let p!: HTMLElement;
  const refresh = (body: HTMLElement) => {
    body.replaceChildren();
    buildReminderBody(body, () => refresh(body));
    if (p) setChip(p, reminderPanelChip());
  };
  p = panel({
    title: '系统通知',
    iconName: 'bell-ring',
    iconTone: 'amber',
    chip: reminderPanelChip(),
    renderBody: (body) => buildReminderBody(body, () => refresh(body)),
  });
  return p;
}

export function formatBarcodeTypeLabel(format?: string): string {
  if (!format) return '条形码 / 二维码';
  const f = format.toLowerCase();
  if (f.includes('qr')) return '二维码';
  if (f.includes('ean_13') || f.includes('ean13')) return '商品条形码 (EAN-13)';
  if (f.includes('ean_8') || f.includes('ean8')) return '商品条形码 (EAN-8)';
  if (f.includes('code_128') || f.includes('code128')) return '条形码 (Code 128)';
  if (f.includes('code_39') || f.includes('code39')) return '条形码 (Code 39)';
  if (f.includes('upc')) return '商品条形码 (UPC)';
  if (f.includes('data_matrix') || f.includes('datamatrix')) return 'Data Matrix 码';
  if (f.includes('itf')) return 'ITF 条形码';
  return '条形码 / 二维码';
}

export function formatCustomScanCodeSummary(customLabel?: string, token?: string): string {
  const raw = (customLabel || token || '').trim();
  if (!raw) return '已绑定生活码';
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0 && colonIdx < 16) {
    const formatPart = raw.slice(0, colonIdx).trim();
    const tokenPart = raw.slice(colonIdx + 1).trim();
    const friendlyType = formatBarcodeTypeLabel(formatPart);
    if (tokenPart.length > 20) {
      const tail = tokenPart.slice(-6);
      return `已绑定生活码（${friendlyType} · 尾号 ...${tail}）`;
    }
    return `已绑定生活码（${friendlyType} · ${tokenPart}）`;
  }
  if (raw.length > 24) {
    return `已绑定生活码（尾号 ...${raw.slice(-6)}）`;
  }
  return `已绑定生活码（${raw}）`;
}

export function renderAlarmRingtoneCard(onRingtoneChanged: () => void): HTMLElement {
  const currentRingtone = getAlarmRingtonePreference();
  const isPlaying = isRingtonePreviewPlaying();

  const card = el('div', { class: 'settings-ringtone-card mt-3' });
  const cardHeader = el('div', { class: 'settings-scan-card-header' });
  const badge = el('span', {
    class: 'chip-pill chip-pill-active',
    style: 'font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;',
    text: currentRingtone === 'morning_energy' ? '专属音乐（默认）' : '系统自带铃声',
  });
  const title = el('span', {
    style: 'font-size: 13px; font-weight: 600; color: var(--color-text);',
    text: '用药提醒铃声',
  });
  cardHeader.append(badge, title);

  const list = el('div', { class: 'settings-ringtone-list' });

  for (const option of ALARM_RINGTONE_OPTIONS) {
    const isSelected = currentRingtone === option.id;
    const item = el('label', {
      class: isSelected ? 'settings-ringtone-item active' : 'settings-ringtone-item',
    });

    const radio = el('input', {
      type: 'radio',
      name: 'settings-alarm-ringtone',
      value: option.id,
    }) as HTMLInputElement;
    radio.checked = isSelected;

    radio.onchange = async () => {
      stopRingtonePreview();
      await setAlarmRingtonePreference(option.id);
      toast(option.id === 'morning_energy' ? '已切换为晨间活力专属提醒音乐' : '已切换为手机系统默认闹钟铃声');
      onRingtoneChanged();
    };

    const copy = el('div', { class: 'settings-ringtone-copy' });
    const nameRow = el('div', { class: 'settings-ringtone-title-row' });
    nameRow.append(el('span', { class: 'settings-ringtone-name', text: option.name }));
    if (option.isDefault) {
      nameRow.append(
        el('span', {
          class: 'chip-pill',
          style: 'font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: rgba(23, 96, 63, 0.1); color: var(--color-primary, #17603f);',
          text: '推荐',
        }),
      );
    }

    copy.append(
      nameRow,
      el('span', { class: 'settings-ringtone-desc', text: option.desc }),
    );

    item.append(radio, copy);
    list.append(item);
  }

  const previewBtn = el('button', {
    class: 'btn tonal settings-ringtone-preview-btn',
    type: 'button',
  });

  const updatePreviewBtn = (playing: boolean) => {
    previewBtn.replaceChildren();
    if (playing) {
      previewBtn.append(icon('bell-ring'), el('span', { text: '停止试听专属铃声' }));
    } else {
      previewBtn.append(icon('bell'), el('span', { text: '试听专属提醒音乐（晨间活力）' }));
    }
  };
  updatePreviewBtn(isPlaying);

  previewBtn.onclick = () => {
    if (isRingtonePreviewPlaying()) {
      stopRingtonePreview();
      updatePreviewBtn(false);
    } else {
      const started = playRingtonePreview('morning_energy', () => {
        updatePreviewBtn(false);
      });
      if (started) {
        updatePreviewBtn(true);
      } else {
        toast('当前环境不支持播放试听音频');
      }
    }
  };

  card.append(cardHeader, list, previewBtn);
  return card;
}

export function buildReminderBody(body: HTMLElement, rerender: () => void): void {
  const native = isNativeReminderPlatform();
  if (!notificationsSupported()) {
    // 手机 App 和浏览器「收不到提醒」的原因完全不同，给同一句话等于两边都没说清。
    body.append(
      el('div', { class: 'banner warn' }, [
        el('span', {
          html: native
            ? '当前手机无法使用系统通知。请更新应用，并在系统设置中允许通知。'
            : '当前浏览器发不了用药提醒：需要 https 或本机地址打开并允许通知，iPhone 需先「添加到主屏幕」。建议装手机 App。',
        }),
      ])
    );
    return;
  }

  const appEnabled = isAppNotificationsEnabled();
  const basicCard = el('div', { class: 'settings-subcard' });
  const basicHeader = el('div', { class: 'settings-subcard-header' });
  const basicTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
    el('span', { class: 'settings-subcard-title', text: '用药提醒' }),
  ]);
  const basicBadge = el('span', {
    class: `chip-pill ${appEnabled ? 'chip-primary' : ''}`,
    text: appEnabled ? '运行中' : '已暂停',
  });
  basicHeader.append(basicTitleWrap, basicBadge);

  const toggleRow = el('label', {
    class: 'settings-toggle-row',
  });
  const toggleCopy = el('div', { class: 'settings-toggle-copy' });
  toggleCopy.append(
    el('div', { class: 'settings-toggle-title', text: '应用内用药提醒' }),
    el('div', {
      class: 'settings-toggle-desc',
      text: appEnabled ? '到点发通知并弹出全屏提醒' : '已暂停，到点不会提醒',
    }),
  );
  const toggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '应用内用药提醒',
  });
  toggle.checked = appEnabled;
  toggle.onchange = async () => {
    setAppNotificationsEnabled(toggle.checked);
    try {
      await rescheduleMedicationReminders();
    } catch {
      /* reschedule best-effort */
    }
    toast(toggle.checked ? '已开启应用内提醒' : '已暂停应用内提醒');
    rerender();
  };
  toggleRow.append(toggleCopy, toggle);
  basicCard.append(basicHeader, toggleRow);

  if (!appEnabled) {
    basicCard.append(
      el('div', { class: 'banner info' }, [
        el('span', { html: '提醒已暂停。' }),
      ]),
    );
    body.append(basicCard);
    return;
  }

  const perm = getPermission();
  const cls = perm === 'granted' ? 'ok' : perm === 'denied' ? 'warn' : 'info';
  const text = perm === 'granted'
    ? native
      ? '通知已开启，应用会按计划发送提醒。'
      : '通知已开启。这个页面开着的时候会准点提醒。'
    : perm === 'denied'
      ? '通知被拒绝。请到系统设置中允许通知。'
      : '通知未开启，开启后才能按时收到提醒。';
  basicCard.append(
    el('div', { class: 'banner ' + cls }, [el('span', { html: text })])
  );

  // 诚实降级：网页端做不到手机 App 那种「到点必响」
  if (perm === 'granted' && !native) {
    basicCard.append(
      el('div', { class: 'banner warn mt-3' }, [
        el('span', {
          html:
            '网页提醒不如手机 App 可靠：页面关掉之后可能晚几十分钟才到。每天要按时吃的药，建议装手机 App。',
        }),
      ]),
    );
  }

  if (perm !== 'granted') {
    const row = el('div', { class: 'btn-row mt-3' });
    const grantBtn = el('button', { class: 'btn', html: '开启系统通知' });
    grantBtn.onclick = async () => {
      const r = await requestPermission();
      if (r === 'granted') toast('已开启');
      else if (r === 'denied') toast('被拒绝，请在系统设置里开');
      else toast('未授权');
      rerender();
    };
    row.append(grantBtn);
    basicCard.append(row);
  }
  body.append(basicCard);

  if (perm === 'granted') {
    const testCard = el('div', { class: 'settings-subcard' });
    const testHeader = el('div', { class: 'settings-subcard-header' });
    const testTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
      el('span', { class: 'settings-subcard-title', text: '测试提醒' }),
    ]);
    testHeader.append(testTitleWrap);

    const isNativeAlarm = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
    const row = el('div', { class: isNativeAlarm ? 'settings-test-grid' : 'btn-row mt-3' });
    const testBtn = el('button', { class: 'btn tonal', html: '测试通知' });
    testBtn.onclick = async () => {
      const ok = await showNotification('测试提醒', {
        body: '看到这条说明当前通知通道可用',
        tag: 'medbox-test',
      });
      toast(ok ? '已发送测试通知' : '发送失败');
    };
    const tickBtn = el('button', { class: 'btn tonal', html: '检查到点' });
    tickBtn.onclick = async () => {
      await runReminderOnce();
      toast('已扫描一次到点任务');
    };
    row.append(testBtn, tickBtn);
    if (isNativeAlarm) {
      const strongTest = el('button', { class: 'btn tonal', html: '锁屏提醒' });
      strongTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('strong', { forceScanVerify: false });
          toast('已触发强提醒（如未弹出全屏页，请看通知栏/锁屏）');
        } catch {
          toast('触发失败');
        }
      };
      const fullTest = el('button', { class: 'btn tonal', html: '全屏提醒' });
      fullTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('strong', { forceScanVerify: false });
          toast('已触发全屏提醒');
        } catch {
          toast('触发失败，请先允许全屏权限');
        }
      };
      row.append(strongTest, fullTest);
    }
    testCard.append(testHeader, row);
    body.append(testCard);
  }

  if (perm === 'granted' && isNativeReminderPlatform()) {
    const exactAlarm = getExactAlarmCapability();
    const fullScreen = getFullScreenAlarmCapability();
    const overlay = getOverlayAlarmCapability();
    const hasOverlayIssue = overlay === 'denied';
    const hasFullScreenIssue = fullScreen === 'denied';
    const isFullyGranted = fullScreen === 'granted' && overlay !== 'denied';

    const permCard = el('div', { class: 'settings-subcard' });
    const permHeader = el('div', { class: 'settings-subcard-header' });
    const permTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
      el('span', { class: 'settings-subcard-title', text: '系统权限' }),
    ]);
    const permBadge = el('span', {
      class: `chip-pill ${isFullyGranted && exactAlarm === 'granted' ? 'chip-primary' : 'chip-warn'}`,
      text: isFullyGranted && exactAlarm === 'granted' ? '已就绪' : '待开启',
    });
    permHeader.append(permTitleWrap, permBadge);
    permCard.append(permHeader);

    if (exactAlarm !== 'granted') {
      const message = exactAlarm === 'unavailable'
        ? '无法确认精确闹钟，提醒可能晚几分钟。'
        : '未允许精确闹钟，提醒可能晚几分钟。';
      permCard.append(
        el('div', { class: 'banner warn' }, [
          el('span', { html: message }),
        ]),
      );
      if (exactAlarm !== 'unavailable') {
        const exactRow = el('div', { class: 'btn-row' });
        const exactButton = el('button', { class: 'btn tonal', html: '允许精确闹钟' });
        exactButton.onclick = async () => {
          const capability = await requestExactAlarmCapability();
          if (capability === 'granted') {
            await runReminderOnce();
            toast('精确闹钟已开启');
          } else {
            toast('未开启精确闹钟，将使用系统尽力调度');
          }
          rerender();
        };
        exactRow.append(exactButton);
        permCard.append(exactRow);
      }
    }

    if (isFullyGranted) {
      permCard.append(
        el('div', { class: 'banner ok' }, [
          el('span', {
            html: '到点会直接弹出全屏提醒。',
          }),
        ]),
      );
    } else {
      if (hasFullScreenIssue || fullScreen === 'unavailable') {
        permCard.append(
          el('div', { class: 'banner warn' }, [
            el('span', {
              html: fullScreen === 'denied'
                ? '未允许全屏提醒，到点只会出现在通知栏。'
                : '系统不支持全屏提醒，到点将在通知栏提醒。',
            }),
          ]),
        );
        if (hasFullScreenIssue) {
          const fullScreenRow = el('div', { class: 'btn-row' });
          const fullScreenButton = el('button', { class: 'btn tonal', html: '允许全屏提醒' });
          fullScreenButton.onclick = async () => {
            await requestFullScreenAlarmCapability();
            toast('已打开系统设置，返回后会自动检查');
          };
          fullScreenRow.append(fullScreenButton);
          permCard.append(fullScreenRow);
        }
      }

      if (hasOverlayIssue) {
        permCard.append(
          el('div', { class: 'banner warn' }, [
            el('span', {
              html: '未允许悬浮窗，玩手机时只会弹出顶部横幅。',
            }),
          ]),
        );
        const overlayRow = el('div', { class: 'btn-row' });
        const overlayButton = el('button', { class: 'btn tonal', html: '允许悬浮窗' });
        overlayButton.onclick = async () => {
          await requestOverlayAlarmCapability();
          toast('已打开悬浮窗设置，返回后会自动检查');
        };
        overlayRow.append(overlayButton);
        permCard.append(overlayRow);
      }
    }
    body.append(permCard);
    void refreshFullScreenAlarmCapability();
    void refreshOverlayAlarmCapability();
  }

  // ── 用药提醒铃声设置（专属音乐 vs 系统默认）──
  body.append(renderAlarmRingtoneCard(rerender));

  // ── 全屏提醒滑动解锁（防误触设置）──
  const isNativeAlarm = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
  const slideUnlockEnabled = isAlarmSlideUnlockEnabled();
  const slideRow = el('label', { class: 'settings-toggle-row mt-3' });
  const slideCopy = el('div', { class: 'settings-toggle-copy' });

  const slideTitleRow = el('div', {
    class: 'settings-toggle-title',
    style: 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;',
  });
  slideTitleRow.append(el('span', { text: '滑动解锁' }));
  if (!isNativeAlarm) {
    slideTitleRow.append(
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: rgba(0, 0, 0, 0.06); color: var(--color-text-muted);',
        text: '仅 Android App 生效',
      }),
    );
  }

  const slideDescText = '防止在口袋里误触关掉提醒';

  slideCopy.append(
    slideTitleRow,
    el('div', { class: 'settings-toggle-desc', text: slideDescText }),
  );
  const slideToggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '全屏提醒滑动解锁',
  });
  slideToggle.checked = slideUnlockEnabled;
  slideToggle.onchange = async () => {
    setAlarmSlideUnlockEnabled(slideToggle.checked);
    toast(slideToggle.checked ? '已开启全屏滑动解锁防误触' : '已关闭滑动解锁，到点直接显示按钮');
    await rescheduleMedicationReminders().catch(() => {});
    rerender();
  };
  slideRow.append(slideCopy, slideToggle);

  // 滑动解锁：开关行 + 一个测试按钮，不再附带说明卡片
  const slideCard = el('div', { class: 'settings-scan-card mt-2' });

  const needsApkUpgrade = isNativeAlarm && LOCAL_APP_VERSION_CODE > 0 && LOCAL_APP_VERSION_CODE < 56;
  if (needsApkUpgrade) {
    const upgradeNotice = el('div', {
      class: 'settings-scan-card-desc mt-1',
      style: 'color: #b45309; background: rgba(245, 158, 11, 0.1); padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5;',
      text: '需在「应用更新」里安装一次完整包才能生效。',
    });
    slideCard.append(upgradeNotice);
  }

  const slideCardGrid = el('div', { class: 'settings-scan-grid' });
  const testSlideBtn = el('button', {
    class: 'btn tonal',
    text: '试一下',
  });
  testSlideBtn.onclick = async () => {
    if (!isNativeAlarm) {
      toast('全屏闹钟滑动解锁需在 Android App 中体验');
      return;
    }
    if (needsApkUpgrade) {
      toast('当前底层安装包版本未包含滑动解锁，请前往「软件更新」安装完整 APK');
      return;
    }
    try {
      await fireNativeMedicationAlarmNow('strong', { forceScanVerify: false, slideUnlock: true });
      toast('已触发全屏提醒，请体验向右滑动解锁');
    } catch {
      toast('触发失败，请先允许全屏权限');
    }
  };
  slideCardGrid.append(testSlideBtn);
  slideCard.append(slideRow, slideCardGrid);
  body.append(slideCard);

  // ── 扫码解除强制提醒（全屏响铃仅 Android 原生生效，配置与绑定全局常驻）──
  const scanPref = getAlarmScanVerifyPreference();
  const scanRow = el('label', { class: 'settings-toggle-row mt-3' });
  const scanCopy = el('div', { class: 'settings-toggle-copy' });
  const isCustom = scanPref.mode === 'custom';

  const titleRow = el('div', {
    class: 'settings-toggle-title',
    style: 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;',
  });
  titleRow.append(el('span', { text: '扫码关闭提醒' }));
  if (!isNativeAlarm) {
    titleRow.append(
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: rgba(0, 0, 0, 0.06); color: var(--color-text-muted);',
        text: '仅 Android App 生效',
      }),
    );
  }

  // 副标题只说「扫什么」；开关本身已表示开 / 关
  const descText = isCustom
    ? formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)
    : '起身扫码才能关掉，防止睡迷糊随手关';

  scanCopy.append(
    titleRow,
    el('div', { class: 'settings-toggle-desc', text: descText }),
  );
  const scanToggle = el('input', {
    type: 'checkbox',
    role: 'switch',
    'aria-label': '扫码解除强制提醒',
  });
  scanToggle.onchange = async () => {
    if (scanToggle.checked) {
      if (scanPref.mode === 'custom' && scanPref.token) {
        enableAlarmScanVerify('custom');
        toast('已开启扫码验证（已绑定生活码）');
        await rescheduleMedicationReminders().catch(() => {});
        if (isNativeAlarm) {
          void Promise.all([
            checkAccessibilityGuardEnabled().catch(() => false),
            isIgnoringBatteryOptimizations().catch(() => false),
          ]).then(([accEnabled, ignoring]) => {
            if (!accEnabled || !ignoring) {
              openKeepAlivePromptSheet(rerender, { accEnabled, ignoring });
            }
          });
        }
      } else {
        enableAlarmScanVerify('generated');
        toast('已开启，请查看专属二维码或扫描已有码绑定');
        openUnlockQrSheet(rerender, true);
      }
    } else {
      disableAlarmScanVerify();
      toast('已关闭扫码验证');
      await rescheduleMedicationReminders().catch(() => {});
    }
    rerender();
  };
  scanRow.append(scanCopy, scanToggle);

  // ── 绑定操作按钮常驻（无论开关开闭均可见）──
  const scanCard = el('div', { class: 'settings-scan-card mt-2' });
  scanCard.append(scanRow);

  // 操作按钮网格（双列排列，保证移动端自适应舒展）
  const qrGrid = el('div', { class: 'settings-scan-grid mt-2' });
  const testUnlockBtn = el('button', { class: 'btn tonal', html: '试验扫码解锁' });
  testUnlockBtn.onclick = async () => {
    if (!isNativeAlarm) {
      toast('全屏闹钟扫码解锁需在 Android App 中体验');
      return;
    }
    if (!scanPref.enabled) {
      toast('请先开启上方「扫码解除强制提醒」开关');
      return;
    }
    try {
      await fireNativeMedicationAlarmNow('strong', { forceScanVerify: true });
      toast('已触发全屏提醒，请体验扫码解锁');
    } catch {
      toast('触发失败，请先允许全屏权限');
    }
  };

  if (isCustom) {
    const rebindBtn = el('button', { class: 'btn tonal', html: '重新扫码绑定' });
    rebindBtn.onclick = () => openBindCustomCodeSheet(rerender);
    const switchQrBtn = el('button', { class: 'btn tonal', html: '切换为专属二维码' });
    switchQrBtn.onclick = () => {
      openUnlockQrSheet(rerender, true);
      toast('已切换为专属二维码并开启');
    };
    qrGrid.append(rebindBtn, switchQrBtn, testUnlockBtn);
  } else {
    const showQrBtn = el('button', { class: 'btn tonal', html: '查看专属二维码' });
    showQrBtn.onclick = () => openUnlockQrSheet(rerender, scanPref.enabled);
    const bindCustomBtn = el('button', { class: 'btn tonal', html: '扫描生活中的码绑定' });
    bindCustomBtn.onclick = () => openBindCustomCodeSheet(rerender);
    qrGrid.append(showQrBtn, bindCustomBtn, testUnlockBtn);
  }
  scanCard.append(qrGrid);
  body.append(scanCard);

  if (isNativeAlarm) {
    const accCard = el('div', {
      class: 'settings-scan-card mt-2',
      style: 'background: rgba(0, 0, 0, 0.02); border: 1px dashed var(--color-border);',
    });
    const accHeader = el('div', { class: 'settings-scan-card-header flex items-center justify-between' });
    const accTitle = el('span', {
      style: 'font-size: 13px; font-weight: 600; color: var(--color-text);',
      text: '无障碍防退出保护',
    });
    const accBadge = el('span', {
      class: 'chip-pill',
      style: 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.05); color: var(--color-text-muted);',
      text: '检测中...',
    });
    accHeader.append(accTitle, accBadge);

    const accDesc = el('div', {
      class: 'settings-scan-card-desc mt-1',
      text: '扫码前防止切回桌面。',
    });

    const accActionBtn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 12px; padding: 6px 12px; width: 100%;',
      text: '去开启',
    });
    accActionBtn.onclick = async () => {
      await openAccessibilityGuardSettings();
    };

    const accGuideBtn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 12px; padding: 6px 12px; width: 100%;',
      text: '主流手机后台防杀指南',
    });
    accGuideBtn.onclick = () => openKeepAliveGuideModal();

    accCard.append(accHeader, accDesc, accActionBtn, accGuideBtn);
    body.append(accCard);

    void checkAccessibilityGuardEnabled().then((enabled) => {
      if (enabled) {
        accBadge.className = 'chip-pill chip-pill-active';
        accBadge.style.background = 'rgba(23, 96, 63, 0.12)';
        accBadge.style.color = 'var(--color-primary, #17603f)';
        accBadge.textContent = '已开启';
        accActionBtn.textContent = '管理';
      } else {
        accBadge.className = 'chip-pill';
        accBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        accBadge.style.color = '#b45309';
        accBadge.textContent = '未开启';
        accActionBtn.textContent = '去开启';
      }
    });
  }

  body.append(
    el('div', {
      class: 'settings-hint',
      text: native
        ? '收不到提醒时，请在「后台保活与防杀」里允许后台运行。'
        : '网页端不支持锁屏全屏提醒；把网页「添加到主屏幕」会更准时。',
    })
  );
}

/** ---------------- 扫码解除：专属二维码 Sheet ---------------- */
export function openUnlockQrSheet(rerender: () => void, activate: boolean = true): void {
  const tokenValue = activate
    ? enableAlarmScanVerify('generated')
    : getOrCreateGeneratedScanToken();
  void rescheduleMedicationReminders().catch(() => {});
  const title = el('h3', { class: 'lan-sync-sheet-title', text: '强制提醒专属二维码' });
  const canvas = document.createElement('canvas');
  canvas.className = 'lan-sync-qr';
  canvas.setAttribute('aria-label', '强制提醒解锁二维码');
  void QRCode.toCanvas(canvas, tokenValue, {
    width: 320,
    margin: 4,
    errorCorrectionLevel: 'M',
    color: { dark: '#151918', light: '#ffffff' },
  });
  const hint = el('div', { class: 'settings-hint' });
  const hintP1 = el('p', { class: 'mb-1' });
  hintP1.append(
    '把这个专属二维码',
    el('strong', { text: '截图保存并打印' }),
    '，贴到药箱、冰箱门或远离床的位置。全屏用药提醒必须扫描此码才能解锁操作。',
  );
  const hintP2 = el('p', { class: 'muted text-xs mt-2' });
  hintP2.append(
    icon('info'),
    ' ',
    el('strong', { text: '没有打印机？' }),
    '您也可以直接点击下方按钮，绑定药盒或生活物品上的已有条码/二维码。',
  );
  hint.append(hintP1, hintP2);
  const rotateBtn = el('button', { class: 'btn tonal', html: '重新生成' });
  rotateBtn.onclick = async () => {
    const confirmed = await confirmDialog(
      '重新生成解锁码？旧二维码将立即作废；已贴出去的打印件需要替换，否则将无法解除提醒。',
      '重新生成',
      true,
    );
    if (!confirmed) return;
    rotateAlarmScanToken();
    toast('已生成新的专属码并开启');
    sheet.close();
    rerender();
    openUnlockQrSheet(rerender, true);
  };
  const switchCustomBtn = el('button', { class: 'btn tonal', html: '改为扫描生活中的码' });
  switchCustomBtn.onclick = () => {
    sheet.close();
    openBindCustomCodeSheet(rerender);
  };
  const closeBtn = el('button', { class: 'btn', html: '完成' });
  let sheet!: ReturnType<typeof openBottomSheet>;
  closeBtn.onclick = () => {
    sheet.close();
    if (isNativeReminderPlatform() && nativeMedicationAlarmAvailable()) {
      void Promise.all([
        checkAccessibilityGuardEnabled().catch(() => false),
        isIgnoringBatteryOptimizations().catch(() => false),
      ]).then(([accEnabled, ignoring]) => {
        if (!accEnabled || !ignoring) {
          openKeepAlivePromptSheet(rerender, { accEnabled, ignoring });
        }
      });
    }
  };
  sheet = openBottomSheet({
    label: '强制提醒专属二维码',
    content: [title, canvas, hint, el('div', { class: 'btn-row mt-3' }, [rotateBtn, switchCustomBtn, closeBtn])],
    initialFocus: closeBtn,
  });
}

/** ---------------- 扫码解除：扫描生活中的已有码绑定 Sheet ---------------- */
export function openBindCustomCodeSheet(rerender: () => void): void {
  const title = el('h3', { class: 'lan-sync-sheet-title', text: '扫描生活中的已有码绑定' });
  const hint = el('div', { class: 'settings-hint' });
  const hintP1 = el('p', { class: 'mb-1' });
  hintP1.append(
    '将镜头对准药盒包装上的',
    el('strong', { text: '条形码' }),
    '（如常见药盒 EAN-13 条码）或',
    el('strong', { text: '生活中的任意二维码' }),
    '。',
  );
  const hintP2 = el('p', { class: 'muted text-xs' });
  hintP2.textContent = '绑定后，闹钟提醒响起时只需扫描该码即可解除，无需打印。';
  hint.append(hintP1, hintP2);

  const scannerContainerId = `custom-unlock-scanner-${Date.now()}`;
  const scannerHost = el('div', {
    id: scannerContainerId,
    style: 'width: 100%; min-height: 240px; background: #000; border-radius: 16px; overflow: hidden; position: relative;',
  });

  const statusBox = el('div', { class: 'banner info mt-3', hidden: true });
  const actionRow = el('div', { class: 'btn-row mt-3' });
  const cancelBtn = el('button', { class: 'btn tonal', html: '取消' });
  const fileLabel = el('label', { class: 'btn tonal' });
  fileLabel.append(el('span', { text: '相册选图' }));
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display: none;' }) as HTMLInputElement;
  fileLabel.append(fileInput);

  actionRow.append(fileLabel, cancelBtn);

  let scanner: Scanner | null = null;
  let scannedCode: string | null = null;
  let scannedFormat: string | null = null;

  const scrollToSheetTop = () => {
    sheet.overlay.querySelector<HTMLElement>('.bottom-sheet')?.scrollTo({ top: 0 });
  };

  const handleResult = (raw: string, format: string) => {
    scannedCode = raw.trim();
    scannedFormat = format;
    // 识别成功即收起相机预览（结果门控已暂停相机）：结果与确认按钮直接落入视口，无需上滑。
    scannerHost.hidden = true;
    void scanner?.pause().catch(() => {});
    statusBox.hidden = false;
    statusBox.className = 'banner ok mt-3';
    statusBox.replaceChildren();

    const resultHead = el('div', {
      style: 'font-weight: 600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;',
    });
    resultHead.append(
      '已识别到：',
      el('span', {
        class: 'chip-pill chip-pill-active',
        style: 'font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 999px;',
        text: formatBarcodeTypeLabel(format),
      }),
    );

    const codePreview = el('div', {
      class: 'code-preview mt-2',
      style: 'font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; line-height: 1.4; word-break: break-all; background: rgba(0, 0, 0, 0.05); padding: 8px 10px; border-radius: 8px; max-height: 72px; overflow-y: auto;',
      text: scannedCode,
    });

    const confirmPrompt = el('div', {
      class: 'muted text-xs mt-2',
      text: '确认将该码绑定为提醒解除条件？',
    });

    statusBox.append(resultHead, codePreview, confirmPrompt);

    actionRow.replaceChildren();
    const confirmBtn = el('button', { class: 'btn', html: '确认绑定' });
    confirmBtn.onclick = async () => {
      if (!scannedCode) return;
      bindCustomAlarmScanCode(scannedCode, scannedFormat || undefined);
      toast('已成功绑定并开启！闹钟提醒时扫此码即可解除', 3200);
      await rescheduleMedicationReminders().catch(() => {});
      sheet.close();
      rerender();
      if (isNativeReminderPlatform() && nativeMedicationAlarmAvailable()) {
        void Promise.all([
          checkAccessibilityGuardEnabled().catch(() => false),
          isIgnoringBatteryOptimizations().catch(() => false),
        ]).then(([accEnabled, ignoring]) => {
          if (!accEnabled || !ignoring) {
            openKeepAlivePromptSheet(rerender, { accEnabled, ignoring });
          }
        });
      }
    };

    const rescanBtn = el('button', { class: 'btn tonal', html: '重新扫码' });
    rescanBtn.onclick = () => {
      scannedCode = null;
      statusBox.hidden = true;
      scannerHost.hidden = false;
      actionRow.replaceChildren(fileLabel, cancelBtn);
      void scanner?.resume();
      scrollToSheetTop();
    };

    actionRow.append(confirmBtn, rescanBtn);
    scrollToSheetTop();
  };

  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const res = await scanCodeFromImage(file);
      if (res && res.raw) {
        handleResult(res.raw, res.format);
      } else {
        toast('图片中未能识别到有效的条码或二维码，请重试');
      }
    } catch {
      toast('读取图片失败');
    }
  };

  let sheet!: ReturnType<typeof openBottomSheet>;
  let isClosed = false;
  sheet = openBottomSheet({
    label: '扫描生活中的已有码绑定',
    content: [title, hint, scannerHost, statusBox, actionRow],
    initialFocus: cancelBtn,
    onClose: () => {
      isClosed = true;
      void scanner?.stop().catch(() => {});
    },
  });

  cancelBtn.onclick = () => {
    sheet.close();
  };

  setTimeout(() => {
    if (isClosed) return;
    void startScan({
      containerId: scannerContainerId,
      onScan: (res) => {
        if (!isClosed) handleResult(res.raw, res.format);
      },
      onError: (msg) => {
        if (isClosed) return;
        statusBox.hidden = false;
        statusBox.className = 'banner warn mt-3';
        statusBox.textContent = `相机提示：${msg}`;
      },
    }).then((s) => {
      if (isClosed) {
        void s.stop().catch(() => {});
        return;
      }
      scanner = s;
    }).catch(() => {
      if (isClosed) return;
      statusBox.hidden = false;
      statusBox.className = 'banner warn mt-3';
      statusBox.textContent = '无法启动相机，您也可以点击下方从相册选图识别。';
    });
  }, 100);
}

/** ---------------- 时段提醒设置面板：按时段聚合的整体提醒 ---------------- */
export function periodSettingsChip(settings: ReminderPeriodSetting[]): PanelChip {
  if (settings.some((s) => s.state === 'needs-review')) return { text: '待复核', tone: 'warn' };
  if (settings.some((s) => s.state === 'active')) return { text: '已设置', tone: 'ok' };
  return { text: '未设置', tone: 'muted' };
}

export function renderPeriodSettingsPanel(): HTMLElement {
  let panelEl!: HTMLElement;
  panelEl = panel({
    title: '时段提醒设置',
    iconName: 'clock',
    iconTone: 'emerald',
    chip: { text: '…', tone: 'muted' },
    renderBody: (body) => {
      // 延迟到 panel() 返回后再执行，避免在 panelEl 赋值前引用（TDZ）
      queueMicrotask(() => void renderPeriodSettingsBody(body, panelEl));
    },
  });
  return panelEl;
}

export async function renderPeriodSettingsBody(body: HTMLElement, panelEl: HTMLElement): Promise<void> {
  let settings: ReminderPeriodSetting[];
  try {
    settings = await listReminderPeriodSettings();
  } catch {
    body.replaceChildren();
    body.append(el('div', { class: 'banner warn' }, [
      el('span', { html: '时段提醒设置读取失败，请稍后重试。' }),
    ]));
    return;
  }
  setChip(panelEl, periodSettingsChip(settings));
  body.replaceChildren();
  body.append(el('div', {
    class: 'settings-hint',
    html: '同一时段的药合并成一次提醒，点卡片可调整时间和方式。',
  }));

  const needsReview = settings.filter((s) => s.state === 'needs-review');
  if (needsReview.length > 0) {
    body.append(el('div', { class: 'banner warn mt-3' }, [
      el('span', {
        html: `以下时段内不同药的提醒时间或方式不完全一致：${needsReview.map((s) => s.name || SLOT_LABEL[s.slot] || s.slot).join('、')}。请逐个确认统一的整体时间与方式。`,
      }),
    ]));
  }

  const list = el('div', { class: 'period-setting-list mt-3' });
  for (const setting of settings) {
    list.append(buildPeriodSettingRow(setting, body, panelEl));
  }
  body.append(list);

  // 添加自定义提醒时段按钮
  const addSlotBtn = el('button', {
    class: 'period-add-slot-btn',
    type: 'button',
  });
  addSlotBtn.append(icon('plus'), document.createTextNode('添加提醒时段'));
  addSlotBtn.onclick = () => {
    openAddPeriodModal(body, panelEl);
  };
  body.append(addSlotBtn);

}

/** 打开添加自定义时段弹层 */
function openAddPeriodModal(body: HTMLElement, panelEl: HTMLElement): void {
  let sheet!: ReturnType<typeof openBottomSheet>;
  const content = el('div', { class: 'settings-sheet-content' });
  content.append(el('h3', { class: 'settings-sheet-title', text: '添加提醒时段' }));
  content.append(el('p', { class: 'settings-sheet-desc', text: '自定义一个新的用药时段，用于管理特定时间的服药与提醒。' }));

  const nameIn = el('input', {
    type: 'text',
    placeholder: '例如：下午、夜间、加餐',
  }) as HTMLInputElement;
  nameIn.maxLength = 10;

  const timeControl = createTimeControl({ value: '15:00', ariaLabel: '首选提醒时间' });
  const timeIn = timeControl.input;

  content.append(
    field('时段名称', nameIn),
    field('首选提醒时间', timeControl.root),
  );

  const btnRow = el('div', { class: 'btn-row mt-4' });
  const cancelBtn = el('button', { class: 'btn text', type: 'button', text: '取消' });
  cancelBtn.onclick = () => sheet.close();

  const confirmBtn = el('button', { class: 'btn primary', type: 'button', text: '确认添加' });
  confirmBtn.onclick = async () => {
    const name = nameIn.value.trim();
    if (!name) {
      toast('请输入时段名称');
      return;
    }
    const time = timeIn.value || '15:00';
    const customSlot = `custom_${Date.now()}` as Slot;
    try {
      await updateReminderPeriodSetting(customSlot, {
        name,
        timeLocal: time,
        enabled: true,
        isCustom: true,
        mode: 'strong',
      });
      await rescheduleMedicationReminders();
      toast(`已添加「${name}」时段提醒`);
      sheet.close();
      void renderPeriodSettingsBody(body, panelEl);
    } catch (err) {
      toast('添加失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  btnRow.append(cancelBtn, confirmBtn);
  content.append(btnRow);

  sheet = openBottomSheet({
    label: '添加提醒时段',
    content,
  });
}

export function buildPeriodSettingRow(
  setting: ReminderPeriodSetting,
  body: HTMLElement,
  panelEl: HTMLElement,
): HTMLElement {
  const isEnabled = setting.enabled !== false;
  const displayName = setting.name || SLOT_LABEL[setting.slot] || setting.slot;
  const isReview = setting.state === 'needs-review';

  const card = el('div', {
    class: `period-setting-card${isEnabled ? '' : ' is-disabled'}${isReview ? ' needs-review' : ''}`,
  });

  // 主体点击区（跳转二级编辑）
  const mainBtn = el('button', {
    class: 'period-setting-card-main',
    type: 'button',
    'aria-label': `编辑${displayName}时段设置`,
  });

  // 左侧五彩图标
  const iconWrap = el('div', {
    class: `period-setting-icon-badge ${['morning', 'noon', 'evening', 'bedtime'].includes(setting.slot) ? setting.slot : 'custom'}`,
  });
  const iconName = setting.slot === 'morning' ? 'sun'
    : setting.slot === 'noon' ? 'sun-high'
    : setting.slot === 'evening' ? 'sunset'
    : setting.slot === 'bedtime' ? 'moon'
    : 'clock';
  iconWrap.append(icon(iconName as any));

  // 中间文字
  const content = el('div', { class: 'period-setting-card-content' });
  const titleRow = el('div', { class: 'period-setting-card-title-row' });
  titleRow.append(el('span', { class: 'period-setting-card-name', text: displayName }));
  if (isReview) {
    titleRow.append(el('span', { class: 'panel-chip tone-warn period-review-badge', text: '待复核' }));
  }
  if (!isEnabled) {
    titleRow.append(el('span', { class: 'panel-chip tone-muted', text: '已停用' }));
  }

  // 提醒时间与多时间点指示
  const extraCount = setting.extraTimes ? setting.extraTimes.length : 0;
  const timeRow = el('div', { class: 'period-setting-time-badge' });
  timeRow.append(document.createTextNode(setting.timeLocal));
  if (extraCount > 0) {
    timeRow.append(el('span', { class: 'period-setting-extra-count', text: `+${extraCount}个时间` }));
  }

  const meta = [MEDICATION_REMINDER_MODE_LABEL[setting.mode]];
  if (setting.escalate.repeatEveryMin > 0) meta.push(`每 ${setting.escalate.repeatEveryMin} 分钟重推`);
  const desc = el('div', { class: 'period-setting-meta-text', text: meta.join(' · ') });

  content.append(titleRow, timeRow, desc);
  mainBtn.append(iconWrap, content);
  mainBtn.onclick = () => void renderPeriodEditor(body, setting, panelEl);

  // 右侧操作区：独立滑动开关 + 箭头
  const actions = el('div', { class: 'period-setting-card-actions' });
  const toggleSwitch = el('button', {
    class: 'period-switch',
    type: 'button',
    role: 'switch',
    'aria-label': `${isEnabled ? '关闭' : '开启'}${displayName}时段提醒`,
    'aria-checked': String(isEnabled),
  });
  toggleSwitch.append(el('span', { class: 'period-switch-thumb' }));
  toggleSwitch.onclick = async (e) => {
    e.stopPropagation();
    const nextState = !isEnabled;
    toggleSwitch.setAttribute('aria-checked', String(nextState));
    try {
      await updateReminderPeriodSetting(setting.slot, { enabled: nextState });
      await rescheduleMedicationReminders();
      toast(`${displayName}时段提醒已${nextState ? '开启' : '关闭'}`);
      void renderPeriodSettingsBody(body, panelEl);
    } catch (err) {
      toast('操作失败：' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const chevron = el('span', { class: 'panel-chevron' });
  chevron.append(icon('chevron-right'));

  // 自定义时段直接在列表上可删除；内置四个时段只能停用
  const isCustom = setting.isCustom || !['morning', 'noon', 'evening', 'bedtime'].includes(setting.slot);
  if (isCustom) {
    const deleteBtn = el('button', {
      class: 'period-card-delete-btn',
      type: 'button',
      'aria-label': `删除${displayName}时段`,
    });
    deleteBtn.append(icon('trash'));
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      const confirmed = await confirmDialog(`确定要删除「${displayName}」时段吗？删除后该时段的提醒将不再响铃。`, '确认删除', true);
      if (!confirmed) return;
      try {
        await deleteReminderPeriodSetting(setting.slot);
        await rescheduleMedicationReminders();
        toast(`已删除「${displayName}」时段`);
        void renderPeriodSettingsBody(body, panelEl);
      } catch (err) {
        toast('删除失败：' + (err instanceof Error ? err.message : String(err)));
      }
    };
    actions.append(deleteBtn);
  }

  actions.append(toggleSwitch, chevron);
  card.append(mainBtn, actions);
  return card;
}

/** 时段编辑器：单列卡片式全屏提醒选择 + 多时间点添加/删除 + 自定义时段删除 */
export async function renderPeriodEditor(
  body: HTMLElement,
  setting: ReminderPeriodSetting,
  panelEl: HTMLElement,
): Promise<void> {
  let latest: ReminderPeriodSetting;
  try {
    latest = await getReminderPeriodSetting(setting.slot);
  } catch {
    toast('时段设置读取失败，请重试');
    return;
  }
  body.replaceChildren();

  const displayName = latest.name || SLOT_LABEL[latest.slot] || latest.slot;

  const outerBody = body;
  const head = el('div', { class: 'period-editor-head' });
  const back = el('button', { class: 'btn text small', type: 'button', 'aria-label': '返回时段列表' });
  back.append(icon('chevron-left'), document.createTextNode('时段列表'));
  back.onclick = () => void renderPeriodSettingsBody(outerBody, panelEl);
  head.append(back);
  outerBody.append(head);
  outerBody.append(el('h3', { class: 'period-editor-title', text: `${displayName}时段整体提醒` }));
  // 编辑器内容放在独立容器里，统一纵向间距，不再逐个 mt-3
  body = el('div', { class: 'period-editor-body' });
  outerBody.append(body);

  if (latest.state === 'needs-review') {
    body.append(el('div', { class: 'banner warn' }, [
      el('span', {
        html: '该时段内不同药的提醒时间或方式不完全一致，当前按下面的统一设置发送整体提醒。确认后复核标记自动消除；每种药自己的精确时间仍保留，仅用于记录与库存归因。',
      }),
    ]));
  }

  // 1. 时段名称（仅自定义时段允许修改名称）
  let nameIn: HTMLInputElement | null = null;
  if (latest.isCustom || !['morning', 'noon', 'evening', 'bedtime'].includes(latest.slot)) {
    nameIn = el('input', { type: 'text', value: displayName }) as HTMLInputElement;
    nameIn.maxLength = 10;
    body.append(field('时段名称', nameIn));
  }

  // 2. 多时间点增删容器
  let timesList = [latest.timeLocal, ...(latest.extraTimes ?? [])].filter(Boolean);
  if (timesList.length === 0) timesList = ['08:00'];

  const timesContainer = el('div', { class: 'period-times-container' });

  function renderTimesInputs(): void {
    timesContainer.replaceChildren();
    timesList.forEach((t, idx) => {
      const row = el('div', { class: 'period-time-row' });
      const timeControl = createTimeControl({ value: t, ariaLabel: `提醒时间 ${idx + 1}` });
      timeControl.input.addEventListener('change', () => {
        timesList[idx] = timeControl.input.value;
      });
      row.append(timeControl.root);

      // 允许删除多余的时间点（至少保留 1 个）
      if (timesList.length > 1) {
        const delBtn = el('button', {
          class: 'period-time-delete-btn icon-btn',
          type: 'button',
          'aria-label': `删除时间 ${t}`,
        });
        delBtn.append(icon('trash'));
        delBtn.onclick = () => {
          timesList.splice(idx, 1);
          renderTimesInputs();
        };
        row.append(delBtn);
      }
      timesContainer.append(row);
    });

    const addTimeBtn = el('button', {
      class: 'period-time-add-btn',
      type: 'button',
    });
    addTimeBtn.append(icon('plus'), document.createTextNode('添加提醒时间'));
    addTimeBtn.onclick = () => {
      // 默认比最后一个时间晚 30 分钟或当前时间
      timesList.push('08:30');
      renderTimesInputs();
    };
    timesContainer.append(addTimeBtn);
  }

  renderTimesInputs();
  body.append(field('提醒时间点（支持多个）', timesContainer));

  // 3. 单列卡片式提醒方式选项（消除断行排版错乱）
  const modeCardsWrap = el('div', {
    class: 'period-mode-cards',
    role: 'radiogroup',
    'aria-label': '提醒方式',
  });

  let selectedMode: MedicationReminderMode = latest.mode;

  const modeOptionsConfig: Array<{
    mode: MedicationReminderMode;
    title: string;
    desc: string;
    isRecommend?: boolean;
  }> = [
    {
      mode: 'strong',
      title: '持续全屏提醒',
      desc: '全屏覆盖并持续响铃，直到您手动处理，防漏服最可靠。',
      isRecommend: true,
    },
    {
      mode: 'fullscreen-short',
      title: '10 秒全屏提醒',
      desc: '全屏响铃展示 10 秒后，自动转为系统常驻静默通知。',
    },
    {
      mode: 'fullscreen-persistent',
      title: '60 秒全屏提醒',
      desc: '全屏响铃展示 60 秒后，自动转为系统常驻静默通知。',
    },
  ];

  for (const item of modeOptionsConfig) {
    const isSelected = item.mode === selectedMode;
    const card = el('button', {
      class: `period-mode-card${isSelected ? ' is-selected' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(isSelected),
    });

    const contentWrap = el('div', { class: 'period-mode-card-content' });
    const headerRow = el('div', { class: 'period-mode-card-header' });
    headerRow.append(el('span', { class: 'period-mode-card-title', text: item.title }));
    if (item.isRecommend) {
      headerRow.append(el('span', { class: 'period-mode-card-tag', text: '推荐' }));
    }
    const descText = el('span', { class: 'period-mode-card-desc', text: item.desc });
    contentWrap.append(headerRow, descText);

    const checkIcon = el('span', { class: 'period-mode-card-check' });
    checkIcon.append(icon('check'));

    card.append(contentWrap, checkIcon);
    card.onclick = () => {
      selectedMode = item.mode;
      for (const c of modeCardsWrap.querySelectorAll('.period-mode-card')) {
        const sel = c === card;
        c.classList.toggle('is-selected', sel);
        c.setAttribute('aria-checked', String(sel));
      }
    };
    modeCardsWrap.append(card);
  }

  body.append(field('提醒方式', modeCardsWrap));

  // 4. 重复策略字段
  const repeatStepper = createStepper({
    value: latest.escalate.repeatEveryMin, min: 1, max: Math.max(120, latest.escalate.repeatEveryMin), unit: '分钟', ariaLabel: '再提醒间隔',
  });
  const maxRepeatsStepper = createStepper({
    value: latest.escalate.maxRepeats, min: 0, max: Math.max(20, latest.escalate.maxRepeats), unit: '次', ariaLabel: '最多重推次数',
  });
  const caregiverStepper = createStepper({
    value: latest.escalate.notifyCaregiverAfterMin, min: 0, max: Math.max(720, latest.escalate.notifyCaregiverAfterMin), step: 5, unit: '分钟', ariaLabel: '通知照护者等待时间',
  });
  const repeatIn = repeatStepper.input;
  const maxRepeatsIn = maxRepeatsStepper.input;
  const caregiverIn = caregiverStepper.input;

  body.append(
    field('未确认时每几分钟再提醒', repeatStepper.root),
    field('最多重推次数（不含首次）', maxRepeatsStepper.root),
    field('超过几分钟通知照护者（0 = 不通知）', caregiverStepper.root),
  );

  // 5. 底部操作按钮行
  const btnRow = el('div', { class: 'btn-row' });
  const saveBtn = el('button', { class: 'btn primary', html: '保存设置' });
  saveBtn.onclick = async () => {
    if (saveBtn.hasAttribute('disabled')) return;
    saveBtn.setAttribute('disabled', 'true');

    const primaryTime = timesList[0] || '08:00';
    const extraTimes = timesList.slice(1);
    const updatedName = nameIn ? nameIn.value.trim() : latest.name;

    try {
      await updateReminderPeriodSetting(latest.slot, {
        name: updatedName,
        timeLocal: primaryTime,
        extraTimes: extraTimes,
        mode: selectedMode,
        escalate: {
          repeatEveryMin: Math.max(1, Math.floor(Number(repeatIn.value) || 1)),
          maxRepeats: Math.max(0, Math.floor(Number(maxRepeatsIn.value) || 0)),
          notifyCaregiverAfterMin: Math.max(0, Math.floor(Number(caregiverIn.value) || 0)),
        },
      });
      await rescheduleMedicationReminders();
      toast(`${updatedName || displayName}时段设置已保存，闹钟已重建`);
      void renderPeriodSettingsBody(outerBody, panelEl);
    } catch (error) {
      saveBtn.removeAttribute('disabled');
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
    }
  };
  btnRow.append(saveBtn);

  // 自定义时段提供删除按钮
  if (latest.isCustom || !['morning', 'noon', 'evening', 'bedtime'].includes(latest.slot)) {
    const deleteBtn = el('button', { class: 'btn danger', type: 'button', html: '删除该时段' });
    deleteBtn.onclick = async () => {
      const confirmed = await confirmDialog(`确定要删除「${displayName}」时段吗？删除后该时段内的提醒将被移除。`, '确认删除', true);
      if (!confirmed) return;
      try {
        await deleteReminderPeriodSetting(latest.slot);
        await rescheduleMedicationReminders();
        toast(`已删除「${displayName}」时段`);
        void renderPeriodSettingsBody(outerBody, panelEl);
      } catch (err) {
        toast('删除失败：' + (err instanceof Error ? err.message : String(err)));
      }
    };
    btnRow.append(deleteBtn);
  }

  body.append(btnRow);
}
