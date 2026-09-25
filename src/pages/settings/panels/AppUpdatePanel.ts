import { el, icon, toast } from '../../../ui/components';
import {
  checkForAppUpdates,
  clearAvailableUpdate,
  downloadAndApplyWebBundle,
  downloadUpdate,
  getAvailableUpdate,
  installApk,
  isApkDistributionAvailable,
  LOCAL_APP_VERSION,
  LOCAL_APP_VERSION_CODE,
  DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE,
  type AvailableUpdate,
} from '../../../sync/lan/apkTransport';
import {
  formatUpdateSizeMb,
  recommendUpdateChannel,
  type UpdateRecommendation,
} from '../../../sync/lan/updateRecommendation';
import { sanitizeReleaseNotesForDisplay } from '../../../sync/lan/releaseNotesText';
import type { PanelChip, SettingsRenderPart } from '../types';
import { panel, setChip } from '../components/panelPrimitives';

/** 本次运行中秒级更新失败过的版本：重新渲染后改推荐完整包（两个按钮仍保留）。 */
const incrementalFailedVersions = new Set<string>();

function markIncrementalFailed(version: string): void {
  incrementalFailedVersions.add(version);
}

/** 测试用：清空秒级更新失败记录。 */
export function resetIncrementalFailures(): void {
  incrementalFailedVersions.clear();
}

export function recommendForUpdate(
  update: AvailableUpdate,
  localNativeVersionCode: number = LOCAL_APP_VERSION_CODE,
): UpdateRecommendation {
  return recommendUpdateChannel({
    localNativeVersionCode,
    source: update.source,
    bundleUrl: update.bundleUrl,
    bundleSize: update.bundleSize,
    fileSize: update.fileSize,
    downloadUrl: update.downloadUrl,
    minNativeVersionCode: update.minNativeVersionCode,
    defaultMinNativeVersionCode: DEFAULT_MIN_NATIVE_BUNDLE_VERSION_CODE,
    incrementalFailed: incrementalFailedVersions.has(update.version),
  });
}

/**
 * 检查阶段已判定为只能完整安装、但推荐函数认为秒级可用的少见情况
 * （例如元数据缺秒级资源校验信息被降级）：统一给出「只提供完整安装包」的说法。
 */
function fullOnlyCode(rec: UpdateRecommendation): string {
  return rec.incrementalAvailable ? 'no-bundle' : rec.code;
}

function fullOnlyReason(rec: UpdateRecommendation): string {
  return rec.incrementalAvailable ? '这次更新需要安装完整安装包，下载后按提示安装即可。' : rec.reason;
}

export function renderAppUpdatePanel(): SettingsRenderPart {
  const update = getAvailableUpdate();
  const available = isApkDistributionAvailable();
  const chip: PanelChip = !available
    ? { text: '仅 App', tone: 'muted' }
    : update
      ? { text: `可更新 v${update.version}`, tone: 'info' }
      : { text: '已是最新', tone: 'ok' };

  let refreshFn: (() => void) | null = null;
  const p = panel({
    title: '应用更新',
    iconName: 'cloud',
    iconTone: 'blue',
    chip,
    renderBody: (body) => {
      const refresh = () => buildAppUpdateBody(body, p, available);
      refreshFn = refresh;
      queueMicrotask(refresh);
    },
  });

  // 监听可用更新变化（如自动同步发现新版本后）
  const onUpdate = () => {
    refreshFn?.();
    const nextUpdate = getAvailableUpdate();
    setChip(p, nextUpdate
      ? { text: `可更新 v${nextUpdate.version}`, tone: 'info' }
      : { text: '已是最新', tone: 'ok' });
  };
  window.addEventListener('medbox:app-update-changed', onUpdate);

  return {
    element: p,
    cleanup: () => window.removeEventListener('medbox:app-update-changed', onUpdate),
  };
}

export function appendFormattedInline(parent: HTMLElement, text: string): void {
  const sanitized = text.replaceAll('$\\to$', '→').replaceAll('\\to', '→');
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sanitized)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(sanitized.slice(lastIndex, match.index)));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parent.append(el('strong', { text: token.slice(2, -2) }));
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parent.append(el('code', { class: 'app-update-code', text: token.slice(1, -1) }));
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < sanitized.length) {
    parent.append(document.createTextNode(sanitized.slice(lastIndex)));
  }
}

export function renderFormattedReleaseNotes(rawNotes: string): HTMLElement {
  const container = el('div', { class: 'app-update-release-notes' });
  const lines = rawNotes.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('# ')) {
      const heading = el('div', { class: 'app-update-notes-h1' });
      appendFormattedInline(heading, trimmed.slice(2).trim());
      container.append(heading);
    } else if (trimmed.startsWith('## ')) {
      const heading = el('div', { class: 'app-update-notes-h2' });
      appendFormattedInline(heading, trimmed.slice(3).trim());
      container.append(heading);
    } else if (trimmed.startsWith('### ')) {
      const heading = el('div', { class: 'app-update-notes-h3' });
      appendFormattedInline(heading, trimmed.slice(4).trim());
      container.append(heading);
    } else if (/^\s*[-*]\s+/.test(line)) {
      const isSub = /^\s{2,}[-*]\s+/.test(line);
      const li = el('div', { class: `app-update-notes-li${isSub ? ' sub' : ''}` });
      const bullet = el('span', { class: 'app-update-notes-bullet', text: isSub ? '◦' : '•' });
      const content = el('span', { class: 'app-update-notes-li-content' });
      const itemText = line.replace(/^\s*[-*]\s+/, '');
      appendFormattedInline(content, itemText);
      li.append(bullet, content);
      container.append(li);
    } else {
      const p = el('div', { class: 'app-update-notes-p' });
      appendFormattedInline(p, trimmed);
      container.append(p);
    }
  }

  return container;
}

export function buildAppUpdateBody(
  body: HTMLElement,
  panelEl: HTMLElement,
  available: boolean,
): void {
  body.replaceChildren();

  // 当前版本信息
  const versionInfo = el('div', { class: 'settings-hint' });
  versionInfo.append(
    '当前版本：',
    el('strong', { text: `v${LOCAL_APP_VERSION}` }),
    '（正式版）',
  );
  body.append(versionInfo);

  if (!available) {
    body.append(el('div', { class: 'banner info mt-3' }, [
      el('span', { html: '应用更新仅在 Android App 中可用。当前为网页端，无需单独安装更新。' }),
    ]));
    return;
  }

  const update = getAvailableUpdate();
  if (!update) {
    body.append(el('div', { class: 'settings-hint mt-2' }, [
      el('span', { html: '支持自动聚合检查 GitHub 官方发布与同局域网 Wi-Fi 设备新版本。' }),
    ]));

    // 本机为 Android 原生端时展示局域网分发服务状态
    const servingBadge = el('div', { class: 'app-update-serving-badge mt-2' });
    servingBadge.append(
      el('span', { class: 'app-update-serving-dot' }),
      el('span', { text: '本机局域网分发服务已就绪（服务端口 38473）' }),
    );
    body.append(servingBadge);

    const row = el('div', { class: 'btn-row mt-3' });
    const checkBtn = el('button', { class: 'btn', text: '检查更新' });
    checkBtn.onclick = async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = '正在检查更新...';
      try {
        const found = await checkForAppUpdates({
          onStatus: (status) => {
            checkBtn.textContent = status;
          },
        });
        if (found) {
          toast(`发现新版本 v${found.version}！`, 3000);
          setChip(panelEl, { text: `可更新 v${found.version}`, tone: 'info' });
          buildAppUpdateBody(body, panelEl, available);
        } else {
          toast(`当前已是最新版本 (v${LOCAL_APP_VERSION})`, 3500);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : '未知错误';
        toast(`检查更新失败：${msg}`, 3500);
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '检查更新';
      }
    };
    row.append(checkBtn);
    body.append(row);
    return;
  }

  // 发现可用更新：显示版本、来源、推荐方式、更新说明、操作按钮与进度条
  const updateCard = el('div', { class: 'app-update-card mt-3' });

  const updateHeader = el('div', { class: 'app-update-header' });
  const titleRow = el('div', { class: 'app-update-title-row' });
  const title = el('div', { class: 'app-update-title' });
  title.append(icon('sparkles'), '发现新版本 ', el('strong', { text: `v${update.version}` }));

  const recommendation = recommendForUpdate(update);
  // 检查阶段已判定为只能完整安装（updateType === 'full'）时，不展示秒级按钮
  const isIncremental = update.updateType === 'incremental' && recommendation.incrementalAvailable;
  const recommendFull = !isIncremental || recommendation.recommended === 'full';
  const badge = el('span', { class: 'app-update-badge', text: isIncremental ? '支持秒级更新' : '新版本' });
  titleRow.append(title, badge);

  const bundleMb = formatUpdateSizeMb(update.bundleSize);
  const fullMb = formatUpdateSizeMb(update.fileSize);
  const metaParts: string[] = [];
  if (update.source === 'lan') {
    metaParts.push(`来源：同一 Wi-Fi 下的设备 ${update.peerHost ?? ''}`.trim());
  } else if (update.source === 'github') {
    metaParts.push('来源：GitHub 官方发布');
  } else {
    metaParts.push('来源：官方更新服务');
  }
  if (isIncremental && bundleMb) metaParts.push(`秒级更新约 ${bundleMb} MB`);
  if (fullMb) metaParts.push(`完整安装包约 ${fullMb} MB`);
  const updateMeta = el('div', {
    class: 'app-update-meta',
    text: metaParts.join(' · '),
  });

  // 推荐方式 + 一句大白话理由
  const recommendRow = el('div', {
    class: `app-update-recommend ${recommendFull ? 'is-full' : 'is-incremental'}`,
    'data-recommend': recommendFull ? 'full' : 'incremental',
    'data-reason-code': isIncremental ? recommendation.code : fullOnlyCode(recommendation),
  });
  recommendRow.append(
    el('span', { class: 'app-update-recommend-tag', text: '推荐' }),
    el('span', {
      class: 'app-update-recommend-text',
      text: `${recommendFull ? (isIncremental ? '下载完整包' : '下载并安装') : '一键秒级更新'}：${
        isIncremental ? recommendation.reason : fullOnlyReason(recommendation)
      }`,
    }),
  );

  updateHeader.append(titleRow, updateMeta, recommendRow);
  updateCard.append(updateHeader);

  if (update.releaseNotes) {
    const notesBox = renderFormattedReleaseNotes(sanitizeReleaseNotesForDisplay(update.releaseNotes));
    updateCard.append(notesBox);
  }
  body.append(updateCard);

  // 下载进度容器（初始隐藏）
  const progressBox = el('div', { class: 'app-update-progress-box', style: 'display: none;' });
  const progressLabels = el('div', { class: 'app-update-progress-labels' });
  const progressText = el('span', { text: '正在下载...' });
  const progressDetail = el('span', { text: '0%' });
  progressLabels.append(progressText, progressDetail);
  const progressTrack = el('div', { class: 'app-update-progress-track' });
  const progressFill = el('div', { class: 'app-update-progress-fill' });
  progressTrack.append(progressFill);
  progressBox.append(progressLabels, progressTrack);
  body.append(progressBox);

  const row = el('div', { class: 'btn-row mt-3' });
  const allActionButtons: HTMLButtonElement[] = [];

  const setButtonsDisabled = (disabled: boolean) => {
    for (const btn of allActionButtons) {
      btn.disabled = disabled;
    }
  };

  // 全量 APK 下载安装统一执行逻辑
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
      triggerBtn.textContent = isIncremental ? '下载完整包' : '下载并安装';
      setButtonsDisabled(false);
      progressBox.style.display = 'none';
    }
  };

  // 增量秒级热更新统一执行逻辑
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
      toast(`秒级更新没有成功（${msg}），已为你改为推荐下载完整包`, 4200);
      // 记住本版本秒级更新失败：重新渲染后推荐完整包，两个按钮仍都保留
      markIncrementalFailed(update.version);
      buildAppUpdateBody(body, panelEl, available);
    } finally {
      triggerBtn.removeAttribute('aria-busy');
      triggerBtn.textContent = '一键秒级更新';
      setButtonsDisabled(false);
      progressBox.style.display = 'none';
    }
  };

  // 双通道固定保留：秒级更新可用时两个按钮都提供，推荐的那个排在前面并用主按钮样式；
  // 秒级更新不可用（底座过旧 / 没有秒级资源 / 局域网来源）时只提供完整安装。
  if (isIncremental) {
    const incrementalBtn = el('button', {
      class: recommendFull ? 'btn tonal' : 'btn',
      text: '一键秒级更新',
    }) as HTMLButtonElement;
    incrementalBtn.onclick = () => executeIncrementalInstall(incrementalBtn);
    allActionButtons.push(incrementalBtn);

    let fullBtn: HTMLButtonElement | null = null;
    if (update.downloadUrl) {
      fullBtn = el('button', {
        class: recommendFull ? 'btn' : 'btn tonal',
        text: '下载完整包',
      }) as HTMLButtonElement;
      const btn = fullBtn;
      btn.onclick = () => executeFullInstall(btn);
      allActionButtons.push(btn);
    }
    const recommendedBtn = recommendFull && fullBtn ? fullBtn : incrementalBtn;
    recommendedBtn.dataset.recommended = 'true';
    recommendedBtn.setAttribute('aria-description', '推荐');
    if (recommendFull && fullBtn) {
      row.append(fullBtn, incrementalBtn);
    } else {
      row.append(incrementalBtn, ...(fullBtn ? [fullBtn] : []));
    }
  } else {
    const fullOnlyBtn = el('button', {
      class: 'btn',
      text: '下载并安装',
    }) as HTMLButtonElement;
    fullOnlyBtn.dataset.recommended = 'true';
    fullOnlyBtn.onclick = () => executeFullInstall(fullOnlyBtn);
    allActionButtons.push(fullOnlyBtn);
    row.append(fullOnlyBtn);
  }

  const recheckBtn = el('button', { class: 'btn tonal', text: '重新检查' }) as HTMLButtonElement;
  const skipBtn = el('button', { class: 'btn tonal', text: '本次跳过' }) as HTMLButtonElement;
  allActionButtons.push(recheckBtn, skipBtn);

  recheckBtn.onclick = async () => {
    recheckBtn.disabled = true;
    recheckBtn.textContent = '检查中...';
    try {
      const found = await checkForAppUpdates({
        onStatus: (status) => {
          recheckBtn.textContent = status;
        },
      });
      if (found) {
        toast(`已刷新版本：v${found.version}`, 3000);
        setChip(panelEl, { text: `可更新 v${found.version}`, tone: 'info' });
      } else {
        clearAvailableUpdate();
        setChip(panelEl, { text: '已是最新', tone: 'ok' });
        toast('暂无更高版本');
      }
    } catch {
      toast('检查失败');
    } finally {
      recheckBtn.disabled = false;
      recheckBtn.textContent = '重新检查';
      buildAppUpdateBody(body, panelEl, available);
    }
  };

  skipBtn.onclick = () => {
    clearAvailableUpdate();
    toast('已跳过本次更新');
    setChip(panelEl, { text: '已是最新', tone: 'ok' });
    buildAppUpdateBody(body, panelEl, available);
  };

  body.append(row);
}
