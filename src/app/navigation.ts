import type { AppIconName } from '../ui/icons/iconRegistry';

export interface PrimaryNavigationItem {
  id: 'today' | 'meds' | 'scan' | 'work' | 'settings';
  href: string;
  label: string;
  icon: AppIconName;
}

export const primaryNavigation: readonly PrimaryNavigationItem[] = [
  { id: 'today', href: '/today', label: '今日', icon: 'calendar' },
  { id: 'meds', href: '/meds', label: '药品', icon: 'pill' },
  { id: 'scan', href: '/scan', label: '分药', icon: 'pillbox' },
  { id: 'work', href: '/work', label: '工时', icon: 'briefcase' },
  { id: 'settings', href: '/settings', label: '设置', icon: 'gear' },
];
