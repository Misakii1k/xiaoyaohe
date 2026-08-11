import { registerRouteTransitionCleanup } from '../../router';
import { makeAppInert, restoreAppAfterLastDialog, trapFocusIn } from '../components';

export interface BottomSheetOptions {
  label: string;
  content: Node | readonly Node[];
  /** Adds a component-owned class to the sheet without duplicating modal lifecycle code. */
  className?: string;
  initialFocus?: HTMLElement;
  onClose?: () => void;
  /**
   * Close when the backdrop overlay itself is tapped. Defaults to true.
   * Guided flows (wizards) pass false so a stray tap cannot abandon progress.
   */
  dismissOnOverlay?: boolean;
  /**
   * Close on Escape. Defaults to true. Guided flows can disable this and
   * wire their own Escape semantics through the sheet's content.
   */
  dismissOnEscape?: boolean;
}

export interface BottomSheetHandle {
  overlay: HTMLElement;
  close: () => void;
}

const activeBottomSheets = new Set<() => void>();

/** Close every open sheet before its triggering page is replaced. */
export function closeAllBottomSheets(): void {
  for (const close of Array.from(activeBottomSheets).reverse()) close();
}

registerRouteTransitionCleanup(closeAllBottomSheets);

export function openBottomSheet(options: BottomSheetOptions): BottomSheetHandle {
  const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';
  overlay.setAttribute('role', 'presentation');

  const sheet = document.createElement('section');
  sheet.className = `bottom-sheet${options.className ? ` ${options.className}` : ''}`;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', options.label);
  const content = Array.isArray(options.content) ? options.content : [options.content];
  sheet.append(...content);
  overlay.append(sheet);
  document.body.append(overlay);
  makeAppInert();

  let closed = false;
  let removeTrap: (() => void) | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    removeTrap?.();
    activeBottomSheets.delete(close);
    overlay.remove();
    restoreAppAfterLastDialog();
    previouslyFocused?.focus({ preventScroll: true });
    options.onClose?.();
  };

  removeTrap = trapFocusIn(sheet, options.dismissOnEscape === false ? null : close);

  overlay.addEventListener('click', (event) => {
    if (options.dismissOnOverlay === false) return;
    if (event.target === overlay) close();
  });
  activeBottomSheets.add(close);
  sheet.tabIndex = -1;
  (options.initialFocus ?? sheet.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? sheet)
    .focus({ preventScroll: true });
  return { overlay, close };
}
