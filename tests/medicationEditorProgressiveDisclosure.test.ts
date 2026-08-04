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

describe('medication editor period-level reminder contract', () => {
  it('removes the per-medication reminder-mode selector from MedEdit', () => {
    const page = source('src/pages/MedEdit.ts');

    // 提醒方式选择器已退役：不再渲染、不再写回 med.reminderMode
    expect(page).not.toContain('提醒方式', );
    expect(page).not.toContain('medication-reminder-mode');
    expect(page).not.toContain('selectedReminderMode');
    expect(page).not.toContain('MEDICATION_REMINDER_MODE_LABEL');
    // 改为指向设置页的时段级提示
    expect(page).toContain('时段提醒设置');
    expect(page).toContain('refreshReminderHint');
  });

  it('keeps the legacy reminderMode field only as inert schema compatibility', () => {
    const page = source('src/pages/MedEdit.ts');
    expect(page).toContain("reminderMode: 'strong'");
  });
});
