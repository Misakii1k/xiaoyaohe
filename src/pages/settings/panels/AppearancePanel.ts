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
      body.append(el('div', {
        class: 'settings-hint mb-3',
        text: '选择小药盒的配色。跟随系统会随手机的深色模式自动切换。',
      }));
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
          const host = body.closest('.panel');
          if (host) setChip(host as HTMLElement, appearancePanelChip());
          toast(`已切换为${THEME_PREFERENCE_LABEL[value]}`);
        },
      );
      body.append(control);

      const liquidEnabled = getLiquidGlassPreference() === 'on';
      const liquidRow = el('label', { class: 'settings-toggle-row mt-3' });
      const liquidCopy = el('div', { class: 'settings-toggle-copy' });
      liquidCopy.append(
        el('div', { class: 'settings-toggle-title', text: '液态玻璃效果' }),
        el('div', {
          class: 'settings-toggle-desc',
          text: liquidEnabled
            ? '底栏与弹层带折射高光的玻璃质感，更耗一点电'
            : '已关闭：使用普通毛玻璃材质，更省电',
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
        toast(liquidToggle.checked ? '液态玻璃已开启' : '液态玻璃已关闭');
        // 描述随状态变化
        const desc = liquidCopy.querySelector<HTMLElement>('.settings-toggle-desc');
        if (desc) {
          desc.textContent = liquidToggle.checked
            ? '底栏与弹层带折射高光的玻璃质感，更耗一点电'
            : '已关闭：使用普通毛玻璃材质，更省电';
        }
      };
      liquidRow.append(liquidCopy, liquidToggle);
      body.append(liquidRow);
    },
  });
}
