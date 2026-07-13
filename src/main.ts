// 应用入口：注册 SW、挂载路由
import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { route, setNotFound, startRouter, navigate } from './router';
import { renderToolPickerPage } from './pages/ToolPicker';
import { renderSettingsPage } from './pages/Settings';
import { tools } from './tools/registry';
import { startAutoSync } from './sync/syncClient';
import { startReminderScheduler } from './features/reminderScheduler';
import { silentHealthCheck } from './ai/llmConfig';

// Service Worker 自动更新
registerSW({ immediate: true });

// 云同步：启动即拉取一次，并周期/联网时自动同步
startAutoSync();

// 强提醒调度：到点用系统通知弹窗 + 震动；未确认会升级提醒（M3）
startReminderScheduler();

// AI 大模型：静默体检（fire-and-forget），结果存 localStorage，设置页用之
silentHealthCheck().catch(() => {
  /* 启动期网络问题不影响渲染 */
});

const root = document.getElementById('app')!;

route('/tools', (_p, r) => renderToolPickerPage(r));
for (const tool of tools) {
  for (const toolRoute of tool.routes) route(toolRoute.path, toolRoute.handler);
}
route('/settings', (_p, r) => renderSettingsPage(r));

setNotFound(() => navigate('/tools'));

startRouter(root, '/tools');
