export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'muted';

export function createStatusBadge(label: string, tone: StatusTone): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `status-badge status-badge-${tone}`;
  badge.textContent = label;
  return badge;
}
