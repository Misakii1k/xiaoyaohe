// @vitest-environment happy-dom
//
// BottomSheet 的无障碍契约以「行为」断言，而不是匹配源码文本。
// 早期版本靠正则匹配 BottomSheet.ts 的实现细节（如 "event.key === 'Escape'"），
// 焦点陷阱被抽到 components.ts 的 trapFocusIn 之后就整片误报——功能明明还在。
// 这里改为真实开关弹层、真实派发按键，重构不会误报，行为回归才会。
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeAllBottomSheets, openBottomSheet } from '../src/ui/primitives/BottomSheet';

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

function paragraph(text = '内容'): HTMLElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function appRoot(): HTMLElement {
  return document.getElementById('app')!;
}

describe('BottomSheet 行为契约', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    const app = document.createElement('div');
    app.id = 'app';
    document.body.append(app);
  });

  afterEach(() => {
    // 弹层计数是模块级状态，任何漏关都会污染后续用例
    closeAllBottomSheets();
  });

  it('渲染为带标签的模态对话框', () => {
    const { overlay, close } = openBottomSheet({ label: '选择时间', content: paragraph() });
    const sheet = overlay.querySelector('.bottom-sheet')!;

    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.getAttribute('aria-label')).toBe('选择时间');

    close();
  });

  it('给专用面板附加样式类而不改变通用生命周期', () => {
    const { overlay, close } = openBottomSheet({
      label: '专用面板',
      className: 'custom-sheet',
      content: paragraph(),
    });

    expect(overlay.querySelector('.bottom-sheet.custom-sheet')).not.toBeNull();
    expect(appRoot().getAttribute('aria-hidden')).toBe('true');
    close();
    expect(appRoot().getAttribute('aria-hidden')).toBeNull();
  });

  it('按 Escape 关闭，并把焦点还给触发它的元素', () => {
    const trigger = document.createElement('button');
    trigger.textContent = '打开';
    appRoot().append(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { overlay } = openBottomSheet({ label: '选择时间', content: paragraph() });
    expect(document.body.contains(overlay)).toBe(true);

    pressEscape();

    expect(document.body.contains(overlay)).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('点击遮罩关闭，点击面板内部不关闭', () => {
    const { overlay } = openBottomSheet({ label: '选择时间', content: paragraph() });
    const sheet = overlay.querySelector<HTMLElement>('.bottom-sheet')!;

    sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.contains(overlay)).toBe(true);

    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.body.contains(overlay)).toBe(false);
  });

  it('关闭后释放键盘监听，不会被后续按键再次触发', () => {
    let closes = 0;
    openBottomSheet({ label: '选择时间', content: paragraph(), onClose: () => (closes += 1) });

    closeAllBottomSheets();
    expect(closes).toBe(1);

    // 监听器若没摘掉，这次 Escape 会让 onClose 再跑一遍
    pressEscape();
    expect(closes).toBe(1);
  });

  it('多个弹层叠加时，页面主体保持 inert 直到最后一个关闭', () => {
    const app = appRoot();
    expect(app.getAttribute('aria-hidden')).toBeNull();

    const first = openBottomSheet({ label: '第一层', content: paragraph() });
    expect(app.getAttribute('aria-hidden')).toBe('true');

    const second = openBottomSheet({ label: '第二层', content: paragraph() });
    first.close();
    // 还有一层开着，主体不能恢复可交互
    expect(app.getAttribute('aria-hidden')).toBe('true');

    second.close();
    expect(app.getAttribute('aria-hidden')).toBeNull();
  });

  it('重复关闭同一个弹层只生效一次', () => {
    let closes = 0;
    const { close } = openBottomSheet({
      label: '选择时间',
      content: paragraph(),
      onClose: () => (closes += 1),
    });

    close();
    close();
    close();

    expect(closes).toBe(1);
    // 计数若没配平，主体会被永久锁在 inert 状态
    expect(appRoot().getAttribute('aria-hidden')).toBeNull();
  });
});
