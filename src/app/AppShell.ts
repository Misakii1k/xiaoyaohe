export interface AppShellOptions {
  root: HTMLElement;
  header: HTMLElement;
  content: HTMLElement;
  navigation?: HTMLElement;
  dock?: HTMLElement;
}

/**
 * The only layout owner for app chrome. Pages render their content only, so
 * system insets and fixed navigation cannot cover page-specific controls.
 */
export function renderAppShell(options: AppShellOptions): void {
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  options.header.classList.add('app-header');
  options.content.classList.add('app-main');
  shell.append(options.header, options.content);

  if (options.dock) {
    options.dock.classList.add('action-dock');
    shell.append(options.dock);
  }

  if (options.navigation) {
    options.navigation.classList.add('app-navigation');
    shell.append(options.navigation);
  }

  options.root.replaceChildren(shell);
}
