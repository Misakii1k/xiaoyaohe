// AI 服务商编辑器：新增/编辑一家 OpenAI 兼容供应商。
// 独立成模块是因为设置页的架构契约禁止出现 openDialog/closeDialog 等标识符。
import { el, toast, openDialog, closeDialog, field, type IconName } from './components';
import { grantBatchConsent } from '../ai/consent';
import { enhanceSelect } from './primitives/Pickers';
import {
  createLlmProviderId,
  DEFAULT_LLM_CONFIG,
  getLlmHealth,
  listModels,
  normalizeAndValidateBaseUrl,
  type LlmProvider,
} from '../ai/llmConfig';

let settingsFieldSeq = 0;

function populateModelControl(
  sel: HTMLSelectElement,
  input: HTMLInputElement,
  label: HTMLLabelElement,
  models: string[] | undefined,
  current: string,
): void {
  const list = models || [];
  if (list.length === 0) {
    sel.style.display = 'none';
    input.style.display = '';
    label.htmlFor = input.id;
    if (current) input.value = current;
    return;
  }
  sel.style.display = '';
  input.style.display = 'none';
  label.htmlFor = sel.id;
  sel.replaceChildren();
  const has = list.includes(current);
  if (!has && current) {
    const op = el('option', { value: current, html: current + '（自定义）' });
    sel.append(op);
  }
  for (const m of list) {
    const op = el('option', { value: m, html: m });
    if (m === current) op.selected = true;
    sel.append(op);
  }
  const manualOp = el('option', { value: '__manual__', html: '✎ 手动输入自定义模型…' });
  sel.append(manualOp);
  if (!has && current) sel.value = current;

  sel.onchange = () => {
    if (sel.value === '__manual__') {
      sel.style.display = 'none';
      input.style.display = '';
      label.htmlFor = input.id;
      input.value = current === '__manual__' ? '' : current;
      input.focus();
    }
  };
}

function getCurrentModel(sel: HTMLSelectElement, input: HTMLInputElement): string {
  if (sel.style.display !== 'none') return sel.value.trim();
  return input.value.trim();
}

export interface LlmPresetTemplate {
  name: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  keyPlaceholder?: string;
  hint?: string;
}

export const LLM_PRESETS: readonly LlmPresetTemplate[] = [
  {
    name: 'DeepSeek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '通义千问',
    label: '通义千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    keyPlaceholder: 'sk-...',
  },
  {
    name: 'Kimi',
    label: '月之暗面 (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '硅基流动',
    label: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    keyPlaceholder: 'sk-...',
  },
  {
    name: '智谱 GLM',
    label: '智谱 AI (GLM)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    keyPlaceholder: 'sk-...',
  },
  {
    name: 'Ollama 本地',
    label: 'Ollama 本地大模型',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
    keyPlaceholder: '无需密钥 (可填 ollama)',
    hint: '本地私密运行，支持局域网或本机 Ollama 服务',
  },
  {
    name: '微信云开放平台',
    label: '微信云开放平台',
    baseUrl: 'https://chatapi.weixin.qq.com/openai/v1',
    defaultModel: 'deepseek-chat',
    keyPlaceholder: 'bt1Pugg... 或任意 Token',
    hint: '微信开放平台第三方 OpenAI 兼容 API',
  },
  {
    name: 'OpenRouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat',
    keyPlaceholder: 'sk-or-...',
  },
];

/** 新增或编辑一家服务商；保存前先拉一次模型列表，失败可手填。 */
export function openLlmProviderEditor(
  existing: LlmProvider | undefined,
  onSave: (draft: LlmProvider) => Promise<void>,
): void {
  const seq = ++settingsFieldSeq;
  const titleId = `llm-provider-title-${seq}`;
  const card = el('div', { class: 'card llm-provider-editor' });

  const labelIn = el('input', {
    type: 'text',
    value: existing?.label ?? '',
    placeholder: '服务商名称，如 DeepSeek 或 微信开放平台',
  });
  const urlIn = el('input', {
    type: 'url',
    value: existing?.baseUrl ?? '',
    placeholder: 'OpenAI 兼容地址，如 https://api.deepseek.com/v1',
  });
  urlIn.onblur = () => {
    const raw = urlIn.value.trim();
    if (!raw) return;
    try {
      urlIn.value = normalizeAndValidateBaseUrl(raw);
    } catch {
      // 格式问题留给刷新/保存时统一抛出提示
    }
  };
  const keyWrap = el('div', { style: 'position:relative' });
  const keyIn = el('input', {
    class: 'secret-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: false,
    spellcheck: false,
    value: existing?.apiKey ?? '',
    placeholder: 'sk-... 或任意第三方 Token / 访问密钥',
    style: 'padding-right:64px',
  });
  const toggleKey = el('button', { class: 'key-toggle', type: 'button', html: '显示' });
  let visible = false;
  toggleKey.onclick = () => {
    visible = !visible;
    keyIn.classList.toggle('is-visible', visible);
    toggleKey.textContent = visible ? '隐藏' : '显示';
  };
  keyWrap.append(keyIn, toggleKey);

  const modelRow = el('div', { class: 'model-row' });
  const modelSel = el('select', { class: 'model-select' });
  const modelIn = el('input', {
    type: 'text',
    value: existing?.model ?? '',
    placeholder: '模型名，如 deepseek-chat',
    style: 'display:none',
  });
  const refreshBtn = el('button', { class: 'btn tonal small', type: 'button', html: '刷新' });
  modelSel.id = `settings-provider-model-select-${seq}`;
  modelSel.name = modelSel.id;
  modelIn.id = `settings-provider-model-input-${seq}`;
  modelIn.name = modelIn.id;
  modelRow.append(modelSel, modelIn, refreshBtn);
  // 模型列表用自绘下拉；select 本身仍由 populateModelControl 维护
  enhanceSelect(modelSel, { ariaLabel: '选择模型', className: 'model-select' });
  const modelField = field('模型', modelRow);
  const modelLabel = modelField.querySelector<HTMLLabelElement>('label')!;

  const statusBar = el('div', { class: 'llm-status' });
  populateModelControl(modelSel, modelIn, modelLabel, existing ? getLlmHealth(existing.id).models : [], existing?.model ?? '');
  statusBar.replaceChildren(el('span', { class: 'muted', html: '点「刷新」自动拉取模型列表；拉不到就手填模型名。' }));

  const presetWrapper = el('div', { class: 'llm-preset-wrap' });
  presetWrapper.append(el('div', { class: 'llm-preset-label', text: '快捷预设模板：' }));
  const presetChips = el('div', { class: 'llm-preset-chips' });
  for (const preset of LLM_PRESETS) {
    const chip = el('button', {
      class: 'llm-preset-chip',
      type: 'button',
      text: preset.name,
      title: `快速填入 ${preset.label} 配置`,
    });
    chip.onclick = () => {
      labelIn.value = preset.label;
      urlIn.value = preset.baseUrl;
      modelIn.value = preset.defaultModel;
      if (preset.keyPlaceholder && !keyIn.value) {
        keyIn.placeholder = preset.keyPlaceholder;
      }
      if (preset.name === 'Ollama 本地' && !keyIn.value) {
        keyIn.value = 'ollama';
      }
      populateModelControl(modelSel, modelIn, modelLabel, [preset.defaultModel], preset.defaultModel);
      keyIn.focus();
      toast(`已填入 ${preset.name} 预设`);
    };
    presetChips.append(chip);
  }
  presetWrapper.append(presetChips);

  refreshBtn.onclick = async () => {
    refreshBtn.setAttribute('disabled', 'true');
    refreshBtn.textContent = '检测中…';
    const rawUrl = urlIn.value.trim();
    const apiKey = keyIn.value.trim();
    try {
      const baseUrl = normalizeAndValidateBaseUrl(rawUrl);
      urlIn.value = baseUrl;
      if (!apiKey) throw new Error('请先填 API 密钥');
      const models = await listModels({ baseUrl, apiKey, model: getCurrentModel(modelSel, modelIn) || DEFAULT_LLM_CONFIG.model });
      populateModelControl(modelSel, modelIn, modelLabel, models, getCurrentModel(modelSel, modelIn));
      statusBar.replaceChildren(el('span', { class: 'banner ok', html: `已连接 · ${models.length} 个模型` }));
    } catch (e) {
      // 容错：许多第三方或微信开放平台反代未开放 /models 端点，自动切换为手填模式并给出明确提示
      const cur = getCurrentModel(modelSel, modelIn);
      populateModelControl(modelSel, modelIn, modelLabel, [], cur);
      statusBar.replaceChildren(
        el('span', {
          class: 'banner warn',
          html: '未能拉取模型（部分第三方未开放 /models 端点，可直接手填模型名）：' + (e instanceof Error ? e.message : String(e)),
        }),
      );
    } finally {
      refreshBtn.removeAttribute('disabled');
      refreshBtn.textContent = '刷新';
    }
  };

  card.append(
    el('div', { class: 'big', text: existing ? `编辑「${existing.label}」` : '添加服务商', id: titleId }),
    presetWrapper,
    field('服务商名称', labelIn),
    field('API 地址', urlIn),
    field('API 密钥', keyWrap),
    modelField,
    statusBar,
  );

  const actions = el('div', { style: 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap' } as any);
  const cancelBtn = el('button', { class: 'btn text', html: '取消' });
  const saveBtn = el('button', { class: 'btn', html: '保存' });
  actions.append(cancelBtn, saveBtn);
  card.append(actions);

  let overlay: HTMLElement | null = null;
  const close = () => { if (overlay) closeDialog(overlay); };
  cancelBtn.onclick = close;
  saveBtn.onclick = async () => {
    const label = labelIn.value.trim();
    const rawUrl = urlIn.value.trim();
    const apiKey = keyIn.value.trim();
    const model = getCurrentModel(modelSel, modelIn);
    try {
      const baseUrl = normalizeAndValidateBaseUrl(rawUrl);
      urlIn.value = baseUrl;
      if (!label) throw new Error('请填写服务商名称');
      if (!apiKey) throw new Error('请填写 API 密钥');
      if (!model) throw new Error('请填写或选择模型');
      // 一次批量同意：保存即确认把用药/对话数据发给这些服务商，后续不再逐个询问。
      const granted = await grantBatchConsent([baseUrl], '授权会保留给这些服务商；可在设置中随时撤销。');
      if (!granted) return;
      await onSave({ id: existing?.id ?? createLlmProviderId(), label, baseUrl, apiKey, model });
      close();
      toast('已保存');
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };
  overlay = openDialog(card, { labelId: titleId });
}

// re-export 类型仅供类型检查使用，避免在调用方重复定义。
export type { IconName };
