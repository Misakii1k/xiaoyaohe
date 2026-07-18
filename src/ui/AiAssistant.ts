// 全局小助手入口：右下角悬浮按钮 + 底部聊天面板。
// 挂在 document.body 上，路由切换不销毁，不挡各页面自己的操作。
import { el, icon, confirmDialog, toast } from './components';
import { navigate } from '../router';
import {
  AssistantError,
  runAssistantTurn,
  type AssistantAttachment,
  type AssistantTurnResult,
  type AssistantExchange,
} from '../ai/assistant';
import { getLlmConfig } from '../ai/llmConfig';
import {
  AsrSentenceError,
  createHoldToTalkSession,
  type HoldToTalkSession,
} from '../ai/asr';
import { createButton } from './primitives/Button';
import { compressBoxPhoto } from '../features/medPhotos';
import { renderAssistantBlock, renderAssistantMarkdown } from './assistantContent';

const GREETING = '你好呀，我是小助手。想知道今天吃什么药、这个月挣了多少，或者让我帮你记一笔，直接说就行。也能拍照、发文件、按住说话。';
const QUICK_PROMPTS = [
  '今天要吃什么药？',
  '最近一周吃药按时吗？',
  '这个月挣了多少钱？',
  '现在开始上班计时',
];

/** 文本附件最多带入模型的字数，避免一次塞整本书 */
const MAX_TEXT_EXCERPT = 12_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
/** 上滑超过这个像素视为取消发送（微信风格） */
const CANCEL_SLIDE_PX = 72;

const history: AssistantExchange[] = [];
let mounted = false;

async function fileToAttachment(file: File): Promise<AssistantAttachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('文件太大了，请选 8MB 以内的');
  }
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(file.name)) {
    const compressed = await compressBoxPhoto(file);
    const dataUrl = await blobToDataUrl(compressed);
    return { kind: 'image', name: file.name || '照片.jpg', mime: compressed.type || 'image/jpeg', dataUrl };
  }
  // 文本类：直接读成字符串摘录
  if (
    file.type.startsWith('text/')
    || /json|xml|csv|markdown|javascript|typescript|html/.test(file.type)
    || /\.(txt|md|csv|json|log|xml|html?|js|ts|css)$/i.test(file.name)
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

  const closeBtn = el('button', { class: 'ai-panel-close', type: 'button' }, [icon('close')]);
  closeBtn.setAttribute('aria-label', '收起小助手');
  const header = el('div', { class: 'ai-panel-header' }, [
    el('span', { class: 'ai-panel-badge' }, [icon('sparkles')]),
    el('div', { class: 'ai-panel-titles' }, [
      el('h2', { class: 'ai-panel-title', text: '小助手' }),
      el('p', { class: 'ai-panel-subtitle', text: '吃药、上班的事都可以问我' }),
    ]),
    closeBtn,
  ]);

  const log = el('div', { class: 'ai-chat-log' });
  log.setAttribute('aria-live', 'polite');

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
  // 微信风格：按住说话 / 上滑取消
  const micBtn = el('button', {
    class: 'ai-tool-btn ai-mic-btn',
    type: 'button',
  }, [icon('mic')]) as HTMLButtonElement;
  micBtn.setAttribute('aria-label', '按住说话');
  micBtn.title = '按住说话，松开发送，上滑取消';
  const sendBtn = el('button', { class: 'ai-send', type: 'submit' }, [icon('send')]);
  sendBtn.setAttribute('aria-label', '发送');
  const form = el('form', { class: 'ai-composer' }, [
    attachPreview,
    el('div', { class: 'ai-input-row' }, [attachBtn, micBtn, input, sendBtn]),
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

  // 面板内紧凑录音反馈区，聊天内容保持可见。
  const voiceOverlay = el('div', { class: 'ai-voice-overlay', hidden: true } as any);
  voiceOverlay.setAttribute('aria-live', 'assertive');
  const voiceHint = el('div', { class: 'ai-voice-hint', text: '松开发送，上滑取消' });
  const voiceTimer = el('div', { class: 'ai-voice-timer', text: '0″' });
  const voiceWave = el('div', { class: 'ai-voice-wave' }, [
    el('i'), el('i'), el('i'), el('i'), el('i'),
  ]);
  const voiceGlyph = el('div', { class: 'ai-voice-glyph', 'aria-hidden': 'true' } as any, [icon('mic')]);
  voiceOverlay.append(voiceGlyph, voiceWave, voiceTimer, voiceHint);

  const panel = el('section', { class: 'ai-panel' }, [header, log, quick, voiceOverlay, form]);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '小助手');

  root.append(launcher, backdrop, panel, attachMenu);
  document.body.append(root);

  let pendingAttachment: AssistantAttachment | null = null;
  let holdSession: HoldToTalkSession | null = null;
  let holdActive = false;
  let holdCancel = false;
  let holdStartY = 0;
  let holdPointerId = -1;
  let recognizing = false;

  // ---- 悬浮按钮拖拽：按住挪走，免得挡住页面底部的按钮（比如批量管理栏） ----
  let dragging = false;
  let dragMoved = false;
  let dragPointerId = -1;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartPos: LauncherPos = { right: 0, bottom: 0 };

  function minBottomClearance(): number {
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
  positionObserver.observe(document.body, { childList: true, subtree: true });

  const savedPos = loadPos();
  if (savedPos) applyPos(snapToEdge(savedPos));
  else window.setTimeout(() => applyPos(snapToEdge(currentPos())), 0);

  let busy: AbortController | null = null;

  function openPanel(): void {
    root.classList.add('is-open');
    if (log.childElementCount === 0) {
      addMsg('bot', GREETING);
      const cfg = getLlmConfig();
      if (!cfg.baseUrl || !cfg.apiKey) {
        addSettingsHint('不过现在还没连上 AI 服务，先去设置里填好服务地址和密钥，我就能开工了。');
      }
    }
    setTimeout(() => input.focus(), 320);
  }

  function closePanel(): void {
    busy?.abort();
    closeAttachMenu();
    if (holdActive || holdSession) void endHoldTalk(true);
    setVoiceOverlay(false);
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

  function closeAttachMenu(): void {
    attachMenu.hidden = true;
    attachMenu.replaceChildren();
  }

  function openAttachMenu(): void {
    if (!attachMenu.hidden) {
      closeAttachMenu();
      return;
    }
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
    camera.focus();
  }

  function setVoiceOverlay(on: boolean, cancelHint = false): void {
    voiceOverlay.hidden = !on;
    panel.classList.toggle('is-voice-active', on);
    voiceOverlay.classList.toggle('is-cancel', cancelHint);
    if (!on) {
      voiceTimer.textContent = '0″';
      voiceHint.textContent = '松开发送，上滑取消';
      micBtn.classList.remove('is-listening', 'is-cancel-zone');
    }
  }

  async function beginHoldTalk(ev: PointerEvent): Promise<void> {
    if (busy || recognizing || holdActive) return;
    holdActive = true;
    holdCancel = false;
    holdStartY = ev.clientY;
    holdPointerId = ev.pointerId;
    try { micBtn.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
    micBtn.classList.add('is-listening');
    setVoiceOverlay(true, false);
    holdSession = createHoldToTalkSession({
      onTick: (sec) => {
        voiceTimer.textContent = `${sec}″`;
        if (sec >= 55) voiceHint.textContent = '快到一分钟了，松手即可发送';
      },
    });
    try {
      await holdSession.start();
    } catch (error) {
      holdActive = false;
      setVoiceOverlay(false);
      holdSession = null;
      if (error instanceof AsrSentenceError) {
        if (error.code === 'not-allowed') toast('没有麦克风权限，请到系统设置里允许');
        else if (error.code === 'unconfigured') toast(error.message);
        else toast(error.message);
      } else {
        toast('打不开麦克风');
      }
    }
  }

  async function endHoldTalk(cancel: boolean): Promise<void> {
    if (!holdActive && !holdSession) return;
    holdActive = false;
    const session = holdSession;
    holdSession = null;
    micBtn.classList.remove('is-listening', 'is-cancel-zone');
    setVoiceOverlay(false);
    if (!session) return;
    if (cancel) {
      try { await session.finish(true); } catch { /* ignore */ }
      toast('已取消');
      return;
    }
    recognizing = true;
    micBtn.disabled = true;
    const status = addStatus('正在识别语音…');
    try {
      const text = await session.finish(false);
      status.remove();
      if (text && text.trim()) {
        // 识别结果填入输入框并直接发送
        input.value = '';
        void send(text.trim());
      } else {
        toast('没听清，请再按住说一次');
      }
    } catch (error) {
      status.remove();
      if (error instanceof AsrSentenceError) {
        if (error.code === 'cancelled') toast('已取消');
        else if (error.code === 'no-speech') toast('没听清，请按住多说一会儿');
        else if (error.code === 'auth-failed') toast('语音服务鉴权失败，服务端凭证需要更新');
        else toast(error.message);
      } else {
        toast('识别失败，请改成打字');
      }
    } finally {
      recognizing = false;
      micBtn.disabled = false;
    }
  }

  function onHoldMove(ev: PointerEvent): void {
    if (!holdActive || ev.pointerId !== holdPointerId) return;
    const dy = holdStartY - ev.clientY;
    holdCancel = dy > CANCEL_SLIDE_PX;
    micBtn.classList.toggle('is-cancel-zone', holdCancel);
    voiceOverlay.classList.toggle('is-cancel', holdCancel);
    voiceHint.textContent = holdCancel ? '松开手指，取消发送' : '松开发送，上滑取消';
  }

  function onHoldEnd(ev: PointerEvent): void {
    if (ev.pointerId !== holdPointerId && holdPointerId !== -1) return;
    const cancel = holdCancel;
    holdPointerId = -1;
    void endHoldTalk(cancel);
  }

  attachBtn.onclick = () => openAttachMenu();
  // 按住说话：pointer 事件（兼容触摸 / 鼠标）
  micBtn.addEventListener('pointerdown', (ev) => {
    if (ev.button != null && ev.button !== 0) return;
    ev.preventDefault();
    void beginHoldTalk(ev);
  });
  micBtn.addEventListener('pointermove', onHoldMove);
  micBtn.addEventListener('pointerup', onHoldEnd);
  micBtn.addEventListener('pointercancel', onHoldEnd);
  // 防止长按出系统菜单
  micBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());

  launcher.onclick = () => {
    // 刚拖完松手会跟一个 click，别误开面板
    if (dragMoved) {
      dragMoved = false;
      return;
    }
    openPanel();
  };
  closeBtn.onclick = closePanel;
  backdrop.onclick = closePanel;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) closePanel();
  });

  form.onsubmit = (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pendingAttachment) return;
    if (holdActive || holdSession) void endHoldTalk(true);
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
    const bubble = el('div', { class: 'ai-bubble' });
    if (reply.markdown) bubble.append(renderAssistantMarkdown(reply.markdown));
    for (const block of reply.blocks) {
      bubble.append(renderAssistantBlock(block, (path) => {
        closePanel();
        navigate(path);
      }));
    }
    const msg = el('div', { class: 'ai-msg is-bot' }, [bubble]);
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
    attachBtn.disabled = on || recognizing;
    micBtn.disabled = on || recognizing;
    if (on && (holdActive || holdSession)) void endHoldTalk(true);
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
    try {
      const reply = await runAssistantTurn(history, {
        signal: busy.signal,
        attachment,
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
          if (bubble) bubble.replaceChildren(renderAssistantMarkdown(streamedText));
          log.scrollTop = log.scrollHeight;
        },
      });
      history.push({ role: 'assistant', content: reply.markdown });
      status.remove();
      const liveMessage = streamedMessage as HTMLElement | null;
      if (liveMessage !== null) liveMessage.remove();
      addAssistantReply(reply);
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
      busy = null;
      setBusy(false);
    }
  }

  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('assistant-preview')) {
    window.setTimeout(() => {
      openPanel();
      quick.hidden = true;
      addAssistantReply({
        markdown: '## 今天的提醒\n\n还有 **1 项** 待处理：\n\n- 维生素 C · 08:00\n- 每次 1 片，按医嘱服用',
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
            title: '工时记录',
            description: '查看本月收入和班次',
            actionLabel: '打开页面',
            path: '/work',
            icon: 'briefcase',
          },
        ],
      });
    }, 0);
  }
}
