import { el, icon, toast } from './components';
import {
  getImageGenConfig,
  setImageGenConfig,
  getEffectiveImageGenConfig,
  pingImageGenService,
  getActiveLlmProvider,
} from '../ai/llmConfig';

export interface ImageGenPanelResult {
  element: HTMLElement;
  cleanup: () => void;
}

const PRESET_MODELS = [
  { label: 'GPT Image 1 (OpenAI, 推荐)', model: 'gpt-image-1' },
  { label: 'DALL·E 2 (OpenAI, 支持 edits)', model: 'dall-e-2' },
  { label: '通义万相 (阿里)', model: 'wanx-v1' },
  { label: 'CogView-3 (智谱)', model: 'cogview-3-plus' },
];

export function renderImageGenSettingsPanel(): ImageGenPanelResult {
  let panelSeq = 0;
  const wrap = el('div', { class: 'panel' });
  const head = el('button', { class: 'panel-head', type: 'button' });
  const bodyId = `settings-panel-image-gen-${++panelSeq}`;
  head.setAttribute('aria-expanded', 'false');
  head.setAttribute('aria-controls', bodyId);

  const lead = el('span', { class: 'panel-lead' });
  lead.append(icon('image', 'panel-icon'));
  lead.append(el('span', { class: 'panel-title', text: 'AI 生图服务商' }));
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
      text: '在「编辑药品」拍照后，后台将药盒照片增强为纯白底、清晰、透视矫正的扫描效果图。需要支持 /images/edits 接口的服务商（如 GPT Image 系列）。',
    });

    // 1. 开关行
    const toggleRow = el('div', { class: 'settings-toggle-row mt-3' });
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
    const formWrap = el('div', { class: 'image-gen-form mt-3' });
    if (!current.enabled) {
      formWrap.style.opacity = '0.5';
      formWrap.style.pointerEvents = 'none';
    }

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
      text: '留空时自动复用「AI 服务商」的地址。需支持 OpenAI 兼容的 /images/edits 接口。',
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

    // 生图模型名 + 预设胶囊
    const modelField = el('div', { class: 'field mt-2' });
    const modelLabel = el('label', { text: '生图模型名称（Image Model）' });
    const modelInput = el('input', {
      type: 'text',
      class: 'input',
      placeholder: '例如：gpt-image-1、dall-e-2',
      value: current.model || 'gpt-image-1',
    }) as HTMLInputElement;

    const presetChipsWrap = el('div', { class: 'chips mt-2', style: 'flex-wrap: wrap; gap: 6px;' });
    PRESET_MODELS.forEach((preset) => {
      const chipBtn = el('button', {
        class: 'chip sm',
        type: 'button',
        text: preset.label,
      });
      chipBtn.onclick = () => {
        modelInput.value = preset.model;
        toast(`已选择模型：${preset.model}`);
      };
      presetChipsWrap.append(chipBtn);
    });
    modelField.append(modelLabel, modelInput, presetChipsWrap);

    // 操作按钮
    const btnRow = el('div', { class: 'btn-row mt-3' });
    const saveBtn = el('button', { class: 'btn', type: 'button', text: '保存配置' });
    const testBtn = el('button', { class: 'btn tonal', type: 'button', text: '测试生图连接' });
    const copyMainBtn = el('button', { class: 'btn tonal', type: 'button', text: '从主服务商复制' });

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
        };
        await setImageGenConfig(next);
        refreshChip();
        toast('AI 照片增强配置已保存');
      } catch (e) {
        toast('保存失败：' + String(e instanceof Error ? e.message : e));
      } finally {
        saveBtn.disabled = false;
      }
    };

    btnRow.append(saveBtn, testBtn, copyMainBtn);
    formWrap.append(urlField, keyField, modelField, btnRow);

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
