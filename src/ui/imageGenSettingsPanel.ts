import { el, icon, toast, confirmDialog, promptDialog } from './components';
import { enhanceSelect } from './primitives/Pickers';
import {
  getImageGenConfig,
  setImageGenConfig,
  getEffectiveImageGenConfig,
  getSavedImageGenProfiles,
  saveImageGenProfile,
  deleteImageGenProfile,
  pingImageGenService,
  getActiveLlmProvider,
  type ImageGenEndpointMode,
} from '../ai/llmConfig';

export interface ImageGenPanelResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderImageGenSettingsPanel(): ImageGenPanelResult {
  let panelSeq = 0;
  const wrap = el('div', { class: 'panel' });
  const head = el('button', { class: 'panel-head', type: 'button' });
  const bodyId = `settings-panel-image-gen-${++panelSeq}`;
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', bodyId);

  const lead = el('span', { class: 'panel-lead' });
  const iconWrap = el('span', { class: 'panel-icon panel-icon-rose' });
  iconWrap.append(icon('image'));
  lead.append(iconWrap, el('span', { class: 'panel-title', text: 'AI 生图服务商' }));
  head.append(lead);

  const right = el('span', { class: 'panel-right' });
  const chip = el('span', { class: 'panel-chip tone-muted', text: '检测中' });
  const chevron = el('span', { class: 'panel-chevron' });
  chevron.append(icon('chevron-right'));
  right.append(chip, chevron);
  head.append(right);

  const body = el('div', { class: 'panel-body', id: bodyId });
  body.hidden = true;

  head.onclick = () => {
    const open = wrap.classList.toggle('open');
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  };

  wrap.append(head, body);

  function refreshChip(): void {
    const eff = getEffectiveImageGenConfig();
    if (!eff.enabled) {
      chip.className = 'panel-chip tone-muted';
      chip.textContent = '已停用';
      return;
    }
    if (!eff.isConfigured) {
      chip.className = 'panel-chip tone-muted';
      chip.textContent = '未配置';
      return;
    }
    if (eff.isDerivedFromMain) {
      chip.className = 'panel-chip tone-ok';
      chip.textContent = '复用主服务商';
      return;
    }
    chip.className = 'panel-chip tone-ok';
    chip.textContent = '独立配置';
  }

  function renderContent(): void {
    body.replaceChildren();
    const current = getImageGenConfig();
    const effective = getEffectiveImageGenConfig();

    const desc = el('div', {
      class: 'muted',
      text: '在「编辑药品」拍照后，后台生成高清纯白底药盒图。同时支持 /images/edits（原图修图高保真）与 /images/generations（文生商业大图）双接口与自动平滑回退。',
    });

    // 1. 开关行
    const toggleRow = el('div', { class: 'settings-toggle-row' });
    const toggleCopy = el('div', { class: 'settings-toggle-copy' });
    toggleCopy.append(
      el('div', { class: 'settings-toggle-title', text: '启用药盒照片增强' }),
      el('div', {
        class: 'settings-toggle-desc',
        text: '拍照后自动排队增强照片；增强后可在原照片与增强图之间随时切换。',
      }),
    );
    const toggleSwitch = el('input', {
      type: 'checkbox',
      role: 'switch',
      'aria-label': '启用药盒照片增强',
    }) as HTMLInputElement;
    toggleSwitch.checked = current.enabled;
    toggleRow.append(toggleCopy, toggleSwitch);

    // 2. 表单输入区
    const formWrap = el('div', { class: 'image-gen-form' });
    if (!current.enabled) {
      formWrap.style.opacity = '0.5';
      formWrap.style.pointerEvents = 'none';
    }

    const card = el('div', { class: 'settings-subcard' });
    const cardHead = el('div', { class: 'settings-subcard-header' });
    const titleWrap = el('div', { class: 'settings-subcard-title-wrap' });
    titleWrap.append(el('div', { class: 'settings-subcard-title', text: '药盒照片增强配置' }));
    const cardBadge = el('span', {
      class: 'settings-subcard-badge',
      style: current.enabled
        ? 'background: rgba(244, 63, 94, 0.12); color: #e11d48;'
        : 'background: rgba(0, 0, 0, 0.05); color: var(--color-text-muted);',
      text: current.enabled ? '已启用' : '未开启',
    });
    cardHead.append(titleWrap, cardBadge);
    card.append(cardHead, toggleRow, formWrap);
    body.append(card);

    toggleSwitch.onchange = async () => {
      const next = { ...getImageGenConfig(), enabled: toggleSwitch.checked };
      await setImageGenConfig(next);
      refreshChip();
      renderContent();
      toast(next.enabled ? '已开启 AI 药盒照片增强' : '已关闭 AI 照片增强功能');
    };

    // BaseURL
    const urlField = el('div', { class: 'field' });
    const urlLabel = el('label', { text: '生图 API 地址（Base URL）' });
    const urlInput = el('input', {
      type: 'url',
      class: 'input',
      placeholder: effective.baseUrl ? `留空自动复用：${effective.baseUrl}` : 'https://api.openai.com/v1',
      value: current.baseUrl,
    }) as HTMLInputElement;
    const urlHint = el('div', {
      class: 'muted text-xs mt-1',
      text: '留空时自动复用「AI 服务商」的地址。支持 OpenAI 格式及各类中转生图接口。',
    });
    urlField.append(urlLabel, urlInput, urlHint);

    // API Key
    const keyField = el('div', { class: 'field mt-2' });
    const keyLabel = el('label', { text: '生图 API 密钥（API Key）' });
    const keyInput = el('input', {
      type: 'text',
      class: 'input secret-input',
      autocomplete: 'off',
      autocapitalize: 'none',
      spellcheck: false,
      placeholder: effective.apiKey ? '留空自动复用当前主 AI 密钥' : 'sk-...',
      value: current.apiKey,
    }) as HTMLInputElement;
    const keyHint = el('div', {
      class: 'muted text-xs mt-1',
      text: '留空时自动复用主 AI 服务商的密钥；若使用专用生图网关，可单独填写。',
    });
    keyField.append(keyLabel, keyInput, keyHint);

    // 生图模型名
    const modelField = el('div', { class: 'field mt-2' });
    const modelLabel = el('label', { text: '生图模型名称（Image Model）' });
    const modelInput = el('input', {
      type: 'text',
      class: 'input',
      placeholder: '例如：agnes-image-2.1-flash、gpt-image-1、dall-e-3',
      value: current.model || 'gpt-image-1',
    }) as HTMLInputElement;
    modelField.append(modelLabel, modelInput);

    // 接口模式选项：auto / edits / generations
    const modeField = el('div', { class: 'field mt-2' });
    const modeLabel = el('label', { text: '生图接口模式' });
    const modeSelect = el('select', { class: 'input' }) as HTMLSelectElement;

    const modes: Array<{ value: ImageGenEndpointMode; label: string; desc: string }> = [
      {
        value: 'auto',
        label: '自动推荐（有图优先修图，不支持自动转文生图）',
        desc: '有拍摄照片时优先调用修图/图生图接口；若服务商不支持则平滑回退至文生大图。',
      },
      {
        value: 'edits',
        label: '仅原图修图（/images/edits）',
        desc: '严格使用图片编辑接口对原照片进行白底化与清晰度增强，100% 保真原图文字。',
      },
      {
        value: 'generations',
        label: '仅文生大图（/images/generations）',
        desc: '严格使用标准文生图接口生成商业展台大图，兼容几乎所有 OpenAI 格式生图服务商。',
      },
    ];

    modes.forEach((m) => {
      const opt = el('option', { value: m.value, text: m.label }) as HTMLOptionElement;
      opt.selected = (current.endpointMode || 'auto') === m.value;
      modeSelect.append(opt);
    });

    const modeHint = el('div', { class: 'muted text-xs mt-1' });
    function updateModeHint(val: string): void {
      const found = modes.find((m) => m.value === val);
      modeHint.textContent = found ? found.desc : '';
    }
    updateModeHint(current.endpointMode || 'auto');

    modeSelect.onchange = () => {
      updateModeHint(modeSelect.value);
    };

    modeField.append(modeLabel, modeSelect, modeHint);
    const modeControl = enhanceSelect(modeSelect, { ariaLabel: '生图接口模式' });

    // 已保存自定义配置列表区
    const profilesField = el('div', { class: 'field mt-2' });
    const profilesLabel = el('div', {
      class: 'muted text-xs mb-1 font-medium',
      text: '已保存的生图配置（点击快速载入）：',
    });
    const profilesChips = el('div', { class: 'chips', style: 'flex-wrap: wrap; gap: 6px;' });
    profilesField.append(profilesLabel, profilesChips);

    function refreshProfilesList(): void {
      profilesChips.replaceChildren();
      const list = getSavedImageGenProfiles();
      if (list.length === 0) {
        profilesChips.append(
          el('span', {
            class: 'muted text-xs',
            text: '暂无已保存配置。填写好表单后点击下方「存为新配置」即可保存。',
          }),
        );
        return;
      }

      list.forEach((p) => {
        const pill = el('div', {
          class: 'chip sm',
          style: 'display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px;',
        });
        const nameBtn = el('button', {
          type: 'button',
          style: 'background: none; border: none; padding: 0; color: inherit; font: inherit; cursor: pointer;',
          text: `${p.name} (${p.model})`,
          title: `点击载入「${p.name}」配置`,
        });
        nameBtn.onclick = () => {
          if (p.baseUrl) urlInput.value = p.baseUrl;
          if (p.apiKey) keyInput.value = p.apiKey;
          modelInput.value = p.model;
          modeSelect.value = p.endpointMode;
          modeControl.refresh();
          updateModeHint(p.endpointMode);
          toast(`已载入配置「${p.name}」`);
        };

        const delBtn = el('button', {
          type: 'button',
          style: 'background: none; border: none; padding: 0 2px; color: inherit; opacity: 0.55; cursor: pointer; font-size: 13px; line-height: 1;',
          title: `删除「${p.name}」`,
          text: '×',
        });
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          const confirmed = await confirmDialog(`确定删除生图配置「${p.name}」吗？`, '删除', true);
          if (confirmed) {
            await deleteImageGenProfile(p.id);
            refreshProfilesList();
            toast(`已删除配置「${p.name}」`);
          }
        };

        pill.append(nameBtn, delBtn);
        profilesChips.append(pill);
      });
    }

    refreshProfilesList();

    // 操作按钮（2列响应式网格，杜绝按钮文案折行挤压）
    const btnRow = el('div', {
      class: 'image-gen-actions mt-3',
      style: 'display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;' as any,
    });
    const saveBtn = el('button', { class: 'btn', type: 'button', text: '保存当前配置' });
    const saveProfileBtn = el('button', { class: 'btn tonal', type: 'button', text: '存为新配置' });
    const testBtn = el('button', { class: 'btn tonal', type: 'button', text: '测试生图连接' });
    const copyMainBtn = el('button', { class: 'btn tonal', type: 'button', text: '从主服务商复制' });

    saveProfileBtn.onclick = async () => {
      const defaultName = modelInput.value.trim() || '自定义配置';
      const name = await promptDialog({
        title: '存为新配置',
        message: '请输入该生图配置的名称（如：Agnes 2.1、中转生图等）：',
        defaultValue: defaultName,
        placeholder: '配置名称',
        okText: '保存',
      });
      if (!name || !name.trim()) return;

      try {
        await saveImageGenProfile({
          name: name.trim(),
          baseUrl: urlInput.value.trim(),
          apiKey: keyInput.value.trim(),
          model: modelInput.value.trim() || 'gpt-image-1',
          endpointMode: (modeSelect.value as ImageGenEndpointMode) || 'auto',
        });
        refreshProfilesList();
        toast(`配置「${name.trim()}」已保存`);
      } catch (err) {
        toast('保存配置失败：' + String(err instanceof Error ? err.message : err));
      }
    };

    copyMainBtn.onclick = () => {
      const main = getActiveLlmProvider();
      if (!main.baseUrl && !main.apiKey) {
        toast('主服务商尚未配置');
        return;
      }
      urlInput.value = main.baseUrl;
      keyInput.value = main.apiKey;
      toast('已填入当前主 AI 服务商的地址与密钥');
    };

    testBtn.onclick = async () => {
      testBtn.disabled = true;
      testBtn.textContent = '测试中…';
      try {
        const testCfg = {
          enabled: true,
          baseUrl: urlInput.value.trim(),
          apiKey: keyInput.value.trim(),
          model: modelInput.value.trim() || 'gpt-image-1',
          endpointMode: (modeSelect.value as ImageGenEndpointMode) || 'auto',
        };
        const res = await pingImageGenService(testCfg);
        if (res.state === 'ok') {
          toast(`连接成功：${res.message}`);
          chip.className = 'panel-chip tone-ok';
          chip.textContent = '已连接';
        } else {
          toast(`连接失败：${res.message}`);
          chip.className = 'panel-chip tone-warn';
          chip.textContent = '不通';
        }
      } catch (e) {
        toast('测试出错：' + String(e instanceof Error ? e.message : e));
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = '测试生图连接';
      }
    };

    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      try {
        const next = {
          enabled: toggleSwitch.checked,
          baseUrl: urlInput.value.trim(),
          apiKey: keyInput.value.trim(),
          model: modelInput.value.trim() || 'gpt-image-1',
          endpointMode: (modeSelect.value as ImageGenEndpointMode) || 'auto',
        };
        await setImageGenConfig(next);
        refreshChip();
        toast('AI 生图配置已保存');
      } catch (e) {
        toast('保存失败：' + String(e instanceof Error ? e.message : e));
      } finally {
        saveBtn.disabled = false;
      }
    };

    btnRow.append(saveBtn, saveProfileBtn, testBtn, copyMainBtn);
    formWrap.append(profilesField, urlField, keyField, modelField, modeField, btnRow);

    body.append(desc, toggleRow, formWrap);
  }

  refreshChip();
  renderContent();

  return {
    element: wrap,
    cleanup: () => {
      // no background listeners needed
    },
  };
}
