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
    expect(settings).toContain('通知已开启，应用会按计划发送提醒。');
    expect(settings).not.toContain("from '../ai/imageGen'");
    expect(settings).not.toContain('图像 AI');
    expect(settings).not.toContain('setImageGenConfig');
    expect(settings).not.toContain('resetImageGenConfig');
  });

  // 原先这条契约禁止设置页出现「浏览器」二字，并要求密钥说明写死成
  // 「保存在这台手机的安全存储中」——那是把网页端当开发预览时的措辞。
  // 网页端现在是正式使用场景，而它**没有**系统安全存储可用：密钥只能明文放在
  // 浏览器里。此时统一说成「安全存储」等于对网页端用户说假话，所以改为要求
  // 按平台分别给出如实说明。
  it('tells the truth about where API keys live on each platform', () => {
    const settings = readFileSync(join(root, 'src/pages/Settings.ts'), 'utf8');
    const secretStore = readFileSync(join(root, 'src/ai/secretStore.ts'), 'utf8');

    // 原生端：系统安全存储
    expect(settings).toContain('密钥保存在这台手机的系统安全存储中。');
    // 网页端：如实说明是明文，且提示公用电脑的风险
    expect(settings).toContain('密钥在浏览器里是明文保存的。');
    expect(secretStore).toContain('以明文保存在本机');
    expect(secretStore).toContain('公用电脑');
    // 两套文案必须由平台判断分流，不能只留一句糊过去
    expect(settings).toMatch(/isNativeSecretStore\(\)\s*\n?\s*\?/);

    // 不做前端假加密：密钥与解密它所需的一切都在同一个浏览器里，那是安全剧场。
    // 真正给用户的选项是「关掉标签页就失效」。
    expect(secretStore).toContain("export type WebSecretPersistence = 'device' | 'session'");
    expect(settings).toContain('仅本次会话保存密钥');
    // 只认真正的加解密调用，不误伤解释「为什么不这么做」的注释
    expect(secretStore).not.toMatch(/encrypt|crypto\.subtle/i);
  });
});
