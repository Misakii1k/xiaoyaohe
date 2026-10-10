import { el, toast } from '../../../ui/components';
import { createSegmentedControl } from '../../../ui/primitives/SegmentedControl';
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
  return { text: THEME_PREFERENCE_LABEL[pref], tone: pref === 'system' ? 'muted' : 'info' };
}

export function renderAppearancePanel(): HTMLElement {
  return panel({
    title: '外观',
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

      body.append(themeCard);
    },
  });
}
