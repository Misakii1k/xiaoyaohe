import { describe, expect, it } from 'vitest';
import { findAssistantTool } from '../src/ai/assistantTools';

describe('assistant structured output tools', () => {
  it('normalizes model-provided information cards', async () => {
    const tool = findAssistantTool('present_card');
    expect(tool).toBeDefined();

    const result = await tool!.run({
      eyebrow: '本月工时',
      title: '收入概览',
      tone: 'unexpected',
      body: '**估算值**，以实际结算为准。',
      facts: [
        { label: '工时', value: '42 小时' },
        { label: '收入', value: '3,280 元' },
        { label: '', value: '不会显示' },
      ],
    }) as { ui: { type: string; tone: string; facts: unknown[] } };

    expect(result.ui).toMatchObject({
      type: 'card',
      tone: 'neutral',
      facts: [
        { label: '工时', value: '42 小时' },
        { label: '收入', value: '3,280 元' },
      ],
    });
  });

  it('returns a controlled navigation card instead of navigating immediately', async () => {
    const tool = findAssistantTool('open_page');
    expect(tool).toBeDefined();

    await expect(tool!.run({ page: 'today' })).resolves.toEqual({
      ok: true,
      ui: {
        type: 'navigation',
        title: '今天的吃药清单',
        description: '前往「今天的吃药清单」继续操作',
        actionLabel: '打开页面',
        path: '/today',
        icon: 'calendar',
      },
    });
    await expect(tool!.run({ page: 'outside' })).resolves.toEqual({ ok: false, 提示: '没有这个页面' });
  });
});
