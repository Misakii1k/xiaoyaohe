// Android WebView / 浏览器 双入口。
import './ui/styles.css';
import { route, setNotFound, startRouter, navigate } from './router';
import { appModuleRoutes } from './app/moduleRegistry';
import { installGlobalErrorBoundary } from './app/globalErrorBoundary';
import { startReminderScheduler } from './features/reminderScheduler';
import { initializeNotifier } from './features/notifier';
import {
  registerWebReminderWorker,
  requestWebReminderCatchUp,
} from './features/webReminderTransport';
import { initializeLlmSecretStore, silentHealthCheck } from './ai/llmConfig';
import { mountGlobalAssistant } from './ui/AiAssistant';
import {
  handleMedicationReminderAction,
  replayPendingMedicationReminderActions,
} from './features/reminderActions';
import { migrateOversizedMedPhotos } from './features/medPhotos';
import { cleanupRetiredCloudSyncStorage } from './sync/retiredCloudStorage';
import { cleanupRetiredWorkStorage } from './sync/retiredWorkStorage';
import { startAutoSync } from './sync/lan/autoSync';

// 网页端：先把 Service Worker 注册上，下面 initializeNotifier 要靠它收发通知。
// 必须在同一个 tick 内发起，否则 navigator.serviceWorker.ready 会等到超时。
// 原生 App 走系统闹钟，这里内部会自行判断并直接返回 false。
void registerWebReminderWorker().catch(() => false);
// 页面即将关闭时踢 Service Worker 一脚，让它把刚到点的提醒补发出去。
window.addEventListener('pagehide', () => requestWebReminderCatchUp());

// Register notification click routing before the router starts. The target is
// retained so the Today page can focus the exact occurrence when it supports it.
void initializeNotifier((action) => {
  if (action.actionId !== 'tap') {
    void handleMedicationReminderAction(action).then((handled) => {
      if (handled) navigate('/today');
    }).catch(() => undefined);
    return;
  }
  const occurrenceId = action.data.occurrenceId ?? action.data.logId;
  if (typeof occurrenceId === 'string') {
    sessionStorage.setItem('medbox.notification-target-occurrence', occurrenceId);
  }
  navigate('/today');
}).catch(() => {
  /* Permission/plugin failures must not block app startup. */
});
void replayPendingMedicationReminderActions().then((handled) => {
  if (handled > 0) navigate('/today');
}).catch(() => undefined);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void replayPendingMedicationReminderActions().catch(() => undefined);
});

// Android pre-schedules native alarms and keeps the local reminder state reconciled.
try {
  startReminderScheduler();
} catch {
  /* 提醒调度失败不挡首屏 */
}

// 家庭同步：若用户开了「每 30 分钟自动同步」，启动轮询 + 常驻 host（依赖保活）
try {
  startAutoSync();
} catch {
  /* 自动同步启动失败不挡首屏 */
}

const root = document.getElementById('app');
if (!root) {
  document.body.textContent = '页面容器丢失，请重装应用。';
} else {
  // 兜底要在路由启动前装好，否则首屏就崩的那一类错误正好漏在窗口外。
  installGlobalErrorBoundary(root);

  route('/tools', () => navigate('/today'));
  for (const moduleRoute of appModuleRoutes) route(moduleRoute.path, moduleRoute.handler);

  setNotFound(() => navigate('/today'));

  try {
    startRouter(root, '/today');
  } catch (error) {
    console.error('router start failed', error);
    root.textContent = '页面启动失败，请完全退出后重开。';
  }

  // 全局小助手：挂在 body 上，任何页面右下角都能叫出来
  try {
    mountGlobalAssistant();
  } catch (error) {
    console.error('assistant mount failed', error);
  }
}

// 密钥恢复依赖原生安全存储；不能让它阻塞首屏路由和页面骨架。
void Promise.all([
  cleanupRetiredCloudSyncStorage(),
  cleanupRetiredWorkStorage(),
])
  .catch(() => undefined)
  .then(() => initializeLlmSecretStore())
  .then(() => silentHealthCheck())
  .catch(() => {
    /* Secure storage and startup health checks must not block the app shell. */
  });

// 空闲时把库里旧的大图压小，避免进「今日/药品」列表时并行解码闪退。
// requestIdleCallback 在部分 WebView 没有，用 setTimeout 兜底。
const scheduleIdle =
  typeof window.requestIdleCallback === 'function'
    ? (cb: () => void) => window.requestIdleCallback(() => cb(), { timeout: 4000 })
    : (cb: () => void) => window.setTimeout(cb, 1500);

scheduleIdle(() => {
  void migrateOversizedMedPhotos(16).catch(() => undefined);
});
