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

  it('uses one concise recovery path when the camera is unavailable', () => {
    const page = readFileSync(join(root, 'src/pages/ScanSort.ts'), 'utf8');
    const unavailable = page.slice(
      page.indexOf('function renderScannerUnavailable'),
      page.indexOf('function renderSmartStart'),
    );

    expect(unavailable).toContain("setHint(hint, 'info'");
    expect(unavailable).toContain("'相册识别条码'");
    expect(unavailable).not.toContain("banner('warn', message)");
  });
});
