export function createActionDock(children: readonly Node[] = []): HTMLElement {
  const dock = document.createElement('div');
  dock.className = 'action-dock';
  dock.setAttribute('aria-label', '页面操作');
  dock.append(...children);
  return dock;
}
