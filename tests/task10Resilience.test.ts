// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDiagnosticLogs } from '../src/app/diagnostics';
import { route, startRouter } from '../src/router';

const rootDirectory = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(rootDirectory, path), 'utf8');

describe('Task10 route recovery', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    location.hash = '';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a safe explanation, records diagnostics, and retries the failed route', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    let attempts = 0;
    route('/task10-retry', (_params, routeRoot) => {
      attempts += 1;
      if (attempts === 1) throw new Error('token=private https://private.example/record');
      const heading = document.createElement('h1');
      heading.textContent = '恢复成功';
      routeRoot.replaceChildren(heading);
    });

    startRouter(root, '/task10-retry');
    await vi.waitFor(() => expect(root.textContent).toContain('暂时无法打开这个页面'));

    expect(root.getAttribute('aria-busy')).toBeNull();
    expect(root.textContent).toContain('你的用药记录没有丢失');
    expect(root.textContent).not.toContain('private.example');
    expect(root.textContent).not.toContain('token=private');
    expect(listDiagnosticLogs()).toHaveLength(1);
    expect(JSON.stringify(listDiagnosticLogs())).not.toContain('private.example');

    root.querySelector<HTMLButtonElement>('button')?.click();
    await vi.waitFor(() => expect(root.textContent).toContain('恢复成功'));
    expect(attempts).toBe(2);
  });
});

describe('Task10 page resilience styles', () => {
  it.each([
    'src/ui/styles/pages/today.css',
    'src/ui/styles/pages/medications.css',
  ])('covers dark mode, safe areas, zoom layouts, and reduced motion in %s', (path) => {
    const styles = source(path);

    expect(styles).toContain("[data-theme='dark']");
    expect(styles).toContain('var(--safe-bottom)');
    expect(styles).toMatch(/@media \(max-width: 420px\)/);
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none');
  });
});
