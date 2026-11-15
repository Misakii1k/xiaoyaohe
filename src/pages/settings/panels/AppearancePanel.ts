import { el, toast } from '../../../ui/components';
import { createSegmentedControl } from '../../../ui/primitives/SegmentedControl';
import {
  CARE_MODE_CHANGE_EVENT,
  isCareModeEnabled,
  setCareModeEnabled,
} from '../../../features/careMode';
import { getThemePreference, setThemePreference, type ThemePreference } from '../../../ui/theme';
import type { PanelChip } from '../types';
import { panel, setChip } from '../components/panelPrimitives';

const THEME_PREFERENCE_LABEL: Record<ThemePreference, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

export function appearancePanelChip(): PanelChip {
  const pref = getThemePreference();
  const careOn = isCareModeEnabled();
  return {
    text: careOn ? `${THEME_PREFERENCE_LABEL[pref]} · 关怀大字` : THEME_PREFERENCE_LABEL[pref],
    tone: careOn || pref !== 'system' ? 'info' : 'muted',
  };
}

export function renderAppearancePanel(): HTMLElement {
  return panel({
    title: '界面外观',
    iconName: 'moon',
    iconTone: 'sky',
    chip: appearancePanelChip(),
    defaultOpen: false,
    renderBody: (body) => {
      // 配色方案微卡片
      const themeCard = el('div', { class: 'settings-subcard' });
      const themeHeader = el('div', { class: 'settings-subcard-header' });
      const themeTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
        el('span', { class: 'settings-subcard-title', text: '配色方案' }),
      ]);
      const themeBadge = el('span', {
        class: 'chip-pill chip-primary',
        text: THEME_PREFERENCE_LABEL[getThemePreference()],
      });
      themeHeader.append(themeTitleWrap, themeBadge);

      const control = createSegmentedControl<ThemePreference>(
        '配色方案',
        [
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ],
        getThemePreference(),
        (value) => {
          setThemePreference(value);
          themeBadge.textContent = THEME_PREFERENCE_LABEL[value];
          const host = body.closest('.panel');
          if (host) setChip(host as HTMLElement, appearancePanelChip());
          toast(`已切换为${THEME_PREFERENCE_LABEL[value]}`);
        },
      );
      themeCard.append(themeHeader, control);

      // 关怀模式（大字与高对比度）微卡片
      const careCard = el('div', { class: 'settings-subcard' });
      const careHeader = el('div', { class: 'settings-subcard-header' });
      const careTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
        el('span', { class: 'settings-subcard-title', text: '关怀大字模式' }),
      ]);
      const careBadge = el('span', {
        class: isCareModeEnabled() ? 'chip-pill chip-primary' : 'chip-pill',
        text: isCareModeEnabled() ? '已开启' : '标准大小',
      });
      careHeader.append(careTitleWrap, careBadge);

      const careDesc = el('div', {
        class: 'settings-toggle-desc',
        text: isCareModeEnabled()
          ? '已放大全站字号与按钮触控区，加粗药名并增强对比度'
          : '放大字号、加粗关键文字与药名，增大按钮方便点按',
      });
      const careRow = el('label', { class: 'settings-toggle-row' });
      const careCopy = el('div', { class: 'settings-toggle-copy' }, [
        el('div', { class: 'settings-toggle-title', text: '大字与高对比度界面' }),
        careDesc,
      ]);
      const careToggle = el('input', {
        type: 'checkbox',
        role: 'switch',
        'aria-label': '开启关怀大字模式',
      }) as HTMLInputElement;
      careToggle.checked = isCareModeEnabled();

      const syncCareCardState = (enabled: boolean) => {
        careToggle.checked = enabled;
        careBadge.className = enabled ? 'chip-pill chip-primary' : 'chip-pill';
        careBadge.textContent = enabled ? '已开启' : '标准大小';
        careDesc.textContent = enabled
          ? '已放大全站字号与按钮触控区，加粗药名并增强对比度'
          : '放大字号、加粗关键文字与药名，增大按钮方便点按';
        const host = body.closest('.panel');
        if (host) setChip(host as HTMLElement, appearancePanelChip());
      };

      careToggle.onchange = () => {
        const next = careToggle.checked;
        void setCareModeEnabled(next);
        syncCareCardState(next);
        toast(next ? '已开启关怀大字模式' : '已切换为标准字体');
      };

      if (typeof window !== 'undefined') {
        const onExternalCareChange = (event: Event) => {
          if (!careToggle.isConnected) {
            window.removeEventListener(CARE_MODE_CHANGE_EVENT, onExternalCareChange);
            return;
          }
          const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
          if (typeof detail?.enabled === 'boolean') {
            syncCareCardState(detail.enabled);
          }
        };
        window.addEventListener(CARE_MODE_CHANGE_EVENT, onExternalCareChange);
      }

      careRow.append(careCopy, careToggle);
      careCard.append(careHeader, careRow);

      body.append(themeCard, careCard);
    },
  });
}
