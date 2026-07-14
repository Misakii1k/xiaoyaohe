// 应用入口：注册 SW、挂载路由
import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { route, setNotFound, startRouter, navigate } from './router';
import { renderToolPickerPage } from './pages/ToolPicker';
import { tools } from './tools/registry';
import { startAutoSync } from './sync/syncClient';
import { startReminderScheduler } from './features/reminderScheduler';
import { initializeNotifier } from './features/notifier';
import { initializeLlmSecretStore, silentHealthCheck } from './ai/llmConfig';

// Service Worker 自动更新
registerSW({ immediate: true });

// 云同步：启动即拉取一次，并周期/联网时自动同步
startAutoSync();

// Register notification click routing before the router starts. The target is
// retained so the Today page can focus the exact occurrence when it supports it.
void initializeNotifier((action) => {
  const occurrenceId = action.data.occurrenceId ?? action.data.logId;
  if (typeof occurrenceId === 'string') {
    sessionStorage.setItem('medbox.notification-target-occurrence', occurrenceId);
  }
  navigate('/today');
}).catch(() => {
  /* Permission/plugin failures must not block app startup. */
});

// Android pre-schedules native alarms; PWA remains a foreground best-effort loop.
startReminderScheduler();

// 先迁移/加载密钥：Web 不持久化，Android 从系统安全存储恢复。
await initializeLlmSecretStore();

// AI 大模型：静默体检（fire-and-forget），结果存 localStorage，设置页用之
silentHealthCheck().catch(() => {
  /* 启动期网络问题不影响渲染 */
});

const root = document.getElementById('app')!;

route('/tools', (_p, root, context) => renderToolPickerPage(root, context.signal));
for (const tool of tools) {
  for (const toolRoute of tool.routes) route(toolRoute.path, toolRoute.handler);
}
route('/settings', async (_p, root, context) => {
  const page = await import('./pages/Settings');
  if (context.signal.aborted) return;
  return page.renderSettingsPage(root, context.signal);
});

setNotFound(() => navigate('/tools'));

startRouter(root, '/tools');
