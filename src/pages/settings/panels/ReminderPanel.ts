import { el, toast, icon, field, confirmDialog } from '../../../ui/components';
import { openBottomSheet } from '../../../ui/primitives/BottomSheet';
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
  hasAlarmScanToken,
  rotateAlarmScanToken,
} from '../../../features/alarmScanVerify';
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
} from '../../../db/local';
import {
  SLOT_LABEL,
  MEDICATION_REMINDER_MODE_LABEL,
  type ReminderPeriodSetting,
  type MedicationReminderMode,
} from '../../../db/schema';
import { panel, setChip } from '../components/panelPrimitives';
import type { PanelChip } from '../types';
import { openKeepAliveGuideModal, openKeepAlivePromptSheet } from './KeepAlivePanel';

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
            : '当前浏览器发不了用药提醒。常见原因：用 http 的局域网地址打开的（需要 https 或本机地址）、浏览器里关掉了通知、或者 iPhone 上还没把本页「添加到主屏幕」。想稳定收到提醒，建议装手机 App。',
        }),
      ])
    );
    return;
  }

  const appEnabled = isAppNotificationsEnabled();
  const toggleRow = el('label', {
    class: 'settings-toggle-row',
  });
  const toggleCopy = el('div', { class: 'settings-toggle-copy' });
  toggleCopy.append(
    el('div', { class: 'settings-toggle-title', text: '应用内用药提醒' }),
    el('div', {
      class: 'settings-toggle-desc',
      text: appEnabled ? '开启后按计划发送系统通知与全屏提醒' : '已暂停：不再调度和弹出用药提醒',
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
  body.append(toggleRow);

  if (!appEnabled) {
    body.append(
      el('div', { class: 'banner info' }, [
        el('span', { html: '应用内提醒已关闭。系统通知权限可保留，但不会再发送用药提醒。' }),
      ]),
    );
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
      : '通知尚未开启，开启后才能按时收到提醒。';
  body.append(
    el('div', { class: 'banner ' + cls }, [el('span', { html: text })])
  );

  // 诚实降级：网页端做不到手机 App 那种「到点必响」，这一点必须写在用户看得见的
  // 地方，而不是藏在文档里。把话说满，用户漏吃药才是真正的代价。
  if (perm === 'granted' && !native) {
    body.append(
      el('div', { class: 'banner warn mt-3' }, [
        el('span', {
          html:
            '网页端的提醒没有手机 App 可靠：页面关掉之后，浏览器只会在它自己愿意醒来的时候补发提醒，可能晚几十分钟，手机清后台时也可能收不到。每天都要按时吃的药，请装手机 App。',
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
    body.append(row);
  } else {
    const isNativeAlarm = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
    const row = el('div', { class: isNativeAlarm ? 'settings-test-grid' : 'btn-row mt-3' });
    const testBtn = el('button', { class: 'btn tonal', html: '发送测试通知' });
    testBtn.onclick = async () => {
      const ok = await showNotification('测试提醒', {
        body: '看到这条说明当前通知通道可用',
        tag: 'medbox-test',
      });
      toast(ok ? '已发送测试通知' : '发送失败');
    };
    const tickBtn = el('button', { class: 'btn tonal', html: '立即检查到点' });
    tickBtn.onclick = async () => {
      await runReminderOnce();
      toast('已扫描一次到点任务');
    };
    row.append(testBtn, tickBtn);
    if (isNativeAlarm) {
      const strongTest = el('button', { class: 'btn tonal', html: '测试锁屏强提醒' });
      strongTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('strong');
          toast('已触发强提醒（如未弹出全屏页，请看通知栏/锁屏）');
        } catch {
          toast('触发失败');
        }
      };
      const fullTest = el('button', { class: 'btn tonal', html: '测试全屏提醒' });
      fullTest.onclick = async () => {
        try {
          await fireNativeMedicationAlarmNow('fullscreen-short');
          toast('已触发全屏提醒');
        } catch {
          toast('触发失败，请先允许全屏权限');
        }
      };
      row.append(strongTest, fullTest);
    }
    body.append(row);
  }

  if (perm === 'granted' && isNativeReminderPlatform()) {
    const exactAlarm = getExactAlarmCapability();
    if (exactAlarm !== 'granted') {
      const message = exactAlarm === 'unavailable'
        ? '当前系统无法确认精确闹钟能力，提醒可能有数分钟延迟。'
        : '精确闹钟尚未允许；Android 仍会安排提醒，但可能延迟送达。';
      body.append(
        el('div', { class: 'banner warn mt-3' }, [
          el('span', { html: message }),
        ]),
      );
      if (exactAlarm !== 'unavailable') {
        const exactRow = el('div', { class: 'btn-row mt-3' });
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
        body.append(exactRow);
      }
    }
    const fullScreen = getFullScreenAlarmCapability();
    if (fullScreen !== 'granted') {
      body.append(
        el('div', { class: 'banner warn mt-3' }, [
          el('span', {
            html: fullScreen === 'denied'
              ? '全屏提醒权限尚未开启；到点提醒会以顶部通知兜底，不再自动全屏。'
              : '当前系统不提供全屏提醒权限，到点提醒会以顶部通知兜底。',
          }),
        ]),
      );
      if (fullScreen === 'denied') {
        const fullScreenRow = el('div', { class: 'btn-row mt-3' });
        const fullScreenButton = el('button', { class: 'btn tonal', html: '允许全屏提醒' });
        fullScreenButton.onclick = async () => {
          await requestFullScreenAlarmCapability();
          toast('已打开系统设置，返回后会自动检查');
        };
        fullScreenRow.append(fullScreenButton);
        body.append(fullScreenRow);
      }
    }
    void refreshFullScreenAlarmCapability();
  }

  // ── 用药提醒铃声设置（专属音乐 vs 系统默认）──
  body.append(renderAlarmRingtoneCard(rerender));

  // ── 扫码解除强制提醒（全屏响铃仅 Android 原生生效，配置与绑定全局常驻）──
  const isNativeAlarm = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
  const scanPref = getAlarmScanVerifyPreference();
  const scanRow = el('label', { class: 'settings-toggle-row mt-3' });
  const scanCopy = el('div', { class: 'settings-toggle-copy' });
  const isCustom = scanPref.mode === 'custom';

  const titleRow = el('div', {
    class: 'settings-toggle-title',
    style: 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;',
  });
  titleRow.append(el('span', { text: '扫码解除强制提醒' }));
  if (!isNativeAlarm) {
    titleRow.append(
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 500; padding: 1px 7px; border-radius: 999px; background: rgba(0, 0, 0, 0.06); color: var(--color-text-muted);',
        text: '仅 Android App 生效',
      }),
    );
  }

  const descText = scanPref.enabled
    ? (isCustom
        ? `已开启 · ${formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)}`
        : '已开启 · 全屏提醒必须扫描专属二维码后才能操作')
    : (isCustom
        ? `已关闭 · 当前备用：${formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)}`
        : '已关闭 · 提醒到点可直接点击完成或贪睡');

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
  body.append(scanRow);

  // ── 常驻展示当前绑定状态卡片与操作按钮（无论开关开闭均可见）──
  const scanCard = el('div', { class: 'settings-scan-card mt-2' });
  const cardHeader = el('div', { class: 'settings-scan-card-header' });
  const badge = el('span', {
    class: 'chip-pill chip-pill-active',
    style: 'font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px;',
    text: isCustom ? '生活条形码/二维码' : '专属二维码（打印件）',
  });
  const statusLabel = el('span', {
    style: 'font-size: 13px; font-weight: 600; color: var(--color-text);',
    text: isCustom
      ? formatCustomScanCodeSummary(scanPref.customLabel, scanPref.token)
      : (hasAlarmScanToken() ? '专属二维码已就绪' : '专属二维码（系统预置）'),
  });
  cardHeader.append(badge, statusLabel);

  const cardDesc = el('div', {
    class: 'settings-scan-card-desc',
    text: isCustom
      ? '闹钟响起时扫描已绑定的药盒条形码或生活码，直接记录为已服用并自动关闭提醒。'
      : '截图保存专属二维码并打印贴在药箱或远离床的位置，到点起身扫码解除，杜绝睡迷糊随手关闭。',
  });

  scanCard.append(cardHeader, cardDesc);
  if (!isNativeAlarm) {
    scanCard.append(
      el('div', {
        class: 'muted text-xs mt-2',
        text: '网页端支持提前绑定与查看，数据可通过设置页「家庭同步」互传至手机。全屏响铃仅在 Android App 生效。',
      }),
    );
  }
  body.append(scanCard);

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
      await fireNativeMedicationAlarmNow('fullscreen-short');
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
  body.append(qrGrid);

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
      text: '开启后在强制提醒未扫码前阻断切回桌面，彻底免去固定屏幕弹窗；若未开启，将自动通过应用内任务栈防误触兜底。',
    });

    const accActionBtn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 12px; padding: 6px 12px; width: 100%;',
      text: '前往系统无障碍设置',
    });
    accActionBtn.onclick = async () => {
      await openAccessibilityGuardSettings();
    };

    const accGuideBtn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 12px; padding: 6px 12px; width: 100%;',
      text: '查看主流手机后台防杀指南',
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
        accActionBtn.textContent = '管理系统无障碍设置';
      } else {
        accBadge.className = 'chip-pill';
        accBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        accBadge.style.color = '#b45309';
        accBadge.textContent = '未开启 (建议开启)';
        accActionBtn.textContent = '点击前往系统开启无障碍';
      }
    });
  }

  body.append(
    el('div', {
      class: 'settings-hint',
      html: native
        ? '提醒说明：\n' +
          '· 请确保允许系统通知、精确闹钟以及（Android 14+）全屏提醒权限。\n' +
          '· 全屏模式将在到点时亮屏提醒，无权限时自动降级为通知栏提醒。\n' +
          '· 若系统限制后台运行，请在电池优化中将本应用设为允许后台活动。\n' +
          '· 重新进入应用时会自动检查遗漏的提醒并校准闹钟。'
        : '网页端提醒说明：\n' +
          '· 将网页「添加到主屏幕」后打开，可提升后台提醒的可靠性。\n' +
          '· 浏览器保持前台运行或处于活跃状态时，提醒最为准确。\n' +
          '· 设备长时间息屏或浏览器进程被清理后，通知可能会延迟或无法接收。\n' +
          '· 网页端不支持锁屏全屏提醒与物理按键拦截，完整功能请使用 Android 客户端。\n' +
          '· 重新打开网页时会自动检查遗漏的服药任务。',
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
    html: '每天按早、中、晚、睡前各发送 1 次聚合提醒。点击下方时段可自定义整体时间与响铃方式。',
  }));

  const needsReview = settings.filter((s) => s.state === 'needs-review');
  if (needsReview.length > 0) {
    body.append(el('div', { class: 'banner warn mt-3' }, [
      el('span', {
        html: `以下时段内不同药的提醒时间或方式不完全一致：${needsReview.map((s) => SLOT_LABEL[s.slot]).join('、')}。请逐个确认统一的整体时间与方式。`,
      }),
    ]));
  }

  const list = el('div', { class: 'period-setting-list mt-3' });
  for (const setting of settings) list.append(buildPeriodSettingRow(setting, body, panelEl));
  body.append(list);

  body.append(el('div', {
    class: 'settings-hint',
    html: '各药品自身的具体时间仍保留，新增药品不会重置上方设置。',
  }));
}

export function buildPeriodSettingRow(
  setting: ReminderPeriodSetting,
  body: HTMLElement,
  panelEl: HTMLElement,
): HTMLElement {
  const row = el('div', {
    class: 'period-setting-row' + (setting.state === 'needs-review' ? ' needs-review' : ''),
    role: 'button',
    tabIndex: 0,
    'aria-label': `编辑${SLOT_LABEL[setting.slot]}时段提醒`,
  });
  const copy = el('div', { class: 'settings-toggle-copy' });
  const title = el('div', { class: 'settings-toggle-title' });
  title.append(el('span', { text: SLOT_LABEL[setting.slot] }));
  if (setting.state === 'needs-review') {
    title.append(el('span', { class: 'panel-chip tone-warn period-review-badge', text: '待复核' }));
  }
  const meta = [MEDICATION_REMINDER_MODE_LABEL[setting.mode]];
  if (setting.escalate.repeatEveryMin > 0) meta.push(`每 ${setting.escalate.repeatEveryMin} 分钟重推`);
  copy.append(
    title,
    el('div', { class: 'period-setting-time', text: setting.timeLocal }),
    el('div', { class: 'settings-toggle-desc', text: meta.join(' · ') }),
  );
  const chevron = el('span', { class: 'panel-chevron' });
  chevron.append(icon('chevron-right'));
  row.append(copy, chevron);
  const open = () => void renderPeriodEditor(body, setting, panelEl);
  row.onclick = open;
  row.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return row;
}

/** 时段编辑器：整体时间 + 提醒方式 + 重复策略，保存后重建闹钟。 */
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

  const back = el('button', { class: 'btn text small', type: 'button', html: '← 返回时段列表' });
  back.onclick = () => void renderPeriodSettingsBody(body, panelEl);
  body.append(back);

  body.append(el('div', { class: 'section-title mt-3', html: `${SLOT_LABEL[latest.slot]}时段整体提醒` }));

  if (latest.state === 'needs-review') {
    body.append(el('div', { class: 'banner warn mt-3' }, [
      el('span', {
        html: '该时段内不同药的提醒时间或方式不完全一致，当前按下面的统一设置发送整体提醒。确认后复核标记自动消除；每种药自己的精确时间仍保留，仅用于记录与库存归因。',
      }),
    ]));
  }

  const timeIn = el('input', { type: 'time', step: '60', value: latest.timeLocal }) as HTMLInputElement;

  const modeControl = el('div', {
    class: 'period-mode-chips',
    role: 'radiogroup',
    'aria-label': '提醒方式',
  });
  let selectedMode: MedicationReminderMode = latest.mode;
  for (const mode of Object.keys(MEDICATION_REMINDER_MODE_LABEL) as MedicationReminderMode[]) {
    const option = el('button', {
      class: 'period-mode-chip' + (mode === selectedMode ? ' is-selected' : ''),
      type: 'button',
      role: 'radio',
      'aria-checked': String(mode === selectedMode),
    });
    option.append(el('strong', { text: MEDICATION_REMINDER_MODE_LABEL[mode] }));
    option.append(el('span', {
      text: mode === 'strong' ? '高优先级通知' : mode === 'fullscreen-short' ? '全屏 10 秒' : '持续提醒',
    }));
    option.onclick = () => {
      selectedMode = mode;
      for (const child of modeControl.querySelectorAll<HTMLElement>('[role="radio"]')) {
        const selected = child === option;
        child.classList.toggle('is-selected', selected);
        child.setAttribute('aria-checked', String(selected));
      }
    };
    modeControl.append(option);
  }

  const repeatIn = el('input', {
    type: 'number', min: '1', step: '1', value: String(latest.escalate.repeatEveryMin),
  }) as HTMLInputElement;
  const maxRepeatsIn = el('input', {
    type: 'number', min: '0', step: '1', value: String(latest.escalate.maxRepeats),
  }) as HTMLInputElement;
  const caregiverIn = el('input', {
    type: 'number', min: '0', step: '1', value: String(latest.escalate.notifyCaregiverAfterMin),
  }) as HTMLInputElement;

  body.append(
    field('整体提醒时间', timeIn),
    field('提醒方式', modeControl),
    field('未确认时每几分钟再提醒', repeatIn),
    field('最多重推次数（不含首次）', maxRepeatsIn),
    field('超过几分钟通知照护者（0 = 不通知）', caregiverIn),
  );

  const row = el('div', { class: 'btn-row mt-3' });
  const saveBtn = el('button', { class: 'btn', html: '保存' });
  saveBtn.onclick = async () => {
    if (saveBtn.hasAttribute('disabled')) return;
    saveBtn.setAttribute('disabled', 'true');
    try {
      await updateReminderPeriodSetting(latest.slot, {
        timeLocal: timeIn.value,
        mode: selectedMode,
        escalate: {
          repeatEveryMin: Math.max(1, Math.floor(Number(repeatIn.value) || 1)),
          maxRepeats: Math.max(0, Math.floor(Number(maxRepeatsIn.value) || 0)),
          notifyCaregiverAfterMin: Math.max(0, Math.floor(Number(caregiverIn.value) || 0)),
        },
      });
    } catch (error) {
      saveBtn.removeAttribute('disabled');
      toast('保存失败：' + (error instanceof Error ? error.message : String(error)));
      return;
    }
    try { await rescheduleMedicationReminders(); } catch { /* best-effort */ }
    toast(`${SLOT_LABEL[latest.slot]}时段提醒已保存，闹钟已重建`);
    void renderPeriodSettingsBody(body, panelEl);
  };
  row.append(saveBtn);
  body.append(row);
}
