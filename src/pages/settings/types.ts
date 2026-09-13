import type { IconName } from '../../ui/components';

export interface SettingsRenderPart {
  element: HTMLElement;
  cleanup: () => void;
}

export interface PanelChip {
  text: string;
  tone: 'ok' | 'warn' | 'info' | 'muted';
}

export type PanelIconTone =
  | 'amber'
  | 'emerald'
  | 'violet'
  | 'orange'
  | 'sky'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'rose'
  | 'gold'
  | 'cyan';

export interface PanelOpts {
  title: string;
  iconName: IconName;
  iconTone?: PanelIconTone;
  chip: PanelChip;
  defaultOpen?: boolean;
  renderBody: (body: HTMLElement) => void;
}
