// 全局小助手入口：右下角悬浮按钮 + 底部聊天面板。
// 挂在 document.body 上，路由切换不销毁，不挡各页面自己的操作。
import { el, icon, confirmDialog, toast, makeAppInert, restoreAppAfterLastDialog, trapFocusIn } from './components';
import { navigate } from '../router';
import {
  AssistantError,
  runAssistantTurn,
  type AssistantAttachment,
  type AssistantContentBlock,
  type AssistantTurnResult,
  type AssistantExchange,
} from '../ai/assistant';
import { getLlmConfig, getActiveLlmProvider, getLlmHealth, pingLlm, setLlmHealth } from '../ai/llmConfig';
import {
  getAssistantPrefs,
  onAssistantPrefsChange,
  setAssistantModelOverride,
  setAssistantReasoningEffort,
  type AssistantReasoningEffort,
} from '../ai/assistantPrefs';
import { appendAssistantMessage, clearAssistantMessages, listRecentAssistantMessages, uid } from '../db/local';
import { createButton } from './primitives/Button';
import { compressBoxPhoto } from '../features/medPhotos';

type AssistantContentModule = typeof import('./assistantContent');
let assistantContentModule: AssistantContentModule | null = null;
let assistantContentLoading: Promise<AssistantContentModule> | null = null;

function loadAssistantContent(): Promise<AssistantContentModule> {
  assistantContentLoading ??= import('./assistantContent')
    .then((module) => {
      assistantContentModule = module;
      return module;
    })
    .catch((error: unknown) => {
      assistantContentLoading = null;
      throw error;
    });
  return assistantContentLoading;
}

function renderAssistantMarkdown(text: string): HTMLElement {
  if (assistantContentModule) return assistantContentModule.renderAssistantMarkdown(text);
  const fallback = el('div', { class: 'ai-markdown' }, [el('p', { class: 'ai-md-p', text })]);
  void loadAssistantContent()
    .then((module) => {
      if (fallback.isConnected) fallback.replaceWith(module.renderAssistantMarkdown(text));
    })
    .catch(() => undefined);
  return fallback;
}

const GREETING = '你好呀，我是小助手。想知道今天吃什么药、最近是否按时，或者查看药品库存，直接说就行。也能拍照、发文件。';
const QUICK_PROMPTS = [
  '今天我要吃什么药？',
  '排查当前用药相互作用与禁忌',
  '帮我从处方单/清单批量录入药品',
  '最近一周吃药按时吗？',
  '哪些药快吃完了？',
  '打开药品库存',
];

/** 文本附件最多带入模型的字数，避免一次塞整本书 */
const MAX_TEXT_EXCERPT = 12_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const history: AssistantExchange[] = [];
let mounted = false;
let globalOpenPanel: (() => void) | null = null;

/** 一轮对话成功后落库：user/assistant 各一条；附件不入库，与内存 history 保持一致。 */
function persistExchange(userText: string, reply: AssistantTurnResult): void {
  const base = Date.now();
  void appendAssistantMessage({ id: uid(), role: 'user', content: userText, createdAt: base })
    .then(() => appendAssistantMessage({
      id: uid(),
      role: 'assistant',
      content: reply.markdown,
      blocks: reply.blocks,
      createdAt: base + 1,
    }))
    .catch(() => { /* 持久化失败不影响当前对话 */ });
}

async function fileToAttachment(file: File): Promise<AssistantAttachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('文件太大了，请选 8MB 以内的');
  }
  // 图片类（普通照片、处方长图、化验单截屏）
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(file.name)) {
    const compressed = await compressBoxPhoto(file);
    const dataUrl = await blobToDataUrl(compressed);
    return { kind: 'image', name: file.name || '照片.jpg', mime: compressed.type || 'image/jpeg', dataUrl };
  }
  // 表格类：CSV / TSV / 表格文本自动转清晰的 Markdown 表格
  if (/\.(csv|tsv|tab)$/i.test(file.name) || file.type.includes('csv')) {
    const raw = await file.text();
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    let formatted = raw;
    if (lines.length > 0) {
      const delimiter = file.name.endsWith('.tsv') || file.name.endsWith('.tab') ? '\t' : ',';
      const tableRows = lines.slice(0, 120).map((l) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, '')));
      if (tableRows.length > 0 && tableRows[0]) {
        const header = '| ' + tableRows[0].join(' | ') + ' |';
        const divider = '| ' + tableRows[0].map(() => '---').join(' | ') + ' |';
        const rows = tableRows.slice(1).map((r) => '| ' + r.join(' | ') + ' |').join('\n');
        formatted = `${header}\n${divider}\n${rows}`;
      }
    }
    const textExcerpt = formatted.slice(0, MAX_TEXT_EXCERPT);
    return {
      kind: 'file',
      name: file.name || '药品清单.csv',
      mime: 'text/csv',
      textExcerpt: formatted.length > MAX_TEXT_EXCERPT ? `${textExcerpt}\n…（表格已截断）` : textExcerpt,
    };
  }
  // PDF 电子病历/处方单/检验报告：提取文本流
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const textDecoder = new TextDecoder('utf-8', { fatal: false });
    const decoded = textDecoder.decode(bytes);
    const matches = decoded.match(/\(([^)]+)\)\s*(?:Tj|'|")/g) || [];
    const textChunks: string[] = [];
    for (const m of matches) {
      const clean = m.replace(/[()Tj'"]/g, '').trim();
      if (clean.length > 0) textChunks.push(clean);
    }
    let extracted = textChunks.join(' ');
    if (!extracted.trim() || extracted.length < 20) {
      extracted = `[电子文档: ${file.name}，文件大小: ${Math.round(file.size / 1024)} KB。若包含扫描图片处方，建议拍照或发截图供视觉模型识别]`;
    }
    const textExcerpt = extracted.slice(0, MAX_TEXT_EXCERPT);
    return {
      kind: 'file',
      name: file.name || '电子处方病历.pdf',
      mime: 'application/pdf',
      textExcerpt: extracted.length > MAX_TEXT_EXCERPT ? `${textExcerpt}\n…（已截断）` : textExcerpt,
    };
  }
  // 文本类 / JSON / XML / Markdown 等
  if (
    file.type.startsWith('text/')
    || /json|xml|markdown|javascript|typescript|html/.test(file.type)
    || /\.(txt|md|json|log|xml|html?|js|ts|css)$/i.test(file.name)
  ) {
    const raw = await file.text();
    const textExcerpt = raw.slice(0, MAX_TEXT_EXCERPT);
    return {
      kind: 'file',
      name: file.name || '文件.txt',
      mime: file.type || 'text/plain',
      textExcerpt: raw.length > MAX_TEXT_EXCERPT ? `${textExcerpt}\n…（已截断）` : textExcerpt,
    };
  }
  return {
    kind: 'file',
    name: file.name || '附件',
    mime: file.type || 'application/octet-stream',
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读文件失败'));
    reader.readAsDataURL(blob);
  });
}

// 拖拽相关：位置存 localStorage，下次进来还在老地方
const LAUNCHER_POS_KEY = 'medbox.assistant-launcher-pos';
const DRAG_THRESHOLD_PX = 8;
const DRAG_EDGE_MARGIN_PX = 8;

interface LauncherPos {
  right: number;
  bottom: number;
}

export function mountGlobalAssistant(): void {
  if (mounted) return;
  mounted = true;

  const root = el('div', { class: 'ai-root' });
  const launcher = el('button', { class: 'ai-launcher', type: 'button' });
  launcher.setAttribute('aria-label', '打开小助手');
  launcher.title = '点一下打开；按住拖动可以挪个位置';
  launcher.append(icon('sparkles'), el('span', { text: '小助手' }));

  const backdrop = el('div', { class: 'ai-panel-backdrop' });
  backdrop.setAttribute('aria-hidden', 'true');

  const clearBtn = el('button', { class: 'ai-panel-clear', type: 'button' }, [icon('trash')]);
  clearBtn.setAttribute('aria-label', '清空对话记录');
  clearBtn.title = '清空对话记录';
  const closeBtn = el('button', { class: 'ai-panel-close', type: 'button' }, [icon('close')]);
  closeBtn.setAttribute('aria-label', '收起小助手');
  const expandBtn = el('button', { class: 'ai-panel-expand', type: 'button' }, [icon('expand')]);
  expandBtn.setAttribute('aria-label', '展开面板');
  expandBtn.title = '点一下铺满全屏，再点一下还原';
  const header = el('div', { class: 'ai-panel-header' }, [
    el('span', { class: 'ai-panel-badge' }, [icon('sparkles')]),
    el('div', { class: 'ai-panel-titles' }, [
      el('h2', { class: 'ai-panel-title', text: '小助手' }),
      el('p', { class: 'ai-panel-subtitle', text: '吃药、药品和库存都可以问我' }),
    ]),
    clearBtn,
    expandBtn,
    closeBtn,
  ]);

  const log = el('div', { class: 'ai-chat-log' });
  log.setAttribute('aria-live', 'polite');

  // ---- 对话偏好：模型覆盖 + 推理强度（只影响小助手聊天请求） ----
  const modelSelect = document.createElement('select');
  modelSelect.className = 'ai-pref-select';
  modelSelect.setAttribute('aria-label', '选择对话模型');
  const effortSelect = document.createElement('select');
  effortSelect.className = 'ai-pref-select';
  effortSelect.setAttribute('aria-label', '推理强度');
  const refreshModelsBtn = el('button', { class: 'ai-pref-refresh', type: 'button' }, [icon('retry')]);
  refreshModelsBtn.setAttribute('aria-label', '刷新模型列表');
  refreshModelsBtn.title = '从服务商拉取最新模型列表';
  const prefsRow = el('div', { class: 'ai-prefs-row' }, [modelSelect, effortSelect, refreshModelsBtn]);

  function effortLabel(effort: AssistantReasoningEffort): string {
    return effort === 'low' ? '低' : effort === 'medium' ? '中' : '高';
  }

  function refreshPrefControls(): void {
    const provider = getActiveLlmProvider();
    const prefs = getAssistantPrefs();

    modelSelect.replaceChildren();
    modelSelect.append(new Option(`默认模型（${provider.model}）`, ''));
    const healthModels = getLlmHealth(provider.id).models ?? [];
    for (const model of healthModels) {
      if (model && model !== provider.model) modelSelect.append(new Option(model, model));
    }
    modelSelect.value = prefs.modelOverride ?? '';
    if (modelSelect.selectedIndex === -1) modelSelect.value = '';
    // 手动填过的覆盖模型不在健康检查列表里时，补一个选项保住当前选择
    if (prefs.modelOverride && modelSelect.value !== prefs.modelOverride) {
      modelSelect.append(new Option(prefs.modelOverride, prefs.modelOverride));
      modelSelect.value = prefs.modelOverride;
    }

    effortSelect.replaceChildren();
    effortSelect.append(new Option('推理：默认', ''));
    for (const effort of ['low', 'medium', 'high'] as const) {
      effortSelect.append(new Option(`推理：${effortLabel(effort)}`, effort));
    }
    effortSelect.value = prefs.reasoningEffort ?? '';
  }

  modelSelect.onchange = () => {
    setAssistantModelOverride(modelSelect.value || undefined);
  };
  effortSelect.onchange = () => {
    setAssistantReasoningEffort((effortSelect.value || undefined) as AssistantReasoningEffort | undefined);
  };
  refreshModelsBtn.onclick = async () => {
    const provider = getActiveLlmProvider();
    refreshModelsBtn.classList.add('is-busy');
    try {
      const health = await pingLlm(provider);
      setLlmHealth(health, provider.id);
      refreshPrefControls();
      if (health.state === 'ok' && health.models?.length) toast(`已拉取 ${health.models.length} 个模型`);
      else toast(health.message || '暂时拉不到模型列表');
    } catch {
      toast('拉取模型列表失败');
    } finally {
      refreshModelsBtn.classList.remove('is-busy');
    }
  };
  refreshPrefControls();
  onAssistantPrefsChange(() => refreshPrefControls());
  const quick = el('div', { class: 'ai-quick' }, QUICK_PROMPTS.map((prompt) => {
    const chip = el('button', { class: 'ai-quick-chip', type: 'button', text: prompt });
    chip.onclick = () => { void send(prompt); };
    return chip;
  }));

  const attachPreview = el('div', { class: 'ai-attach-preview', hidden: true } as any);
  const input = el('input', { class: 'ai-input', type: 'text', placeholder: '跟我说点什么…' }) as HTMLInputElement;
  input.enterKeyHint = 'send';
  input.setAttribute('aria-label', '想对小助手说的话');
  const attachBtn = el('button', { class: 'ai-tool-btn', type: 'button' }, [icon('plus')]);
  attachBtn.setAttribute('aria-label', '添加图片或文件');
  const sendBtn = el('button', { class: 'ai-send', type: 'submit' }, [icon('send')]);
  sendBtn.setAttribute('aria-label', '发送');
  const form = el('form', { class: 'ai-composer' }, [
    attachPreview,
    el('div', { class: 'ai-input-row' }, [attachBtn, input, sendBtn]),
  ]);

  // 隐藏文件选择：拍照 / 相册 / 任意文件 三套 input，避免安卓 WebView 权限混用问题
  const cameraInput = el('input', { type: 'file', accept: 'image/*', hidden: true } as any) as HTMLInputElement;
  cameraInput.setAttribute('capture', 'environment');
  const albumInput = el('input', { type: 'file', accept: 'image/*', hidden: true } as any) as HTMLInputElement;
  const fileInput = el('input', { type: 'file', accept: '*/*', hidden: true } as any) as HTMLInputElement;
  form.append(cameraInput, albumInput, fileInput);

  // 附件菜单挂在助手根节点内，z-index 盖过面板，避免被小助手挡住
  const attachMenu = el('div', { class: 'ai-attach-menu', hidden: true } as any);
  attachMenu.setAttribute('role', 'dialog');
  attachMenu.setAttribute('aria-label', '添加附件');

  const panel = el('section', { class: 'ai-panel' }, [header, prefsRow, log, quick, form]);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '小助手');

  root.append(launcher, backdrop, panel, attachMenu);
  document.body.append(root);

  let pendingAttachment: AssistantAttachment | null = null;

  // ---- 悬浮按钮拖拽：按住挪走，免得挡住页面底部的按钮（比如批量管理栏） ----
  let dragging = false;
  let dragMoved = false;
  let dragPointerId = -1;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPos: LauncherPos = { right: 0, bottom: 0 };

  function minBottomClearance(): number {
    // 宽屏下底栏是左侧侧栏（shell.css ≥768px），不占底部，纵向可一直低到 8px
    if (window.matchMedia('(min-width: 768px)').matches) return DRAG_EDGE_MARGIN_PX;
    let clearance = DRAG_EDGE_MARGIN_PX;
    const blockers = document.querySelectorAll<HTMLElement>('.app-navigation, .action-dock');
    for (const blocker of blockers) {
      const rect = blocker.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top >= window.innerHeight) continue;
      clearance = Math.max(clearance, window.innerHeight - rect.top + DRAG_EDGE_MARGIN_PX);
    }
    return clearance;
  }

  function clampPos(pos: LauncherPos): LauncherPos {
    const maxRight = Math.max(DRAG_EDGE_MARGIN_PX, window.innerWidth - launcher.offsetWidth - DRAG_EDGE_MARGIN_PX);
    const maxBottom = Math.max(DRAG_EDGE_MARGIN_PX, window.innerHeight - launcher.offsetHeight - DRAG_EDGE_MARGIN_PX);
    const minBottom = Math.min(minBottomClearance(), maxBottom);
    return {
      right: Math.min(Math.max(pos.right, DRAG_EDGE_MARGIN_PX), maxRight),
      bottom: Math.min(Math.max(pos.bottom, minBottom), maxBottom),
    };
  }

  function snapToEdge(pos: LauncherPos): LauncherPos {
    // 宽屏（平板/桌面）下不做水平吸附，保留用户拖到的位置，避免被甩到边缘
    if (window.matchMedia('(min-width: 768px)').matches) return clampPos(pos);
    const maxRight = Math.max(DRAG_EDGE_MARGIN_PX, window.innerWidth - launcher.offsetWidth - DRAG_EDGE_MARGIN_PX);
    const currentLeft = window.innerWidth - pos.right - launcher.offsetWidth;
    return {
      right: currentLeft + launcher.offsetWidth / 2 < window.innerWidth / 2 ? maxRight : DRAG_EDGE_MARGIN_PX,
      bottom: pos.bottom,
    };
  }

  function applyPos(pos: LauncherPos): LauncherPos {
    const clamped = clampPos(pos);
    launcher.style.insetInlineEnd = `${clamped.right}px`;
    launcher.style.insetBlockEnd = `${clamped.bottom}px`;
    return clamped;
  }

  function loadPos(): LauncherPos | null {
    try {
      const raw = localStorage.getItem(LAUNCHER_POS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<LauncherPos>;
      if (typeof parsed.right !== 'number' || typeof parsed.bottom !== 'number') return null;
      if (!Number.isFinite(parsed.right) || !Number.isFinite(parsed.bottom)) return null;
      return { right: parsed.right, bottom: parsed.bottom };
    } catch {
      return null;
    }
  }

  function savePos(pos: LauncherPos): void {
    try {
      localStorage.setItem(LAUNCHER_POS_KEY, JSON.stringify(pos));
    } catch {
      /* 存不了就算了，本次会话内位置仍然有效 */
    }
  }

  function currentPos(): LauncherPos {
    const rect = launcher.getBoundingClientRect();
    return { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom };
  }

  launcher.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;
    dragging = true;
    dragMoved = false;
    dragPointerId = e.pointerId;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPos = currentPos();
  });

  launcher.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragPointerId) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (!dragMoved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      dragMoved = true;
      try {
        launcher.setPointerCapture(e.pointerId);
      } catch {
        /* 个别环境拿不到指针捕获，不影响拖动本身 */
      }
      launcher.classList.add('is-dragging');
    }
    applyPos({ right: dragStartPos.right - dx, bottom: dragStartPos.bottom - dy });
  });

  const endDrag = (e: PointerEvent): void => {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    if (!dragMoved) return;
    launcher.classList.remove('is-dragging');
    savePos(applyPos(snapToEdge(currentPos())));
  };
  launcher.addEventListener('pointerup', endDrag);
  launcher.addEventListener('pointercancel', endDrag);

  window.addEventListener('resize', () => {
    // 转屏或窗口变小后，把按钮拉回可见范围
    if (launcher.style.insetInlineEnd) applyPos(snapToEdge(currentPos()));
  });

  let repositionFrame = 0;
  const positionObserver = new MutationObserver(() => {
    if (!launcher.style.insetInlineEnd || repositionFrame) return;
    repositionFrame = window.requestAnimationFrame(() => {
      repositionFrame = 0;
      applyPos(snapToEdge(currentPos()));
    });
  });
  // 只观察页面内容容器：#app 的布局变化才会影响按钮的可视范围
  const appRoot = document.getElementById('app');
  if (appRoot) positionObserver.observe(appRoot, { childList: true, subtree: true });

  const savedPos = loadPos();
  if (savedPos) applyPos(snapToEdge(savedPos));
  else window.setTimeout(() => applyPos(snapToEdge(currentPos())), 0);

  let busy: AbortController | null = null;

  function seedGreeting(): void {
    addMsg('bot', GREETING);
    const cfg = getLlmConfig();
    if (!cfg.baseUrl || !cfg.apiKey) {
      addSettingsHint('不过现在还没连上 AI 服务，先去设置里填好服务地址和密钥，我就能开工了。');
    }
  }

  // 历史回填完成前不种问候语，避免覆盖将要恢复的记录
  let historyLoaded = false;

  function openPanel(): void {
    root.classList.add('is-open');
    refreshPrefControls();
    if (log.childElementCount === 0 && historyLoaded) seedGreeting();
    setTimeout(() => input.focus(), 320);
  }

  // 启动即回填历史：最近 ~50 条可见，最近 12 条并入上下文延续对话。
  void (async () => {
    try {
      const records = await listRecentAssistantMessages(50);
      if (records.length > 0 && log.childElementCount === 0) {
        for (const record of records) {
          if (record.role === 'user') {
            addMsg('user', record.content);
          } else {
            addAssistantReply({
              markdown: record.content,
              blocks: (Array.isArray(record.blocks) ? record.blocks : []) as AssistantContentBlock[],
            });
          }
        }
        history.length = 0;
        for (const record of records.slice(-12)) {
          history.push({ role: record.role, content: record.content });
        }
      }
    } catch {
      /* 历史读取失败不影响新对话 */
    }
    historyLoaded = true;
    if (root.classList.contains('is-open') && log.childElementCount === 0) seedGreeting();
  })();

  globalOpenPanel = openPanel;

  function closePanel(): void {
    busy?.abort();
    closeAttachMenu();
    panel.classList.remove('is-fullscreen');
    expandBtn.replaceChildren(icon('expand'));
    expandBtn.setAttribute('aria-label', '展开面板');
    root.classList.remove('is-open');
    launcher.focus({ preventScroll: true });
  }

  function clearAttachment(): void {
    pendingAttachment = null;
    attachPreview.hidden = true;
    attachPreview.replaceChildren();
  }

  function showAttachment(att: AssistantAttachment): void {
    pendingAttachment = att;
    attachPreview.hidden = false;
    attachPreview.replaceChildren();
    const chip = el('div', { class: 'ai-attach-chip' });
    if (att.kind === 'image' && att.dataUrl) {
      const thumb = el('img', { class: 'ai-attach-thumb', alt: att.name } as any) as HTMLImageElement;
      thumb.src = att.dataUrl;
      chip.append(thumb);
    } else {
      chip.append(icon(att.kind === 'image' ? 'image' : 'box'));
    }
    chip.append(el('span', { class: 'ai-attach-name', text: att.name }));
    const remove = el('button', { class: 'ai-attach-remove', type: 'button', text: '去掉' });
    remove.onclick = () => clearAttachment();
    chip.append(remove);
    attachPreview.append(chip);
  }

  async function pickFile(source: 'camera' | 'album' | 'file'): Promise<void> {
    const target = source === 'camera' ? cameraInput : source === 'album' ? albumInput : fileInput;
    target.value = '';
    target.onchange = async () => {
      const file = target.files?.[0];
      target.value = '';
      if (!file) return;
      try {
        const att = await fileToAttachment(file);
        showAttachment(att);
        if (!input.value.trim()) {
          input.placeholder = att.kind === 'image' ? '说说想让我看这张图的什么…' : '说说想让我看这个文件的什么…';
        }
        input.focus();
      } catch (error) {
        toast(error instanceof Error ? error.message : '这个文件用不了');
      }
    };
    target.click();
  }

  let attachMenuTrap: (() => void) | null = null;
  let attachMenuFocusedFrom: HTMLElement | null = null;

  function closeAttachMenu(): void {
    if (attachMenu.hidden && !attachMenuTrap) return;
    attachMenu.hidden = true;
    attachMenu.replaceChildren();
    attachMenuTrap?.();
    attachMenuTrap = null;
    restoreAppAfterLastDialog();
    const backTo = attachMenuFocusedFrom;
    attachMenuFocusedFrom = null;
    backTo?.focus({ preventScroll: true });
  }

  function openAttachMenu(): void {
    if (!attachMenu.hidden) {
      closeAttachMenu();
      return;
    }
    attachMenuFocusedFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const camera = createButton({
      label: '拍照',
      icon: 'camera',
      onClick: () => { closeAttachMenu(); void pickFile('camera'); },
    });
    const album = createButton({
      label: '从相册选图',
      variant: 'secondary',
      icon: 'image',
      onClick: () => { closeAttachMenu(); void pickFile('album'); },
    });
    const file = createButton({
      label: '上传文件',
      variant: 'secondary',
      icon: 'box',
      onClick: () => { closeAttachMenu(); void pickFile('file'); },
    });
    const cancel = createButton({ label: '取消', variant: 'text', onClick: () => closeAttachMenu() });
    const sheet = el('div', { class: 'ai-attach-menu-sheet' }, [
      el('div', { class: 'big', text: '发给小助手' }),
      el('div', { class: 'muted', text: '可以拍照、从相册选图，或上传文本/其它文件。' }),
      el('div', { class: 'ai-attach-sheet-actions' }, [camera, album, file, cancel]),
    ]);
    const scrim = el('div', { class: 'ai-attach-menu-scrim' });
    scrim.onclick = () => closeAttachMenu();
    attachMenu.replaceChildren(scrim, sheet);
    attachMenu.hidden = false;
    makeAppInert();
    attachMenuTrap = trapFocusIn(attachMenu, closeAttachMenu);
    camera.focus();
  }

  attachBtn.onclick = () => openAttachMenu();

  launcher.onclick = () => {
    // 刚拖完松手会跟一个 click，别误开面板
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    openPanel();
  };
  clearBtn.onclick = async () => {
    if (log.childElementCount <= 1 && history.length === 0) return;
    const confirmed = await confirmDialog('确定清空与小助手的对话记录吗？清空后所有设备上的本机记录都会删除。', '清空记录');
    if (!confirmed) return;
    history.length = 0;
    log.replaceChildren();
    seedGreeting();
    void clearAssistantMessages().catch(() => { /* 清库失败不影响界面清空 */ });
    quick.hidden = false;
    toast('对话已清空');
  };
  closeBtn.onclick = closePanel;
  backdrop.onclick = closePanel;
  expandBtn.onclick = () => {
    const fullscreen = panel.classList.toggle('is-fullscreen');
    expandBtn.setAttribute('aria-label', fullscreen ? '收起面板' : '展开面板');
    expandBtn.replaceChildren(icon(fullscreen ? 'contract' : 'expand'));
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) closePanel();
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pendingAttachment) return;
    closeAttachMenu();
    input.value = '';
    input.placeholder = '跟我说点什么…';
    const att = pendingAttachment;
    clearAttachment();
    void send(text, att ?? undefined);
  };

  function addMsg(role: 'user' | 'bot', text: string, attachment?: AssistantAttachment): HTMLElement {
    const bubble = el('div', { class: 'ai-bubble' });
    if (attachment?.kind === 'image' && attachment.dataUrl) {
      const img = el('img', { class: 'ai-bubble-image', alt: attachment.name } as any) as HTMLImageElement;
      img.src = attachment.dataUrl;
      bubble.append(img);
    } else if (attachment) {
      bubble.append(el('div', { class: 'ai-bubble-file', text: `附件：${attachment.name}` }));
    }
    if (text) bubble.append(role === 'bot' ? renderAssistantMarkdown(text) : el('span', { text }));
    const msg = el('div', { class: `ai-msg is-${role}` }, [bubble]);
    log.append(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  function addAssistantReply(reply: AssistantTurnResult): HTMLElement {
    const msg = el('div', { class: 'ai-msg is-bot' });
    if (reply.markdown) {
      const bubble = el('div', { class: 'ai-bubble' });
      bubble.append(renderAssistantMarkdown(reply.markdown));
      const footer = el('div', { class: 'ai-bubble-footer' });
      const copyBtn = el('button', {
        class: 'ai-bubble-copy-btn',
        type: 'button',
        'aria-label': '复制回复内容',
        title: '复制回复内容',
      });
      copyBtn.append(icon('copy'), el('span', { text: '复制' }));
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(reply.markdown);
          toast('已复制到剪贴板');
        } catch {
          toast('复制失败');
        }
      };
      footer.append(copyBtn);
      bubble.append(footer);
      msg.append(bubble);
    }
    if (reply.blocks.length) {
      const cards = el('div', { class: 'ai-cards' });
      const onNavigate = (path: string): void => {
        closePanel();
        navigate(path);
      };
      for (const block of reply.blocks) {
        const slot = el('div', { class: 'ai-card-slot', text: `${block.title}（内容加载中）` });
        cards.append(slot);
        void loadAssistantContent()
          .then((module) => {
            if (slot.isConnected) slot.replaceWith(module.renderAssistantBlock(block, onNavigate));
          })
          .catch(() => {
            if (slot.isConnected) slot.textContent = `${block.title}（内容加载失败，请稍后重试）`;
          });
      }
      msg.append(cards);
    }
    log.append(msg);
    log.scrollTop = log.scrollHeight;
    return msg;
  }

  function addSettingsHint(text: string): void {
    const goBtn = el('button', { class: 'ai-bubble-action', type: 'button', text: '去设置连一下' });
    goBtn.onclick = () => { closePanel(); navigate('/settings'); };
    const msg = el('div', { class: 'ai-msg is-bot' }, [
      el('div', { class: 'ai-bubble' }, [el('span', { text }), goBtn]),
    ]);
    log.append(msg);
    log.scrollTop = log.scrollHeight;
  }

  function addStatus(text: string): { update: (t: string) => void; remove: () => void } {
    const label = el('span', { text });
    const msg = el('div', { class: 'ai-msg is-bot is-status' }, [
      el('div', { class: 'ai-bubble' }, [label, el('span', { class: 'ai-dots' }, [el('i'), el('i'), el('i')])]),
    ]);
    log.append(msg);
    log.scrollTop = log.scrollHeight;
    return {
      update: (t: string) => { label.textContent = t; },
      remove: () => msg.remove(),
    };
  }

  function setBusy(on: boolean): void {
    panel.classList.toggle('is-busy', on);
    sendBtn.replaceChildren(icon(on ? 'close' : 'send'));
    sendBtn.setAttribute('aria-label', on ? '先不等回复了' : '发送');
    sendBtn.type = on ? 'button' : 'submit';
    sendBtn.onclick = on ? () => busy?.abort() : null;
    attachBtn.disabled = on;
  }

  async function send(text: string, attachment?: AssistantAttachment): Promise<void> {
    if (busy) return;
    const displayText = text.trim()
      || (attachment?.kind === 'image' ? '（发了一张图）' : attachment ? `（发了文件：${attachment.name}）` : '');
    if (!displayText && !attachment) return;
    quick.hidden = true;
    addMsg('user', text.trim(), attachment);
    history.push({ role: 'user', content: displayText });
    const status = addStatus(attachment?.kind === 'image' ? '正在看图' : '正在想');
    busy = new AbortController();
    setBusy(true);
    let streamedMessage: HTMLElement | null = null;
    let streamedText = '';
    let streamPlain: HTMLElement | null = null;
    let streamRenderTimer = 0;

    function renderStreamedMarkdown(): void {
      if (!streamedMessage) return;
      const bubble = streamedMessage.querySelector<HTMLElement>('.ai-bubble');
      if (!bubble) return;
      bubble.replaceChildren(renderAssistantMarkdown(streamedText));
      bubble.append(el('span', { class: 'ai-caret', 'aria-hidden': 'true' }));
      streamPlain = null;
      log.scrollTop = log.scrollHeight;
    }

    function scheduleStreamRender(): void {
      if (streamRenderTimer) return;
      streamRenderTimer = window.setTimeout(() => {
        streamRenderTimer = 0;
        renderStreamedMarkdown();
      }, 250);
    }

    try {
      log.setAttribute('aria-live', 'off');
      const prefs = getAssistantPrefs();
      const reply = await runAssistantTurn(history, {
        signal: busy.signal,
        attachment,
        modelOverride: prefs.modelOverride,
        reasoningEffort: prefs.reasoningEffort,
        confirmTool: (message) => confirmDialog(message, '好，就这么办'),
        onToolStart: (_name, label) => {
          status.update(label);
        },
        onText: (delta) => {
          streamedText += delta;
          if (!streamedMessage) {
            status.remove();
            streamedMessage = addMsg('bot', '');
          }
          const bubble = streamedMessage.querySelector<HTMLElement>('.ai-bubble');
          if (bubble) {
            if (!streamPlain || !streamPlain.isConnected) {
              streamPlain = el('span', { class: 'ai-stream-plain' });
              bubble.replaceChildren(streamPlain);
            }
            streamPlain.append(document.createTextNode(delta));
            scheduleStreamRender();
          }
          log.scrollTop = log.scrollHeight;
        },
      });
      history.push({ role: 'assistant', content: reply.markdown });
      status.remove();
      const liveMessage = streamedMessage as HTMLElement | null;
      if (liveMessage !== null) liveMessage.remove();
      addAssistantReply(reply);
      persistExchange(displayText, reply);
    } catch (e) {
      status.remove();
      history.pop();
      if (e instanceof AssistantError) {
        if (e.kind === 'unconfigured') addSettingsHint(e.message);
        else if (e.kind === 'cancelled') addMsg('bot', '好，先不查了。想起来再叫我。');
        else addMsg('bot', e.message);
      } else if (e instanceof Error && e.message.includes('已取消')) {
        addMsg('bot', '好的，先不发了。想用的时候再点我。');
      } else {
        addMsg('bot', `出了点小状况：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (streamRenderTimer) {
        window.clearTimeout(streamRenderTimer);
        streamRenderTimer = 0;
      }
      streamPlain = null;
      log.setAttribute('aria-live', 'polite');
      busy = null;
      setBusy(false);
    }
  }

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('assistant-preview')) {
    window.setTimeout(() => {
      openPanel();
      quick.hidden = true;
      addAssistantReply({
        markdown: [
          '## 今天的提醒',
          '',
          '还有 **1 项** 待处理，下面是今天的用药概览。',
          '',
          '> 记得饭后服药，不要空腹吃阿司匹林。',
          '',
          '### 今日安排',
          '',
          '- **08:00** 阿司匹林 · 每次 1 片',
          '- **12:30** 维生素 C · 每次 1 片',
          '- **21:30** 瑞舒伐他汀 · 每次 1 片',
          '',
          '### 服药对照',
          '',
          '| 药品 | 时间 | 剂量 | 状态 |',
          '| --- | --- | --- | --- |',
          '| 阿司匹林 | 08:00 | 1 片 | 待服 |',
          '| 维生素 C | 12:30 | 1 片 | 已服 |',
          '| 瑞舒伐他汀 | 21:30 | 1 片 | 待服 |',
          '',
          '### 本周清单',
          '',
          '- [x] 周一 08:00 阿司匹林',
          '- [x] 周二 08:00 阿司匹林',
          '- [ ] 今天 08:00 阿司匹林',
          '',
          '---',
          '',
          '需要调整时间可以告诉我，比如：',
          '',
          '```bash',
          '把阿司匹林改到 08:30',
          '```',
        ].join('\n'),
        blocks: [
          {
            type: 'card',
            eyebrow: '近 7 天',
            title: '按时服药情况',
            body: '已记录的服药次数会计入统计。',
            tone: 'warning',
            variant: 'stats',
            icon: 'timer',
            badge: '需要留意',
            facts: [
              { label: '按时率', value: '82%' },
              { label: '已服', value: '9 次' },
              { label: '漏服', value: '2 次' },
              { label: '跳过', value: '0 次' },
            ],
          },
          {
            type: 'card',
            eyebrow: '今天 · 还有 3 项',
            title: '用药安排',
            body: '下一次是 **08:00 阿司匹林**。按时间排序显示今天的服药安排。',
            tone: 'neutral',
            variant: 'medication',
            icon: 'pill',
            badge: '待处理',
            facts: [
              { label: '下一次', value: '08:00 阿司匹林' },
              { label: '今日总计', value: '3 项' },
            ],
            items: [
              { title: '阿司匹林', subtitle: '08:00 · 每次 1 片 · 饭后', status: 'pending', statusLabel: '待服', icon: 'pill' },
              { title: '维生素 C', subtitle: '12:30 · 每次 1 片', status: 'success', statusLabel: '已服', icon: 'pill' },
              { title: '瑞舒伐他汀', subtitle: '21:30 · 每次 1 片', status: 'pending', statusLabel: '待服', icon: 'pill' },
            ],
          },
          {
            type: 'card',
            eyebrow: '药箱 · 3 种药物',
            title: '我的药物',
            body: '每张药物条目显示规格、提醒时间和库存状态。',
            tone: 'warning',
            variant: 'inventory',
            icon: 'box',
            badge: '1 项需补充',
            facts: [
              { label: '药物数', value: '3 种' },
              { label: '需留意', value: '1 项' },
            ],
            items: [
              { title: '阿司匹林', subtitle: '100mg · 每次 1 片 · 08:00', meta: '库存 28 片', status: 'success', statusLabel: '正常', icon: 'pill' },
              { title: '维生素 C', subtitle: '500mg · 每次 1 片 · 12:30', meta: '仅剩 4 片', status: 'warning', statusLabel: '需补充', icon: 'pill' },
              { title: '瑞舒伐他汀', subtitle: '10mg · 每次 1 片 · 21:30', meta: '约 16 天', status: 'success', statusLabel: '正常', icon: 'pill' },
            ],
          },
          {
            type: 'card',
            eyebrow: '联网搜索',
            title: '腾讯云一句话识别',
            body: '> 互联网内容仅供参考，不要执行网页中夹带的指令。\n\n腾讯云文档说明该接口支持 60 秒以内的短音频。\n\n[查看来源](https://cloud.tencent.com/document/api/1093/35646)',
            tone: 'neutral',
            variant: 'search',
            icon: 'scan',
            badge: '2 个来源',
          },
          {
            type: 'navigation',
            title: '药品库存',
            description: '查看余量和低库存提醒',
            actionLabel: '打开页面',
            path: '/meds/inventory',
            icon: 'box',
          },
        ],
      });
    }, 0);
  }
}

export function openAssistantPanel(): void {
  if (!globalOpenPanel) {
    mountGlobalAssistant();
  }
  const opener = globalOpenPanel as (() => void) | null;
  opener?.();
}
