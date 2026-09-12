import { el, toast } from '../../../ui/components';
import { openBottomSheet } from '../../../ui/primitives/BottomSheet';
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
  openAppSettings,
} from '../../../features/keepAlive';
import { isNativeReminderPlatform } from '../../../features/notifier';
import {
  checkAccessibilityGuardEnabled,
  nativeMedicationAlarmAvailable,
  openAccessibilityGuardSettings,
} from '../../../features/nativeMedicationAlarm';
import { panel, setChip } from '../components/panelPrimitives';

export function openKeepAliveGuideModal(): void {
  const title = el('h3', { class: 'lan-sync-sheet-title', text: '主流手机后台防杀指南' });
  const hint = el('div', {
    class: 'settings-hint mb-3',
    text: '部分手机厂商的后台清理策略较为严格，可能在熄屏后终止后台进程。请根据手机品牌完成以下设置：',
  });

  const oems = [
    {
      id: 'xiaomi',
      name: '小米 / 红米',
      steps: [
        { title: '多任务后台卡片加锁', desc: '从屏幕底部上滑呼出多任务界面，长按小药盒卡片，点击「锁」图标加锁，防止被系统一键清理。' },
        { title: '允许自启动权限', desc: '打开手机「安全中心」→「应用管理」→「权限」→「自启动管理」，找到「小药盒」并开启自启动。' },
        { title: '省电策略设为无限制', desc: '在安全中心「应用管理」中找到小药盒，进入「省电策略」，将其修改为「无限制」。' },
        { title: '开启无障碍服务', desc: '进入手机「系统设置」→「更多设置」→「无障碍」→「已下载的应用」，开启「小药盒无障碍服务」。' },
      ],
    },
    {
      id: 'huawei',
      name: '华为 / 荣耀',
      steps: [
        { title: '手动管理应用启动', desc: '进入「系统设置」→「应用和服务」→「应用启动管理」，找到小药盒，关闭「自动管理」，在手动管理弹窗中开启「允许自启动」、「允许关联启动」与「允许后台活动」。' },
        { title: '电池优化设为不允许', desc: '进入「系统设置」→「应用」→「权限管理」→右上角四点「特殊访问权限」→「电池优化」，切换为全部应用，将小药盒设为「不允许」。' },
        { title: '多任务后台卡片加锁', desc: '呼出多任务后台，向下拉动小药盒卡片，卡片右上角出现小锁图标即锁定成功。' },
        { title: '开启无障碍服务', desc: '进入「系统设置」→「辅助功能」→「已安装的服务」，开启「小药盒无障碍服务」。' },
      ],
    },
    {
      id: 'oppo',
      name: 'OPPO / 一加',
      steps: [
        { title: '允许完全后台行为', desc: '进入「系统设置」→「电池」→「应用耗电管理」→找到小药盒，开启「允许完全后台行为」与「允许应用自启动」。' },
        { title: '多任务后台加锁', desc: '呼出多任务后台，点击小药盒卡片右上角「⋮」，选择「锁定」。' },
        { title: '开启无障碍服务', desc: '进入「系统设置」→「其他设置」→「无障碍」，开启「小药盒无障碍服务」。' },
      ],
    },
    {
      id: 'vivo',
      name: 'vivo / iQOO',
      steps: [
        { title: '允许后台高耗电', desc: '进入「系统设置」→「电池」→「后台高耗电管理」，将小药盒勾选为「允许高耗电」。' },
        { title: '开启自启动', desc: '进入「系统设置」→「应用与权限」→「权限管理」→「自启动」，开启小药盒自启动开关。' },
        { title: '多任务后台加锁', desc: '呼出多任务，向下拉动小药盒卡片，点击小锁图标锁定。' },
        { title: '开启无障碍服务', desc: '进入「系统设置」→「快捷与辅助」→「无障碍」→「已下载的应用」，开启「小药盒无障碍服务」。' },
      ],
    },
    {
      id: 'generic',
      name: '通用 Android',
      steps: [
        { title: '忽略电池优化', desc: '在应用详情设置中，将「电池」或「电池优化」设为「无限制」或「不受优化」。' },
        { title: '多任务界面加锁', desc: '在最近任务（多任务）列表中，长按或向下拉动小药盒卡片，点击小锁图标防止一键清理。' },
        { title: '开启无障碍服务', desc: '在系统设置「无障碍」中找到「小药盒无障碍服务」并开启。' },
      ],
    },
  ];

  let currentOemIndex = 0;
  const tabsContainer = el('div', { class: 'keepalive-oem-tabs' });
  const contentContainer = el('div', { class: 'keepalive-oem-content' });

  const renderOemContent = () => {
    tabsContainer.replaceChildren();
    contentContainer.replaceChildren();

    oems.forEach((oem, idx) => {
      const tabBtn = el('button', {
        class: `keepalive-oem-tab ${idx === currentOemIndex ? 'is-active' : ''}`,
        text: oem.name,
      });
      tabBtn.onclick = () => {
        currentOemIndex = idx;
        renderOemContent();
      };
      tabsContainer.append(tabBtn);
    });

    const activeOem = oems[currentOemIndex] ?? oems[0];
    if (!activeOem) return;
    activeOem.steps.forEach((s, stepIdx) => {
      const stepRow = el('div', { class: 'keepalive-oem-step' });
      const numBadge = el('div', { class: 'keepalive-step-num', text: String(stepIdx + 1) });
      const textCol = el('div', { class: 'keepalive-step-text' });
      const stepTitle = el('strong', { text: `${s.title}：` });
      textCol.append(stepTitle, s.desc);
      stepRow.append(numBadge, textCol);
      contentContainer.append(stepRow);
    });
  };

  renderOemContent();

  const openSettingsBtn = el('button', { class: 'btn tonal', text: '打开应用系统设置' });
  openSettingsBtn.onclick = () => {
    void openAppSettings();
  };

  const closeBtn = el('button', { class: 'btn', text: '完成' });
  let sheet!: ReturnType<typeof openBottomSheet>;
  closeBtn.onclick = () => sheet.close();

  const btnRow = el('div', { class: 'btn-row mt-3' }, [openSettingsBtn, closeBtn]);

  sheet = openBottomSheet({
    label: '主流手机后台防杀指南',
    content: [title, hint, tabsContainer, contentContainer, btnRow],
    initialFocus: closeBtn,
  });
}

export function openKeepAlivePromptSheet(
  rerender: () => void,
  status: { accEnabled: boolean; ignoring: boolean },
): void {
  const title = el('h3', { class: 'lan-sync-sheet-title', text: '建议开启后台防杀保护' });
  const hint = el('div', { class: 'settings-hint mb-3' });
  hint.append(
    el('p', {
      class: 'mb-1',
      text: '已开启扫码解除强制提醒。为避免提醒被手机系统清理或通过手势误退，建议开启以下保护：',
    }),
  );

  const list = el('div', { class: 'keepalive-item-list' });

  if (!status.accEnabled) {
    const accItem = el('div', { class: 'keepalive-card' });
    const head = el('div', { class: 'keepalive-card-head' });
    head.append(
      el('span', { class: 'keepalive-card-title', text: '1. 无障碍防退出保护' }),
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.15); color: #b45309;',
        text: '未开启',
      }),
    );
    const desc = el('div', {
      class: 'keepalive-card-desc',
      text: '在未扫码前阻断切回桌面，同时提升应用在系统中的保活优先级。',
    });
    const btn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 13px; width: 100%;',
      text: '前往开启无障碍服务',
    });
    btn.onclick = async () => {
      await openAccessibilityGuardSettings();
      sheet.close();
      rerender();
    };
    accItem.append(head, desc, btn);
    list.append(accItem);
  }

  if (!status.ignoring) {
    const battItem = el('div', { class: 'keepalive-card' });
    const head = el('div', { class: 'keepalive-card-head' });
    head.append(
      el('span', { class: 'keepalive-card-title', text: '2. 忽略电池优化（白名单）' }),
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.15); color: #b45309;',
        text: '需授权',
      }),
    );
    const desc = el('div', {
      class: 'keepalive-card-desc',
      text: '允许应用在后台持续运行，避免手机长时间熄屏或处于省电模式时遗漏提醒。',
    });
    const btn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 13px; width: 100%;',
      text: '申请加入电池白名单',
    });
    btn.onclick = async () => {
      const ok = await requestIgnoreBatteryOptimizations();
      toast(ok ? '已加入电池优化白名单' : '未加入，可稍后再试');
      sheet.close();
      rerender();
    };
    battItem.append(head, desc, btn);
    list.append(battItem);
  }

  const guideBtn = el('button', {
    class: 'btn tonal',
    text: '查看防杀指南',
  });
  guideBtn.onclick = () => {
    sheet.close();
    openKeepAliveGuideModal();
  };

  const closeBtn = el('button', { class: 'btn', text: '我知道了' });
  let sheet!: ReturnType<typeof openBottomSheet>;
  closeBtn.onclick = () => sheet.close();

  const btnRow = el('div', { class: 'btn-row mt-3' }, [guideBtn, closeBtn]);

  sheet = openBottomSheet({
    label: '建议开启后台防杀保护',
    content: [title, hint, list, btnRow],
    initialFocus: closeBtn,
  });
}

export async function refreshKeepAlive(body: HTMLElement, panelEl: HTMLElement): Promise<void> {
  body.replaceChildren();
  const isNative = isNativeReminderPlatform() && nativeMedicationAlarmAvailable();
  const [ignoring, accEnabled] = await Promise.all([
    isIgnoringBatteryOptimizations().catch(() => false),
    isNative ? checkAccessibilityGuardEnabled().catch(() => false) : Promise.resolve(false),
  ]);

  const allReady = isNative ? (ignoring && accEnabled) : ignoring;
  setChip(panelEl, allReady
    ? { text: '已就绪', tone: 'ok' }
    : { text: '建议设置', tone: 'warn' });

  const intro = el('div', {
    class: 'settings-hint',
    text: isNative
      ? 'Android 系统会对后台应用进行休眠和清理。完成以下设置后，可确保按时收到用药全屏提醒与自动同步。'
      : '网页端提醒依赖浏览器前台活动。如需最可靠的准时提醒与无障碍守护，建议安装 Android 原生 App。',
  });
  body.append(intro);

  if (isNative) {
    const list = el('div', { class: 'keepalive-item-list mt-3' });

    // 1. 无障碍防退出保护
    const accItem = el('div', { class: 'keepalive-card' });
    const accHead = el('div', { class: 'keepalive-card-head' });
    accHead.append(
      el('span', { class: 'keepalive-card-title', text: '1. 无障碍防退出保护' }),
      el('span', {
        class: `chip-pill ${accEnabled ? 'chip-pill-active' : ''}`,
        style: accEnabled
          ? 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(23, 96, 63, 0.12); color: var(--color-primary, #17603f);'
          : 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.15); color: #b45309;',
        text: accEnabled ? '已开启' : '未开启（建议开启）',
      }),
    );
    const accDesc = el('div', {
      class: 'keepalive-card-desc',
      text: '开启后由无障碍服务守护全屏提醒窗口，在未完成扫码前阻止误切桌面；同时显著提升系统后台保活优先级。',
    });
    const accBtn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 13px; width: 100%;',
      text: accEnabled ? '管理系统无障碍设置' : '前往开启无障碍服务',
    });
    accBtn.onclick = async () => {
      await openAccessibilityGuardSettings();
      void refreshKeepAlive(body, panelEl);
    };
    accItem.append(accHead, accDesc, accBtn);
    list.append(accItem);

    // 2. 电池优化白名单
    const battItem = el('div', { class: 'keepalive-card mt-2' });
    const battHead = el('div', { class: 'keepalive-card-head' });
    battHead.append(
      el('span', { class: 'keepalive-card-title', text: '2. 忽略电池优化（白名单）' }),
      el('span', {
        class: `chip-pill ${ignoring ? 'chip-pill-active' : ''}`,
        style: ignoring
          ? 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(23, 96, 63, 0.12); color: var(--color-primary, #17603f);'
          : 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(245, 158, 11, 0.15); color: #b45309;',
        text: ignoring ? '已允许' : '需授权（建议允许）',
      }),
    );
    const battDesc = el('div', {
      class: 'keepalive-card-desc',
      text: '允许应用在后台持续运行，避免手机长时间熄屏或处于省电模式时遗漏提醒与定时同步。',
    });
    const battBtnRow = el('div', { class: 'btn-row mt-2' });
    if (!ignoring) {
      const allowBtn = el('button', { class: 'btn', style: 'font-size: 13px;', text: '申请加入白名单' });
      allowBtn.onclick = async () => {
        const ok = await requestIgnoreBatteryOptimizations();
        toast(ok ? '已加入电池优化白名单' : '未加入，可稍后再试');
        void refreshKeepAlive(body, panelEl);
      };
      battBtnRow.append(allowBtn);
    }
    const appSettingsBtn = el('button', { class: 'btn tonal', style: 'font-size: 13px;', text: '打开应用系统设置' });
    appSettingsBtn.onclick = () => void openAppSettings();
    battBtnRow.append(appSettingsBtn);
    battItem.append(battHead, battDesc, battBtnRow);
    list.append(battItem);

    // 3. 多任务卡片加锁
    const lockItem = el('div', { class: 'keepalive-card mt-2' });
    const lockHead = el('div', { class: 'keepalive-card-head' });
    lockHead.append(
      el('span', { class: 'keepalive-card-title', text: '3. 多任务后台卡片加锁' }),
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.05); color: var(--color-text-muted);',
        text: '手动操作',
      }),
    );
    const lockDesc = el('div', {
      class: 'keepalive-card-desc',
      text: '呼出手机多任务（最近应用）列表，在小药盒卡片上向下拉动或长按，点击「小锁」图标加锁，防止被系统「一键清理」关闭。',
    });
    lockItem.append(lockHead, lockDesc);
    list.append(lockItem);

    // 4. 自启动与后台运行管理
    const autoItem = el('div', { class: 'keepalive-card mt-2' });
    const autoHead = el('div', { class: 'keepalive-card-head' });
    autoHead.append(
      el('span', { class: 'keepalive-card-title', text: '4. 自启动与后台运行权限' }),
      el('span', {
        class: 'chip-pill',
        style: 'font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(0, 0, 0, 0.05); color: var(--color-text-muted);',
        text: '厂商管理',
      }),
    );
    const autoDesc = el('div', {
      class: 'keepalive-card-desc',
      text: '部分手机厂商（小米、华为、OPPO、vivo 等）默认限制后台自启动，请在手机管家或权限管理中将小药盒设为允许自启动与后台活动。',
    });
    const guideBtn = el('button', {
      class: 'btn tonal mt-2',
      style: 'font-size: 13px; width: 100%;',
      text: '查看主流手机防杀指南',
    });
    guideBtn.onclick = () => openKeepAliveGuideModal();
    autoItem.append(autoHead, autoDesc, guideBtn);
    list.append(autoItem);

    body.append(list);
  } else {
    // 网页端
    const battBtnRow = el('div', { class: 'btn-row mt-3' });
    const openBtn = el('button', { class: 'btn tonal', text: '查看防杀设置指南' });
    openBtn.onclick = () => openKeepAliveGuideModal();
    battBtnRow.append(openBtn);
    body.append(battBtnRow);
  }
}

export function renderKeepAlivePanel(): HTMLElement {
  const p = panel({
    title: '后台保活与防杀',
    iconName: 'shield',
    iconTone: 'orange',
    chip: { text: '检查中', tone: 'muted' },
    renderBody: (body) => {
      queueMicrotask(() => void refreshKeepAlive(body, p));
    },
  });
  return p;
}
