import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

describe('settings information architecture contracts', () => {
  it('separates provider configuration from revocable AI data-send consent', () => {
    const source = readFileSync(join(root, 'src/pages/Settings.ts'), 'utf8');

    expect(source).toContain('function renderAiConsentPanel()');
    expect(source).toContain("title: 'AI 外发授权'");
    expect(source).toContain("{ text: '首次询问', tone: 'muted' }");
    expect(source).toContain('function renderAiConsentControls(onChanged: () => void)');
    expect(source).toContain('clear.hidden = records.length === 0;');
    expect(source).toContain("title: 'AI 服务商'");
    expect(source).toContain("return { text: '未配置', tone: 'muted' }");
  });

  it('uses local Lucide icons and compact, non-glass setting groups', () => {
    const source = readFileSync(join(root, 'src/pages/Settings.ts'), 'utf8');
    const styles = readFileSync(join(root, 'src/ui/styles/pages/settings.css'), 'utf8');

    expect(source).toContain("class: 'page page-light settings-page'");
    expect(source).toContain('iconName: IconName');
    expect(source).not.toContain('iconHtml:');
    expect(styles).toContain('.settings-page .panel');
    expect(styles).toContain('backdrop-filter: none');
    // 数据概览四宫格已并入“本地数据与备份”摘要文案，不再有独立统计网格
    expect(styles).not.toContain('.settings-overview');
    expect(styles).not.toContain('.settings-stat-grid');
    expect(styles).toContain('.settings-page .panel {\n  min-block-size: 60px;');
    expect(styles).toContain('.settings-page {\n  display: block;');
  });

  it('enables encrypted sync without retaining image-generation settings', () => {
    const settings = readFileSync(join(root, 'src/pages/Settings.ts'), 'utf8');
    const wrangler = readFileSync(join(root, 'wrangler.toml'), 'utf8');
    const envExample = readFileSync(join(root, '.env.example'), 'utf8');
    const productionEnv = readFileSync(join(root, '.env.production'), 'utf8');

    expect(settings).toContain('if (SYNC_V2_UI_ENABLED) content.append(renderSyncPanel(signal));');
    expect(settings).toContain('SYNC_V2_ALLOWED_ORIGINS');
    expect(settings).not.toContain('灰度关闭');
    expect(settings).not.toContain("from '../ai/imageGen'");
    expect(settings).not.toContain('图像 AI');
    expect(settings).not.toContain('setImageGenConfig');
    expect(settings).not.toContain('resetImageGenConfig');

    expect(wrangler).toContain('SYNC_V2_ENABLED = "true"');
    expect(wrangler).toContain('https://localhost');
    expect(wrangler).toContain('http://127.0.0.1:5173');
    expect(wrangler).not.toMatch(/SYNC_V2_ALLOWED_ORIGINS\s*=\s*"[^"]*\*/);
    expect(envExample).toContain('VITE_SYNC_V2_ENABLED=true');
    expect(productionEnv.trim()).toBe('VITE_SYNC_V2_ENABLED=true');
  });
});
