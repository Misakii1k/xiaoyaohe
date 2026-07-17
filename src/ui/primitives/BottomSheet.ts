import { registerRouteTransitionCleanup } from '../../router';

export interface BottomSheetOptions {
  label: string;
  content: Node | readonly Node[];
  initialFocus?: HTMLElement;
  onClose?: () => void;
}

export interface BottomSheetHandle {
  overlay: HTMLElement;
  close: () => void;
}

const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
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
  sheet.className = 'bottom-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', options.label);
  const content = Array.isArray(options.content) ? options.content : [options.content];
  sheet.append(...content);
  overlay.append(sheet);
  document.body.append(overlay);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown);
    activeBottomSheets.delete(close);
    overlay.remove();
    previouslyFocused?.focus({ preventScroll: true });
    options.onClose?.();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.hasAttribute('disabled'));
    if (focusable.length === 0) {
      event.preventDefault();
      sheet.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown);
  activeBottomSheets.add(close);
  sheet.tabIndex = -1;
  (options.initialFocus ?? sheet.querySelector<HTMLElement>(focusableSelector) ?? sheet)
    .focus({ preventScroll: true });
  return { overlay, close };
}
