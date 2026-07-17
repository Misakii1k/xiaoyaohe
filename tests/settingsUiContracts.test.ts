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
    const styles = readFileSync(join(root, 'src/ui/styles/pages/settings.css'), 'utf8').replaceAll('\r\n', '\n');

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

  it('uses App-only local-network family sync with plain-language guidance', () => {
    const settings = readFileSync(join(root, 'src/pages/Settings.ts'), 'utf8');
    const lanPanel = readFileSync(join(root, 'src/sync/lan/settingsPanel.ts'), 'utf8');

    expect(settings).toContain("import { renderLanSyncSettingsPanel } from '../sync/lan/settingsPanel';");
    expect(settings).toContain('const lanSyncPanel = renderLanSyncSettingsPanel(signal);');
    expect(settings).toContain('lanSyncPanel.cleanup();');
    expect(lanPanel).toContain("text: '家庭同步'");
    expect(lanPanel).toContain('两台手机连着同一个 Wi-Fi 时，可以直接互相传。');
    expect(lanPanel).toContain("actionButton('send', '显示连接码')");
    expect(lanPanel).toContain("actionButton('scan', '扫一扫连接', 'tonal')");
    expect(lanPanel).toContain('result.inventoryConflicts.length');
    expect(lanPanel).toContain('result.remindersNeedAttention');
    expect(lanPanel).toContain('请重新打开应用后检查提醒');
    expect(`${settings}\n${lanPanel}`).not.toMatch(/SYNC_V2|Worker|PWA|WebRTC|SDP|Origin/);
    expect(settings).not.toContain("from '../sync/v2'");
    expect(settings).not.toContain("from '@capacitor/core'");
    expect(settings).not.toContain('openDialog');
    expect(settings).not.toContain('closeDialog');
    expect(settings).not.toContain('浏览器');
    expect(settings).toContain('通知已开启，应用会按计划发送提醒。');
    expect(settings).toContain('密钥保存在这台手机的安全存储中。');
    expect(settings).not.toContain("from '../ai/imageGen'");
    expect(settings).not.toContain('图像 AI');
    expect(settings).not.toContain('setImageGenConfig');
    expect(settings).not.toContain('resetImageGenConfig');
  });
});
