import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(join(root, path), 'utf8');

describe('medication batch editor progressive disclosure', () => {
  it('keeps only primary fields at the top and separates optional details into three accordions', () => {
    const editor = source('src/ui/MedicationBatchEditor.ts');
    const page = source('src/pages/MedBatchAdd.ts');

    expect(editor).toContain("title: '库存与有效期'");
    expect(editor).toContain("title: '用药规则'");
    expect(editor).toContain("title: '备注与识别依据'");
    expect(editor).not.toContain("title: '更多设置'");
    expect(page).not.toContain('先填写常用信息；库存、有效期、周期和备注可按需展开。');
  });

  it('uses the shared bottom action dock for save, delete, and return actions', () => {
    const page = source('src/pages/MedEdit.ts');

    expect(page).toContain('createActionDock');
    expect(page).toContain('medication-editor-dock');
    expect(page).toContain("variant: 'danger'");
    expect(page).toContain('actionDock });');
  });
});
