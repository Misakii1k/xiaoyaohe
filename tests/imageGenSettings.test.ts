// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfirmDialog, mockPromptDialog } = vi.hoisted(() => ({
  mockConfirmDialog: vi.fn().mockResolvedValue(true),
  mockPromptDialog: vi.fn().mockResolvedValue('我的 Agnes 专线'),
}));

vi.mock('../src/ui/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/components')>();
  return {
    ...actual,
    confirmDialog: mockConfirmDialog,
    promptDialog: mockPromptDialog,
  };
});

import { renderImageGenSettingsPanel } from '../src/ui/imageGenSettingsPanel';
import {
  saveImageGenProfile,
  getSavedImageGenProfiles,
  deleteImageGenProfile,
} from '../src/ai/llmConfig';

describe('imageGenSettingsPanel custom profile management & zero preset templates', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    const profiles = getSavedImageGenProfiles();
    for (const p of profiles) {
      await deleteImageGenProfile(p.id);
    }
  });

  it('does NOT contain hardcoded preset model capsules', async () => {
    const { element } = renderImageGenSettingsPanel();
    const text = element.textContent || '';
    // 确认绝不包含过去的静态硬编码模板
    expect(text).not.toContain('GPT Image 1 (OpenAI, 推荐)');
    expect(text).not.toContain('DALL·E 3 (OpenAI, 文生图)');
    expect(text).not.toContain('通义万相 (阿里)');
    expect(text).not.toContain('CogView-3 (智谱)');
  });

  it('renders saved profiles list and allows clicking to load and deleting', async () => {
    // 预存一条自定义配置
    await saveImageGenProfile({
      name: 'Agnes 2.1 极速版',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      apiKey: 'sk-agnes-custom-key',
      model: 'agnes-image-2.1-flash',
      endpointMode: 'auto',
    });

    const { element } = renderImageGenSettingsPanel();
    expect(element.textContent).toContain('Agnes 2.1 极速版');
    expect(element.textContent).toContain('agnes-image-2.1-flash');

    // 找到该配置的载入按钮并点击
    const nameBtn = Array.from(element.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Agnes 2.1 极速版'),
    );
    expect(nameBtn).toBeDefined();

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    const modelInput = element.querySelector('input[placeholder*="agnes-image"]') as HTMLInputElement;
    const keyInput = element.querySelector('input.secret-input') as HTMLInputElement;

    nameBtn?.click();

    expect(urlInput.value).toBe('https://apihub.agnes-ai.com/v1');
    expect(modelInput.value).toBe('agnes-image-2.1-flash');
    expect(keyInput.value).toBe('sk-agnes-custom-key');

    // 找到删除按钮并确认删除
    mockConfirmDialog.mockResolvedValueOnce(true);
    const delBtn = Array.from(element.querySelectorAll('button')).find((b) =>
      b.title?.includes('删除「Agnes 2.1 极速版」'),
    );
    expect(delBtn).toBeDefined();
    await (delBtn as unknown as { onclick: (e: MouseEvent) => Promise<void> }).onclick(new MouseEvent('click'));

    // 检查已从持久化中移除
    expect(mockConfirmDialog).toHaveBeenCalledWith('确定删除生图配置「Agnes 2.1 极速版」吗？', '删除', true);
    expect(getSavedImageGenProfiles().length).toBe(0);
  });

  it('allows saving currently filled form as a new custom profile via prompt', async () => {
    mockPromptDialog.mockResolvedValueOnce('我的 Agnes 专线');
    const { element } = renderImageGenSettingsPanel();

    const urlInput = element.querySelector('input[type="url"]') as HTMLInputElement;
    const modelInput = element.querySelector('input[placeholder*="agnes-image"]') as HTMLInputElement;
    const keyInput = element.querySelector('input.secret-input') as HTMLInputElement;

    urlInput.value = 'https://apihub.agnes-ai.com/v1';
    modelInput.value = 'agnes-image-2.1-flash';
    keyInput.value = 'sk-test-secret';

    const saveProfileBtn = Array.from(element.querySelectorAll('button')).find((b) =>
      b.textContent === '存为新配置',
    );
    expect(saveProfileBtn).toBeDefined();

    await (saveProfileBtn as unknown as { onclick: () => Promise<void> }).onclick();
    expect(mockPromptDialog).toHaveBeenCalled();

    const saved = getSavedImageGenProfiles();
    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('我的 Agnes 专线');
    expect(saved[0].baseUrl).toBe('https://apihub.agnes-ai.com/v1');
    expect(saved[0].model).toBe('agnes-image-2.1-flash');
    expect(saved[0].apiKey).toBe('sk-test-secret');
  });
});
