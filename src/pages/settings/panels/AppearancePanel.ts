import { el, toast } from '../../../ui/components';
import { createSegmentedControl } from '../../../ui/primitives/SegmentedControl';
import { getThemePreference, setThemePreference, type ThemePreference } from '../../../ui/theme';
import {
  getLiquidGlassPreference,
  setLiquidGlassPreference,
  type LiquidGlassPreference,
} from '../../../ui/liquidGlass';
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
    iconTone: 'violet',
    chip: appearancePanelChip(),
    defaultOpen: false,
    renderBody: (body) => {
      // 1. 配色方案微卡片
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

      const themeDesc = el('div', {
        class: 'settings-subcard-desc',
        text: '选择小药盒的主题风格。选择“跟随系统”将自动配合手机深色模式昼夜自适应。',
      });

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
      themeCard.append(themeHeader, themeDesc, control);

      // 2. 界面动效与材质微卡片
      const liquidEnabled = getLiquidGlassPreference() === 'on';
      const glassCard = el('div', { class: 'settings-subcard' });
      const glassHeader = el('div', { class: 'settings-subcard-header' });
      const glassTitleWrap = el('div', { class: 'settings-subcard-title-wrap' }, [
        el('span', { class: 'settings-subcard-title', text: '界面动效与材质' }),
      ]);
      const glassBadge = el('span', {
        class: `chip-pill ${liquidEnabled ? 'chip-primary' : ''}`,
        text: liquidEnabled ? '高光质感' : '省电模式',
      });
      glassHeader.append(glassTitleWrap, glassBadge);

      const liquidRow = el('label', { class: 'settings-toggle-row' });
      const liquidCopy = el('div', { class: 'settings-toggle-copy' });
      liquidCopy.append(
        el('div', { class: 'settings-toggle-title', text: '液态玻璃效果' }),
        el('div', {
          class: 'settings-toggle-desc',
          text: liquidEnabled
            ? '底栏与弹层带折射高光的玻璃质感，更具通透立体感'
            : '已关闭：使用普通毛玻璃材质，功耗更低更省电',
        }),
      );
      const liquidToggle = el('input', {
        type: 'checkbox',
        role: 'switch',
        'aria-label': '液态玻璃效果',
      });
      liquidToggle.checked = liquidEnabled;
      liquidToggle.onchange = () => {
        const next: LiquidGlassPreference = liquidToggle.checked ? 'on' : 'off';
        setLiquidGlassPreference(next);
        const on = liquidToggle.checked;
        glassBadge.className = `chip-pill ${on ? 'chip-primary' : ''}`;
        glassBadge.textContent = on ? '高光质感' : '省电模式';
        toast(on ? '液态玻璃已开启' : '液态玻璃已关闭');
        const desc = liquidCopy.querySelector<HTMLElement>('.settings-toggle-desc');
        if (desc) {
          desc.textContent = on
            ? '底栏与弹层带折射高光的玻璃质感，更具通透立体感'
            : '已关闭：使用普通毛玻璃材质，功耗更低更省电';
        }
      };
      liquidRow.append(liquidCopy, liquidToggle);
      glassCard.append(glassHeader, liquidRow);

      body.append(themeCard, glassCard);
    },
  });
}
