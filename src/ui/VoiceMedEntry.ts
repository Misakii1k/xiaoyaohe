// 口述录药：像聊天一样说出在吃的药，AI 整理成清单，再走批量建档向导逐项确认。
// 配好腾讯云语音识别就用它（国产浏览器/WebView 也能听）；否则退回浏览器自带识别；都没有就直接打字。
import { el, banner } from './components';
import { navigate, registerRouteTransitionCleanup } from '../router';
import { createButton } from './primitives/Button';
import { parseMedicationSpeech, IdentifyError } from '../ai/identify';
import { openMedOnboardWizard } from './MedOnboardWizard';
import { setPendingMedicationBatch } from '../ai/pendingMedicationBatch';
import { createTencentAsrRecognizer, isAsrConfigured, type SpeechRecognitionLike } from '../ai/asr';

const EXAMPLE_TEXT = '比如说：「阿司匹林每天早饭后吃一片，二甲双胍早晚各一片，睡前还有一粒钙片。」';
const MIC_IDLE_LABEL = '点一下，开始说';
const MIC_LISTENING_LABEL = '正在听…说完点一下';
const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const activeVoiceEntries = new Set<() => void>();
registerRouteTransitionCleanup(() => {
  for (const dispose of Array.from(activeVoiceEntries)) dispose();
});

function createRecognizer(): SpeechRecognitionLike | null {
  // 设置里配好腾讯云就优先用它——WebSocket 直连，不挑浏览器
  if (isAsrConfigured()) return createTencentAsrRecognizer();
  const Ctor = (window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  });
  const Recognition = Ctor.SpeechRecognition ?? Ctor.webkitSpeechRecognition;
  if (!Recognition) return null;
  try {
    const recognition = new Recognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = false;
    return recognition;
  } catch {
    return null;
  }
}

export interface VoiceMedEntryHandle {
  close: () => void;
}

export function openVoiceMedEntry(): VoiceMedEntryHandle {
  let disposed = false;
  let busy = false;
  let listening = false;
  let parseAbort: AbortController | null = null;
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const recognition = createRecognizer();

  const overlay = el('div', { class: 'med-wizard-overlay' });
  overlay.setAttribute('role', 'presentation');
  const sheet = el('section', { class: 'med-wizard voice-entry' });
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', '说给 AI 听');
  sheet.tabIndex = -1;

  const grabber = el('div', { class: 'med-wizard-grabber', 'aria-hidden': 'true' } as any);
  const headLabel = el('div', { class: 'med-wizard-progress', html: '说给 AI 听' });
  const quit = el('button', { class: 'med-wizard-skip', type: 'button', html: '先不录了' } as any);
  const head = el('div', { class: 'med-wizard-head' });
  head.append(headLabel, quit);

  const card = el('div', { class: 'med-wizard-card' });
  card.append(el('h3', { class: 'med-wizard-name', html: '把在吃的药，说一说' }));
  card.append(el('p', {
    class: 'med-wizard-sub',
    html: '像平时聊天一样说就行，AI 会整理成清单，让您一项项看过再保存。',
  }));
  card.append(el('p', { class: 'voice-entry-example', text: EXAMPLE_TEXT }));

  const input = el('textarea', {
    class: 'voice-entry-text',
    placeholder: recognition ? '点下面的话筒说话，或直接在这里打字…' : '在这里打字，比如药名、一天吃几次…',
  }) as HTMLTextAreaElement;
  input.setAttribute('aria-label', '在吃的药的描述');
  card.append(input);

  // 实时字幕：腾讯识别的中间结果先在这预览，说完一段定稿才进正文
  const interim = el('div', { class: 'voice-entry-interim' });
  interim.setAttribute('aria-live', 'polite');
  card.append(interim);

  if (!recognition) {
    card.append(el('p', { class: 'med-wizard-note', html: '这个浏览器不支持语音输入，直接打字也一样。' }));
  }

  const errorBox = el('div', { class: 'voice-entry-error' });
  card.append(errorBox);

  const actions = el('div', { class: 'med-wizard-actions' });
  const micBtn = createButton({ label: MIC_IDLE_LABEL, variant: 'secondary', icon: 'mic', onClick: toggleListening });
  const micText = micBtn.querySelector('span');
  const submitBtn = createButton({ label: '整理成清单', icon: 'sparkles', onClick: () => void submit() });
  const submitText = submitBtn.querySelector('span');
  if (recognition) actions.append(micBtn);
  else submitBtn.style.gridColumn = '1 / -1';
  actions.append(submitBtn);

  sheet.append(grabber, head, card, actions);
  overlay.append(sheet);
  document.body.append(overlay);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    activeVoiceEntries.delete(dispose);
    parseAbort?.abort();
    stopListening();
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
    previouslyFocused?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dispose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.hasAttribute('disabled') && !element.hidden);
    if (focusable.length === 0) {
      event.preventDefault();
      sheet.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function setListening(on: boolean): void {
    listening = on;
    micBtn.classList.toggle('is-listening', on);
    if (micText) micText.textContent = on ? MIC_LISTENING_LABEL : MIC_IDLE_LABEL;
  }

  function stopListening(): void {
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      /* 已经停了就算了 */
    }
    if (listening) setListening(false);
  }

  function toggleListening(): void {
    if (!recognition || busy) return;
    if (listening) {
      stopListening();
      return;
    }
    errorBox.replaceChildren();
    try {
      recognition.start();
      setListening(true);
    } catch {
      showError('话筒没打开成功，等一下再点，或直接打字。');
    }
  }

  function showError(message: string, unconfigured = false): void {
    errorBox.replaceChildren(banner('warn', message));
    if (unconfigured) {
      errorBox.append(createButton({
        label: '去设置连一下',
        variant: 'secondary',
        icon: 'gear',
        onClick: () => {
          dispose();
          navigate('/settings');
        },
      }));
    }
  }

  function setBusy(on: boolean): void {
    busy = on;
    submitBtn.disabled = on;
    micBtn.disabled = on;
    input.disabled = on;
    if (submitText) submitText.textContent = on ? 'AI 正在整理…' : '整理成清单';
  }

  async function submit(): Promise<void> {
    if (busy || disposed) return;
    const text = input.value.trim();
    if (!text) {
      showError('先说一说或打几个字，再让 AI 整理。');
      input.focus();
      return;
    }
    stopListening();
    errorBox.replaceChildren();
    parseAbort = new AbortController();
    setBusy(true);
    try {
      const result = await parseMedicationSpeech(text, { signal: parseAbort.signal });
      if (disposed) return;
      if (result.items.length === 0) {
        showError('没听出来有哪些药。补充点信息再试试，比如药名、一天吃几次。');
        return;
      }
      const items = result.items;
      dispose();
      openMedOnboardWizard(items, {
        onFinish: (photos) => {
          setPendingMedicationBatch(items, photos);
          navigate('/meds/new');
        },
      });
    } catch (error) {
      if (disposed) return;
      if (error instanceof IdentifyError) {
        showError(error.message, error.hint === 'unconfigured');
      } else if (error instanceof DOMException && error.name === 'AbortError') {
        /* 用户关掉了弹窗，不用提示 */
      } else {
        showError(`整理失败：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      if (!disposed) setBusy(false);
      parseAbort = null;
    }
  }

  if (recognition) {
    recognition.onresult = (event) => {
      if (disposed) return;
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = String(result?.[0]?.transcript ?? '');
        if (result?.isFinal) finalText += transcript;
        else interimText = transcript; // 中间结果是"这一段话"迄今的全文，覆盖显示
      }
      if (finalText.trim()) {
        interim.textContent = '';
        const existing = input.value.trim();
        input.value = existing ? `${existing}，${finalText.trim()}` : finalText.trim();
      } else if (interimText.trim()) {
        interim.textContent = interimText.trim();
      }
    };
    recognition.onerror = (event) => {
      if (disposed) return;
      setListening(false);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showError('麦克风权限没打开。去浏览器设置里允许一下，或直接打字。');
      } else if (event.error === 'auth-failed') {
        showError('语音服务连不上：检查设置里的密钥填对没有，手机时间准不准。', true);
      } else if (event.error !== 'aborted' && event.error !== 'no-speech') {
        showError('刚才没听清，再点话筒试一次，或直接打字。');
      }
    };
    recognition.onend = () => {
      if (disposed) return;
      interim.textContent = ''; // 没定稿的预览不算数，别留着误导
      if (listening) setListening(false);
    };
  }

  quit.onclick = dispose;
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) dispose();
  });
  document.addEventListener('keydown', onKeyDown);
  activeVoiceEntries.add(dispose);
  sheet.focus({ preventScroll: true });
  return { close: dispose };
}
