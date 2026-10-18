import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('scanner workbench visual contracts', () => {
  it('keeps sorting entry cards and camera actions in an unframed workbench', () => {
    const styles = readFileSync(join(root, 'src/ui/styles/pages/scanner.css'), 'utf8');

    expect(styles).toContain('.scan-workbench');
    expect(styles).toContain('.scan-entry-card');
    expect(styles).not.toContain('.scan-mode-bar');
    expect(styles).toContain('position: static');
    expect(styles).toContain('.scan-action-card');
    expect(styles).toContain('box-shadow: none');
  });

  it('positions the page as pill sorting and enters each mode straight from its entry', () => {
    const page = readFileSync(join(root, 'src/pages/ScanSort.ts'), 'utf8');

    expect(page).toContain("title: '分药'");
    expect(page).not.toContain('scan-mode-bar');
    expect(page).not.toContain("role: 'tablist'");
  });

  it('keeps two scanner actions readable on a 320px viewport', () => {
    const styles = readFileSync(join(root, 'src/ui/styles/pages/scanner.css'), 'utf8');

    expect(styles).toContain('.scan-actions .btn');
    expect(styles).toContain('white-space: nowrap');
    expect(styles).toContain('padding-inline: var(--space-3)');
  });

  it('uses the shared primary, tonal, and text hierarchy for camera actions', () => {
    const page = readFileSync(join(root, 'src/pages/ScanSort.ts'), 'utf8');
    const styles = readFileSync(join(root, 'src/ui/styles/pages/scanner.css'), 'utf8');
    const cameraFlow = page.slice(
      page.indexOf('async function openCameraCapture'),
      page.indexOf('function renderCameraUnavailable'),
    );

    expect(cameraFlow).toContain("'拍照', 'btn camera-shutter'");
    expect(cameraFlow).toContain("iconButton('image', '相册上传', 'btn tonal')");
    expect(cameraFlow).toContain("iconButton('arrow-left', '返回', 'btn text')");
    expect(cameraFlow).not.toContain("'btn success camera-shutter'");
    expect(styles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(styles).toContain('grid-column: 1 / -1');
    expect(styles).toContain('background: var(--color-primary-pressed)');
    // 快门文字必须用反色，不能和背景同色（旧契约把文字写成 primary-pressed，真机上看不见）
    expect(styles).toContain('color: var(--color-on-primary)');
    expect(styles).toContain('max-inline-size: 620px');
    expect(styles).toContain('.camera-actions .btn:focus-visible');
    expect(styles).toContain('outline: 3px solid var(--color-primary-pressed)');
    expect(cameraFlow).toContain("document.body.classList.add('camera-capture-active')");
    expect(cameraFlow).toContain("document.body.classList.remove('camera-capture-active')");
    expect(cameraFlow).toContain('capture.focus()');
    expect(cameraFlow).toContain("opts.box.querySelector<HTMLButtonElement>('button')?.focus()");
    expect(styles).toContain('body.camera-capture-active .ai-launcher');
    expect(styles).toContain('body.camera-capture-active .tabbar');
  });

  it('uses one concise recovery path when the camera is unavailable', () => {
    const page = readFileSync(join(root, 'src/pages/ScanSort.ts'), 'utf8');
    const unavailable = page.slice(
      page.indexOf('function renderScannerUnavailable'),
      page.indexOf('function renderSheetStart'),
    );

    expect(unavailable).toContain("setHint(hint, 'info'");
    expect(unavailable).toContain("'相册识别条码'");
    expect(unavailable).not.toContain("banner('warn', message)");
  });
});
