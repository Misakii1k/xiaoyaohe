import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('medication form and selection semantics', () => {
  it('names dynamic schedule controls with their medication slot', () => {
    const source = readFileSync(join(root, 'src', 'pages', 'MedEdit.ts'), 'utf8');

    expect(source).toContain("'aria-label': `${SLOT_LABEL[s]}服药时间`");
    expect(source).toMatch(
      /class: 'chips meal-combo-chips',[\s\S]*?role: 'group',[\s\S]*?'aria-label': `\$\{SLOT_LABEL\[s\]\}餐食关系`/,
    );
  });

  it('labels each batch checkbox with the medication name in its card', () => {
    const source = readFileSync(join(root, 'src', 'pages', 'MedList.ts'), 'utf8');

    expect(source).toContain("'aria-labelledby': medNameId");
    expect(source).toMatch(
      /el\('div', \{ id: medNameId, class: 'med-card-name', html: m\.name \|\| '未命名' \}\)/,
    );
  });
});
