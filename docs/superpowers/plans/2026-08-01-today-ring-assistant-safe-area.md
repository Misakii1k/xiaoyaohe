# 0.9.4 Today Ring And Assistant Safe Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enlarge the Today summary ring to 112px and keep the full-screen assistant header clear of portrait status bars and landscape cutouts in the existing 0.9.4 working copy.

**Architecture:** Keep both changes in their existing page-owned CSS files. Add a static UI contract before the assistant CSS change, then use the existing Playwright assistant flow to verify computed safe-area spacing and viewport containment without changing TypeScript behavior.

**Tech Stack:** TypeScript, CSS logical properties, Vitest, Playwright, Vite, Capacitor CSS safe-area tokens

---

### Task 1: Add The Full-Screen Assistant Safe-Area Contract

**Files:**
- Modify: `tests/uiArchitectureContracts.test.ts`
- Test: `tests/uiArchitectureContracts.test.ts`

- [ ] **Step 1: Write the failing static contract**

Add this test inside the existing `describe` block:

```ts
it('keeps the full-screen assistant header inside system safe areas', () => {
  const assistant = source('src/ui/styles/pages/assistant.css');
  expect(assistant).toMatch(/\.ai-panel\.is-fullscreen \.ai-panel-header\s*\{[^}]*var\(--safe-top\)/s);
  expect(assistant).toMatch(/\.ai-panel\.is-fullscreen \.ai-panel-header\s*\{[^}]*var\(--safe-left\)/s);
  expect(assistant).toMatch(/\.ai-panel\.is-fullscreen \.ai-panel-header\s*\{[^}]*var\(--safe-right\)/s);
});
```

- [ ] **Step 2: Run the contract and verify it fails**

Run: `npm test -- tests/uiArchitectureContracts.test.ts`

Expected: FAIL because `assistant.css` does not yet contain a full-screen header rule that consumes the three safe-area tokens.

- [ ] **Step 3: Preserve the failure output for comparison**

Confirm the only new failure is the new safe-area contract. Do not edit unrelated failing tests or existing 0.9.4 files.

### Task 2: Implement The Two CSS Changes

**Files:**
- Modify: `src/ui/styles/pages/today.css:29-47`
- Modify: `src/ui/styles/pages/assistant.css:94-110`
- Test: `tests/uiArchitectureContracts.test.ts`

- [ ] **Step 1: Enlarge the Today summary ring**

Change the fixed dimensions in `today.css` to:

```css
.today-summary-progress {
  inline-size: 112px;
  block-size: 112px;
}

.today-summary-progress .progress-ring {
  inline-size: 112px;
  block-size: 112px;
  flex: 0 0 112px;
}
```

Keep every other declaration in both rules unchanged.

- [ ] **Step 2: Add full-screen-only header insets**

Add this rule immediately after `.ai-panel.is-fullscreen`:

```css
.ai-panel.is-fullscreen .ai-panel-header {
  padding:
    calc(var(--safe-top) + var(--space-4))
    max(var(--space-4), var(--safe-right))
    var(--space-3)
    max(var(--space-4), var(--safe-left));
}
```

Do not add padding to the full-screen panel itself. Keep the existing composer bottom safe-area rule unchanged.

- [ ] **Step 3: Run the focused contract**

Run: `npm test -- tests/uiArchitectureContracts.test.ts`

Expected: PASS.

- [ ] **Step 4: Run TypeScript static checks**

Run: `npm run typecheck`

Expected: exit code 0 with no diagnostics.

### Task 3: Add Rendered Regression Coverage

**Files:**
- Modify: `e2e/assistant-cards.spec.ts`
- Test: `e2e/assistant-cards.spec.ts`

- [ ] **Step 1: Add a full-screen safe-area test**

Append this test:

```ts
test('keeps the full-screen assistant inside injected system safe areas', async ({ page }) => {
  await page.addInitScript(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '32px');
    document.documentElement.style.setProperty('--safe-area-inset-right', '24px');
    document.documentElement.style.setProperty('--safe-area-inset-left', '20px');
  });
  await page.goto('/?assistant-preview=1#/settings');
  await page.getByRole('button', { name: '展开面板' }).click();

  const panel = page.locator('.ai-panel');
  const header = panel.locator('.ai-panel-header');
  await expect(panel).toHaveClass(/is-fullscreen/);
  await expect(page.getByRole('button', { name: '收起面板' })).toBeVisible();

  const layout = await header.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: box.top,
      left: box.left,
      right: box.right,
      paddingTop: Number.parseFloat(style.paddingTop),
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      viewportWidth: window.innerWidth,
      bodyWidth: document.body.scrollWidth,
    };
  });

  expect(layout.top).toBe(0);
  expect(layout.paddingTop).toBeGreaterThanOrEqual(32);
  expect(layout.paddingLeft).toBeGreaterThanOrEqual(20);
  expect(layout.paddingRight).toBeGreaterThanOrEqual(24);
  expect(layout.left).toBe(0);
  expect(layout.right).toBe(layout.viewportWidth);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
```

- [ ] **Step 2: Run the assistant E2E test on phone and landscape projects**

Run: `npx playwright test e2e/assistant-cards.spec.ts --project=phone-320 --project=tablet-landscape`

Expected: both card-layout and safe-area tests pass in both projects.

- [ ] **Step 3: Inspect generated failure artifacts only if needed**

If a test fails, inspect `output/playwright/test-results` and adjust only assertions that misrepresent browser CSS computation. Do not weaken safe-area or overflow assertions.

### Task 4: Complete Build And Browser Validation

**Files:**
- Verify: `src/ui/styles/pages/today.css`
- Verify: `src/ui/styles/pages/assistant.css`
- Verify: `tests/uiArchitectureContracts.test.ts`
- Verify: `e2e/assistant-cards.spec.ts`

- [ ] **Step 1: Build the web application**

Run: `npm run build`

Expected: TypeScript and Vite build complete successfully.

- [ ] **Step 2: Run the focused tests again as a second verification round**

Run: `npm test -- tests/uiArchitectureContracts.test.ts tests/uiPrimitivesContracts.test.ts tests/todayUiContracts.test.ts`

Expected: all selected test files pass.

- [ ] **Step 3: Preview the 0.9.4 app in the integrated browser**

Start: `npm run dev -- --host 127.0.0.1`

Open the printed local URL and verify `/#/today` renders meaningful content with no framework overlay or relevant console errors.

- [ ] **Step 4: Verify the Today ring**

Inspect `.today-summary-progress` and `.progress-ring`. Confirm both computed inline and block sizes are 112px, the summary card has no overlap, and the page has no horizontal overflow at 320px and 390px widths.

- [ ] **Step 5: Verify the assistant interaction loop**

Open the assistant, expand it, and confirm the expand control changes to “收起面板”. Inject or emulate non-zero safe-area tokens and confirm the header title and controls remain below the top inset and inside left/right insets. Collapse or close the assistant and confirm the normal floating panel keeps its original spacing.

- [ ] **Step 6: Review the final diff without committing**

Run: `git diff -- src/ui/styles/pages/today.css src/ui/styles/pages/assistant.css tests/uiArchitectureContracts.test.ts e2e/assistant-cards.spec.ts docs/superpowers/specs/2026-08-01-today-progress-ring-size-design.md docs/superpowers/plans/2026-08-01-today-ring-assistant-safe-area.md`

Expected: only the approved 0.9.4 ring, safe-area, test, spec, and plan changes appear. Do not stage or commit unless the user explicitly requests it.
