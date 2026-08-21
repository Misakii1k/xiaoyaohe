import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n');

describe('native text selection contracts', () => {
  it('leaves dialogs and editable text to the platform selection menu', () => {
    const components = read('src/ui/components.ts');
    const reset = read('src/ui/styles/reset.css');
    const shell = read('src/ui/styles/shell.css');

    expect(components).not.toContain("overlay.addEventListener('contextmenu'");
    expect(shell).not.toContain('.confirm-dialog-overlay *');
    expect(reset).toContain(
      "input,\ntextarea,\n[contenteditable='true'] {\n" +
      '  user-select: text;\n' +
      '  -webkit-user-select: text;\n' +
      '  -webkit-touch-callout: default;\n' +
      '}',
    );
  });

  it('suppresses the system menu only on controls with dedicated hold gestures', () => {
    const assistantStyles = read('src/ui/styles/pages/assistant.css');
    const medicationEditorStyles = read('src/ui/styles/pages/medication-editor.css');

    expect(assistantStyles).toMatch(/\.ai-launcher\s*\{[^}]*touch-action:\s*none;[^}]*user-select:\s*none;/s);
    expect(medicationEditorStyles).toMatch(/\.box-photo-crop-stage\s*\{[^}]*touch-action:\s*none;[^}]*user-select:\s*none;/s);
  });
});
