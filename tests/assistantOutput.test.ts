import { describe, expect, it } from 'vitest';
import { extractExplicitWebSearchQuery } from '../src/ai/assistant';
import { findAssistantTool } from '../src/ai/assistantTools';

describe('assistant structured output tools', () => {
  it('extracts explicit search commands for direct MCP execution', () => {
    expect(extractExplicitWebSearchQuery('帮我联网搜索 腾讯云一句话识别')).toBe('腾讯云一句话识别');
    expect(extractExplicitWebSearchQuery('请帮我搜索 Exa MCP')).toBe('Exa MCP');
    expect(extractExplicitWebSearchQuery('查一下：Exa MCP')).toBe('Exa MCP');
    expect(extractExplicitWebSearchQuery('今天要吃什么药？')).toBeUndefined();
  });

  it('exposes only the bounded Exa web-search capability', () => {
    const tool = findAssistantTool('web_search_exa');
    expect(tool).toBeDefined();
    expect(tool?.parameters).toMatchObject({
      properties: {
        query: { maxLength: 500 },
        numResults: { maximum: 5 },
      },
    });
  });
  it('normalizes model-provided information cards', async () => {
    const tool = findAssistantTool('present_card');
    expect(tool).toBeDefined();

    const result = await tool!.run({
      eyebrow: '药品库存',
      title: '库存概览',
      tone: 'unexpected',
      body: '**库存记录**，请按实际余量及时更新。',
      variant: 'inventory',
      icon: 'box',
      badge: '1 项需补充',
      items: [
        { title: '阿司匹林', subtitle: '100mg · 每次 1 片', meta: '库存 28 片', status: 'success', statusLabel: '正常', icon: 'pill' },
        { title: '', status: 'warning' },
      ],
      facts: [
        { label: '药品', value: '6 种' },
        { label: '需补充', value: '1 种' },
        { label: '', value: '不会显示' },
      ],
    }) as { ui: { type: string; tone: string; variant: string; icon: string; badge: string; items: unknown[]; facts: unknown[] } };

    expect(result.ui).toMatchObject({
      type: 'card',
      tone: 'neutral',
      variant: 'inventory',
      icon: 'box',
      badge: '1 项需补充',
      items: [
        { title: '阿司匹林', subtitle: '100mg · 每次 1 片', meta: '库存 28 片', status: 'success', statusLabel: '正常', icon: 'pill' },
      ],
      facts: [
        { label: '药品', value: '6 种' },
        { label: '需补充', value: '1 种' },
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
