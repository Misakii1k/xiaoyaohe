// AI 服务商编辑器：新增/编辑一家 OpenAI 兼容供应商。
// 独立成模块是因为设置页的架构契约禁止出现 openDialog/closeDialog 等标识符。
import { el, toast, openDialog, closeDialog, type IconName } from './components';
import { grantBatchConsent } from '../ai/consent';
import {
  createLlmProviderId,
  DEFAULT_LLM_CONFIG,
  getLlmHealth,
  listModels,
  normalizeAndValidateBaseUrl,
  type LlmProvider,
} from '../ai/llmConfig';

let settingsFieldSeq = 0;

function field(label: string, input: HTMLElement): HTMLElement {
  const f = el('div', { class: 'field' });
  const control = input.matches('input,select,textarea')
    ? input
    : input.querySelector<HTMLElement>('input,select,textarea');
  const labelEl = el('label', { html: label });
  if (control) {
    const id = control.id || `llm-provider-field-${++settingsFieldSeq}`;
    control.id = id;
    if (!control.getAttribute('name')) control.setAttribute('name', id);
    labelEl.htmlFor = id;
  }
  f.append(labelEl);
  f.append(input);
  return f;
}

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
  if (!has && current) sel.value = current;
}

function getCurrentModel(sel: HTMLSelectElement, input: HTMLInputElement): string {
  if (sel.style.display !== 'none') return sel.value.trim();
  return input.value.trim();
}

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
    placeholder: '服务商名称，如 DeepSeek',
  });
  const urlIn = el('input', {
    type: 'url',
    value: existing?.baseUrl ?? '',
    placeholder: 'OpenAI 兼容地址，如 https://api.deepseek.com/v1',
  });
  const keyWrap = el('div', { style: 'position:relative' });
  const keyIn = el('input', {
    class: 'secret-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: false,
    spellcheck: false,
    value: existing?.apiKey ?? '',
    placeholder: 'sk-...',
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
  const modelField = field('模型', modelRow);
  const modelLabel = modelField.querySelector<HTMLLabelElement>('label')!;

  const statusBar = el('div', { class: 'llm-status' });
  populateModelControl(modelSel, modelIn, modelLabel, existing ? getLlmHealth(existing.id).models : [], existing?.model ?? '');
  statusBar.replaceChildren(el('span', { class: 'muted', html: '点「刷新」自动拉取模型列表；拉不到就手填模型名。' }));

  refreshBtn.onclick = async () => {
    refreshBtn.setAttribute('disabled', 'true');
    refreshBtn.textContent = '检测中…';
    const baseUrl = urlIn.value.trim();
    const apiKey = keyIn.value.trim();
    try {
      normalizeAndValidateBaseUrl(baseUrl);
      if (!apiKey) throw new Error('请先填 API 密钥');
      const models = await listModels({ baseUrl, apiKey, model: getCurrentModel(modelSel, modelIn) || DEFAULT_LLM_CONFIG.model });
      populateModelControl(modelSel, modelIn, modelLabel, models, getCurrentModel(modelSel, modelIn));
      statusBar.replaceChildren(el('span', { class: 'banner ok', html: `已连接 · ${models.length} 个模型` }));
    } catch (e) {
      statusBar.replaceChildren(el('span', { class: 'banner warn', html: '拉模型失败：' + (e instanceof Error ? e.message : String(e)) }));
    } finally {
      refreshBtn.removeAttribute('disabled');
      refreshBtn.textContent = '刷新';
    }
  };

  card.append(
    el('div', { class: 'big', text: existing ? `编辑「${existing.label}」` : '添加服务商', id: titleId }),
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
    const baseUrl = urlIn.value.trim();
    const apiKey = keyIn.value.trim();
    const model = getCurrentModel(modelSel, modelIn);
    try {
      normalizeAndValidateBaseUrl(baseUrl);
      if (!label) throw new Error('请填写服务商名称');
      if (!apiKey) throw new Error('请填写 API 密钥');
      if (!model) throw new Error('请填写或选择模型');
      // 一次批量同意：保存即确认把用药/对话数据发给这些服务商，后续不再逐个询问。
      const granted = await grantBatchConsent([baseUrl], '授权会保留给这些服务商；可在设置中随时撤销。');
      if (!granted) return;
      await onSave({ id: existing?.id ?? createLlmProviderId(), label, baseUrl, apiKey, model });
      close();
      toast('已保存 ✓');
    } catch (e) {
      toast('保存失败：' + (e instanceof Error ? e.message : String(e)));
    }
  };
  overlay = openDialog(card, { labelId: titleId });
}

// re-export 类型仅供类型检查使用，避免在调用方重复定义。
export type { IconName };
