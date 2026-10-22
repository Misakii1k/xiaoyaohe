import './styles/components/home-update-sheet.css';
import { el, icon, toast } from './components';
import { openBottomSheet, type BottomSheetHandle } from './primitives/BottomSheet';
import {
  compareVersion,
  downloadAndApplyWebBundle,
  downloadUpdate,
  getAvailableUpdate,
  installApk,
  LOCAL_APP_VERSION,
  type AvailableUpdate,
} from '../sync/lan/apkTransport';
import {
  recommendForUpdate,
  renderFormattedReleaseNotes,
} from '../pages/settings/panels/AppUpdatePanel';
import { formatUpdateSizeMb } from '../sync/lan/updateRecommendation';
import { sanitizeReleaseNotesForDisplay } from '../sync/lan/releaseNotesText';
import { toLocalDate } from '../domain/medicationSchedule';

export const DISMISSED_UPDATE_VERSION_KEY = 'medbox.dismissed-update-version.v1';
export const LAST_UPDATE_PROMPT_DATE_KEY = 'medbox.update-prompt.last-date.v1';

let activeHomeUpdateHandle: BottomSheetHandle | null = null;

/**
 * 检查当前是否应在首页弹出新版本提醒。
 * 避让规则：
 * 1. 存在服药打卡弹窗（.take-med-overlay）或已有 bottom-sheet 打开时自动避让；
 * 2. 已跳过当前版本（localStorage medbox.dismissed-update-version.v1 >= update.version）；
 * 3. 今日已提醒过（localStorage medbox.update-prompt.last-date.v1 === 今日日期）；
 * 4. 当前未发现新版本。
 */
export function shouldShowHomeUpdatePrompt(update: AvailableUpdate | null = getAvailableUpdate()): boolean {
  if (!update) return false;
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return false;

  // 1. 自动避让正在打卡或已有弹窗（包括底部抽屉、确认框与对话框）
  if (typeof document !== 'undefined') {
    if (document.querySelector('.take-med-overlay') != null) return false;
    if (document.querySelector('.bottom-sheet-overlay') != null) return false;
    if (document.querySelector('.confirm-dialog-overlay') != null) return false;
    if (document.querySelector('.dialog-overlay') != null) return false;
  }

  const cleanUpdateVer = update.version.replace(/^[vV]/, '');
  const cleanLocalVer = LOCAL_APP_VERSION.replace(/^[vV]/, '');

  // 2. 检查更新版本是否确实高于本机当前运行版本
  if (compareVersion(cleanUpdateVer, cleanLocalVer) <= 0) {
    return false;
  }

  // 3. 检查跳过记录：已跳过的版本在有更高版本前不再弹出
  const dismissed = localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY);
  if (dismissed) {
    const cleanDismissed = dismissed.replace(/^[vV]/, '');
    if (compareVersion(cleanUpdateVer, cleanDismissed) <= 0) {
      return false;
    }
  }

  // 4. 检查当日提醒记录：当天已提醒过不再弹出，次日再提醒
  const today = toLocalDate(new Date());
  const lastPromptDate = localStorage.getItem(LAST_UPDATE_PROMPT_DATE_KEY);
  if (lastPromptDate === today) {
    return false;
  }

  return true;
}

/**
 * 在首页弹出新版本更新抽屉（career-ops 形式）。
 */
export function openHomeUpdateBottomSheet(update: AvailableUpdate): BottomSheetHandle {
  if (activeHomeUpdateHandle) {
    activeHomeUpdateHandle.close();
    activeHomeUpdateHandle = null;
  }

  const container = el('div', { class: 'home-update-sheet-content' });

  // 1. 顶部拖拽把手
  container.append(el('div', { class: 'home-update-handle' }));

  // 2. 数据安全保障承诺（career-ops 样式）
  const safetyBanner = el('div', { class: 'home-update-safety-banner' });
  const safetyIcon = el('span', { class: 'home-update-safety-icon' });
  safetyIcon.append(icon('shield'));
  const safetyText = el('span', {
    class: 'home-update-safety-text',
    text: '升级不会清除您的服药记录、药品清单或库存数据，请放心升级。',
  });
  safetyBanner.append(safetyIcon, safetyText);
  container.append(safetyBanner);

  // 3. 版本跃迁与类型徽章
  const recommendation = recommendForUpdate(update);
  const isIncremental = update.updateType === 'incremental' && recommendation.incrementalAvailable;

  const header = el('div', { class: 'home-update-header' });
  const versionRow = el('div', { class: 'home-update-version-transition' });
  versionRow.append(
    el('span', { class: 'home-update-version-from', text: `v${LOCAL_APP_VERSION}` }),
    el('span', { class: 'home-update-version-arrow', text: '→' }),
    el('strong', { class: 'home-update-version-to', text: `v${update.version}` }),
  );

  const badge = el('span', {
    class: `home-update-badge ${isIncremental ? 'is-incremental' : 'is-full'}`,
    text: isIncremental ? '秒级更新' : '完整更新',
  });
  header.append(versionRow, badge);
  container.append(header);

  // 4. 来源与包体积元信息
  const bundleMb = formatUpdateSizeMb(update.bundleSize);
  const fullMb = formatUpdateSizeMb(update.fileSize);
  const metaParts: string[] = [];
  if (update.source === 'lan') {
    metaParts.push(`来源：同一 Wi-Fi 设备 ${update.peerHost ?? ''}`.trim());
  } else if (update.source === 'github') {
    metaParts.push('来源：官方发布');
  } else {
    metaParts.push('来源：官方更新服务');
  }
  if (isIncremental && bundleMb) metaParts.push(`秒级更新约 ${bundleMb} MB`);
  if (fullMb) metaParts.push(`完整包约 ${fullMb} MB`);

  const metaEl = el('div', { class: 'home-update-meta', text: metaParts.join(' · ') });
  container.append(metaEl);

  // 5. 更新说明（脱敏并渲染）
  const cleanNotes = sanitizeReleaseNotesForDisplay(update.releaseNotes ?? '');
  const notesWrapper = el('div', { class: 'home-update-notes-wrapper' });
  notesWrapper.append(renderFormattedReleaseNotes(cleanNotes));
  container.append(notesWrapper);

  // 6. 进度条（初始隐藏）
  const progressBox = el('div', { class: 'home-update-progress-box', style: 'display: none;' });
  const progressLabels = el('div', { class: 'home-update-progress-labels' });
  const progressText = el('span', { text: '正在下载...' });
  const progressDetail = el('span', { text: '0%' });
  progressLabels.append(progressText, progressDetail);
  const progressTrack = el('div', { class: 'home-update-progress-track' });
  const progressFill = el('div', { class: 'home-update-progress-fill' });
  progressTrack.append(progressFill);
  progressBox.append(progressLabels, progressTrack);
  container.append(progressBox);

  // 7. 操作按钮区
  const actions = el('div', { class: 'home-update-actions' });
  const buttonsToDisable: HTMLButtonElement[] = [];

  let skippedClicked = false;

  const setButtonsDisabled = (disabled: boolean) => {
    for (const btn of buttonsToDisable) btn.disabled = disabled;
  };

  // 完整包下载安装逻辑
  const executeFullInstall = async (triggerBtn: HTMLButtonElement) => {
    if (triggerBtn.getAttribute('aria-busy') === 'true') return;
    triggerBtn.setAttribute('aria-busy', 'true');
    setButtonsDisabled(true);
    progressBox.style.display = 'block';
    progressFill.style.width = '0%';
    progressDetail.textContent = '0%';
    progressText.textContent = '准备下载安装包...';
    triggerBtn.textContent = '准备下载...';

    try {
      const apkPath = await downloadUpdate(update, (percent, received, total) => {
        progressFill.style.width = `${percent}%`;
        progressDetail.textContent = `${percent}%`;
        if (total > 0) {
          progressText.textContent = `${(received / (1024 * 1024)).toFixed(1)}MB / ${(total / (1024 * 1024)).toFixed(1)}MB`;
        }
        triggerBtn.textContent = `下载中 ${percent}%`;
      });
      toast(`已下载 v${update.version}，正在调起安装器`, 3200);
      await installApk(apkPath, update.source === 'lan' ? update.versionCode : undefined);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      toast(`更新失败：${msg}`, 4200);
    } finally {
      triggerBtn.removeAttribute('aria-busy');
      triggerBtn.textContent = isIncremental ? '下载完整包' : '下载完整包并安装';
      setButtonsDisabled(false);
      progressBox.style.display = 'none';
    }
  };

  let incBtnEl: HTMLButtonElement | null = null;
  let fullBtnEl: HTMLButtonElement | null = null;

  // 秒级更新安装逻辑
  const executeIncrementalInstall = async (triggerBtn: HTMLButtonElement) => {
    if (triggerBtn.getAttribute('aria-busy') === 'true') return;
    triggerBtn.setAttribute('aria-busy', 'true');
    setButtonsDisabled(true);
    progressBox.style.display = 'block';
    progressFill.style.width = '100%';
    progressDetail.textContent = '下载中';
    triggerBtn.textContent = '正在下载更新...';
    progressText.textContent = '正在下载更新内容...';

    try {
      await downloadAndApplyWebBundle(update, (status) => {
        triggerBtn.textContent = status;
        progressText.textContent = status;
      });
      toast(`已更新至 v${update.version}，正在刷新生效...`, 2500);
      setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      toast(`秒级更新未成功（${msg}），已为您切换至完整包下载`, 4200);
      if (incBtnEl) {
        incBtnEl.style.display = 'none';
      }
      if (fullBtnEl) {
        fullBtnEl.className = 'btn ui-button ui-button-primary';
        fullBtnEl.focus();
      }
    } finally {
      triggerBtn.removeAttribute('aria-busy');
      triggerBtn.textContent = '一键秒级更新';
      setButtonsDisabled(false);
      progressBox.style.display = 'none';
    }
  };

  // 双通道按钮渲染
  if (isIncremental) {
    const incBtn = el('button', { class: 'btn ui-button ui-button-primary', text: '一键秒级更新' }) as HTMLButtonElement;
    incBtn.onclick = () => void executeIncrementalInstall(incBtn);
    buttonsToDisable.push(incBtn);
    incBtnEl = incBtn;
    actions.append(incBtn);

    const fullBtn = el('button', { class: 'btn tonal', text: '下载完整包' }) as HTMLButtonElement;
    fullBtn.onclick = () => void executeFullInstall(fullBtn);
    buttonsToDisable.push(fullBtn);
    fullBtnEl = fullBtn;
    actions.append(fullBtn);
  } else {
    const fullBtn = el('button', { class: 'btn ui-button ui-button-primary', text: '下载完整包' }) as HTMLButtonElement;
    fullBtn.onclick = () => void executeFullInstall(fullBtn);
    buttonsToDisable.push(fullBtn);
    fullBtnEl = fullBtn;
    actions.append(fullBtn);
  }

  // 本次跳过按钮
  const skipBtn = el('button', { class: 'btn home-update-skip-btn', text: '本次跳过' }) as HTMLButtonElement;
  skipBtn.onclick = () => {
    skippedClicked = true;
    try {
      localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, update.version);
    } catch {
      /* ignore */
    }
    handle.close();
  };
  buttonsToDisable.push(skipBtn);
  actions.append(skipBtn);

  container.append(actions);

  const handle = openBottomSheet({
    label: `发现新版本 v${update.version}`,
    className: 'home-update-sheet',
    content: container,
    onClose: () => {
      activeHomeUpdateHandle = null;
      // 若用户未点击“本次跳过”（如点击遮罩关闭或按 Escape），记录当日已提醒日期
      if (!skippedClicked) {
        try {
          localStorage.setItem(LAST_UPDATE_PROMPT_DATE_KEY, toLocalDate(new Date()));
        } catch {
          /* ignore */
        }
      }
    },
  });

  activeHomeUpdateHandle = handle;
  return handle;
}

/**
 * 在满足条件时静默触发首页新版本更新弹窗。
 */
export function maybeShowHomeUpdatePrompt(): boolean {
  const update = getAvailableUpdate();
  if (!shouldShowHomeUpdatePrompt(update)) {
    return false;
  }
  openHomeUpdateBottomSheet(update!);
  return true;
}
