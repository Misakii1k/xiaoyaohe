import { el, toast } from '../../../ui/components';
import { createButton } from '../../../ui/primitives/Button';
import { createSegmentedControl } from '../../../ui/primitives/SegmentedControl';
import {
  SORT_TTS_CHANGE_EVENT,
  getSortTtsRate,
  isSortTtsEnabled,
  setSortTtsEnabled,
  setSortTtsRate,
  speakSortText,
  stopSortSpeech,
  type SortTtsRate,
} from '../../../features/sortTts';
import type { PanelChip } from '../types';
import { panel, setChip } from '../components/panelPrimitives';

const RATE_LABEL: Record<SortTtsRate, string> = {
  normal: '标准',
  slow: '稍慢清晰',
};

const VOICE_PREVIEW_SAMPLE = '阿莫西林胶囊，早上 1 片，晚上 1 片';

export function voicePanelChip(): PanelChip {
  if (!isSortTtsEnabled()) return { text: '已关闭', tone: 'muted' };
  const rate = getSortTtsRate();
  return {
    text: rate === 'slow' ? '已开启 · 稍慢' : '已开启',
    tone: 'ok',
  };
}

export function renderVoicePanel(): HTMLElement {
  return panel({
    title: '语音播报',
    iconName: 'volume',
    iconTone: 'teal',
    chip: voicePanelChip(),
    defaultOpen: false,
    renderBody: (body) => {
      // 分药语音播报总开关
      const toggleCard = el('div', { class: 'settings-subcard' });
      const toggleHeader = el('div', { class: 'settings-subcard-header' });
      const toggleTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
        el('span', { class: 'settings-subcard-title', text: '分药向导语音' }),
      ]);
      const statusBadge = el('span', {
        class: isSortTtsEnabled() ? 'chip-pill chip-primary' : 'chip-pill',
        text: isSortTtsEnabled() ? '已开启' : '已关闭',
      });
      toggleHeader.append(toggleTitleWrap, statusBadge);

      const toggleDesc = el('div', {
        class: 'settings-toggle-desc',
        text: isSortTtsEnabled()
          ? '打开分药向导或切换药品时，会自动读出药名与今天用量'
          : '已静音，打开分药向导时仅看文字，可随时点“重听”临时听一遍',
      });
      const toggleRow = el('label', { class: 'settings-toggle-row' });
      const toggleCopy = el('div', { class: 'settings-toggle-copy' }, [
        el('div', { class: 'settings-toggle-title', text: '分药时自动语音播报' }),
        toggleDesc,
      ]);
      const switchInput = el('input', {
        type: 'checkbox',
        role: 'switch',
        'aria-label': '分药时自动语音播报',
      }) as HTMLInputElement;
      switchInput.checked = isSortTtsEnabled();

      toggleRow.append(toggleCopy, switchInput);
      toggleCard.append(toggleHeader, toggleRow);

      // 语速与试听卡片
      const rateCard = el('div', { class: 'settings-subcard' });
      const rateHeader = el('div', { class: 'settings-subcard-header' });
      const rateTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
        el('span', { class: 'settings-subcard-title', text: '朗读语速' }),
      ]);
      const rateBadge = el('span', {
        class: 'chip-pill chip-primary',
        text: RATE_LABEL[getSortTtsRate()],
      });
      rateHeader.append(rateTitleWrap, rateBadge);

      const rateControl = createSegmentedControl<SortTtsRate>(
        '朗读语速',
        [
          { value: 'normal', label: '标准' },
          { value: 'slow', label: '稍慢清晰' },
        ],
        getSortTtsRate(),
        (value) => {
          setSortTtsRate(value);
          rateBadge.textContent = RATE_LABEL[value];
          const host = body.closest('.panel');
          if (host) setChip(host as HTMLElement, voicePanelChip());
          toast(`语速已调为${RATE_LABEL[value]}`);
        },
      );

      const previewActions = el('div', { class: 'settings-voice-actions' });
      const previewBtn = createButton({
        label: '试听示例',
        variant: 'secondary',
        icon: 'volume',
        onClick: () => {
          void speakSortText(VOICE_PREVIEW_SAMPLE, {
            force: true,
            alwaysNotifyUnsupported: true,
            onUnsupported: () => toast('当前设备暂不支持中文语音播报'),
          });
        },
      });
      previewActions.append(previewBtn);

      rateCard.append(rateHeader, rateControl, previewActions);

      const syncVoicePanelState = (enabled: boolean, rate: SortTtsRate) => {
        switchInput.checked = enabled;
        statusBadge.className = enabled ? 'chip-pill chip-primary' : 'chip-pill';
        statusBadge.textContent = enabled ? '已开启' : '已关闭';
        toggleDesc.textContent = enabled
          ? '打开分药向导或切换药品时，会自动读出药名与今天用量'
          : '已静音，打开分药向导时仅看文字，可随时点“重听”临时听一遍';
        rateBadge.textContent = RATE_LABEL[rate];
        const segButtons = Array.from(rateControl.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
        segButtons.forEach((btn, idx) => {
          const val: SortTtsRate = idx === 1 ? 'slow' : 'normal';
          btn.setAttribute('aria-checked', String(val === rate));
        });
        const host = body.closest('.panel');
        if (host) setChip(host as HTMLElement, voicePanelChip());
      };

      switchInput.onchange = () => {
        const next = switchInput.checked;
        setSortTtsEnabled(next);
        if (!next) stopSortSpeech();
        syncVoicePanelState(next, getSortTtsRate());
        toast(next ? '已开启分药语音播报' : '已关闭分药语音播报');
      };

      if (typeof window !== 'undefined') {
        const onExternalVoiceChange = (event: Event) => {
          if (!switchInput.isConnected) {
            window.removeEventListener(SORT_TTS_CHANGE_EVENT, onExternalVoiceChange);
            return;
          }
          const detail = (event as CustomEvent<{ enabled?: boolean; rate?: SortTtsRate }>).detail;
          syncVoicePanelState(
            typeof detail?.enabled === 'boolean' ? detail.enabled : isSortTtsEnabled(),
            detail?.rate ?? getSortTtsRate(),
          );
        };
        window.addEventListener(SORT_TTS_CHANGE_EVENT, onExternalVoiceChange);
      }

      body.append(toggleCard, rateCard);
    },
  });
}
