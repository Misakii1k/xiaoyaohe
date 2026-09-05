// Android WebView / 浏览器 双入口。
// 这里只静态加载无 UI 依赖的兜底模块，让监听器在其余应用模块求值前就装好。
import {
  captureGlobalFailure,
  installGlobalErrorBoundary,
} from './app/globalErrorBoundary';
import { reportSilentFailure } from './app/diagnostics';

const existingRoot = document.getElementById('app');
const root = existingRoot ?? document.createElement('div');
if (!existingRoot) {
  root.id = 'app';
  document.body.replaceChildren(root);
}
installGlobalErrorBoundary(root);

if (!existingRoot) {
  root.textContent = '页面容器丢失，请重装应用。';
} else {
  void bootstrapApplication(root).catch((cause) => {
    captureGlobalFailure(root, cause, 'startup.bootstrap');
  });
}

async function bootstrapApplication(appRoot: HTMLElement): Promise<void> {
  await import('./ui/styles.css');
  const { initTheme } = await import('./ui/theme');
  initTheme();
  const { initLiquidGlass } = await import('./ui/liquidGlass');
  initLiquidGlass();
  const [
    router,
    { appModuleRoutes },
    { compatibilityRedirects },
    { startReminderScheduler },
    { initializeNotifier },
    webReminderTransport,
    llmConfig,
    { mountGlobalAssistant },
    reminderActions,
    { migrateOversizedMedPhotos },
    { cleanupRetiredCloudSyncStorage },
    { cleanupRetiredWorkStorage },
    { startAutoSync },
    { isApkDistributionAvailable, startServingInstalledApk },
  ] = await Promise.all([
    import('./router'),
    import('./app/moduleRegistry'),
    import('./app/routeCompatibility'),
    import('./features/reminderScheduler'),
    import('./features/notifier'),
    import('./features/webReminderTransport'),
    import('./ai/llmConfig'),
    import('./ui/AiAssistant'),
    import('./features/reminderActions'),
    import('./features/medPhotos'),
    import('./sync/retiredCloudStorage'),
    import('./sync/retiredWorkStorage'),
    import('./sync/lan/autoSync'),
    import('./sync/lan/apkTransport'),
  ]);
  const { route, setNotFound, startRouter, navigate } = router;
  const {
    registerWebReminderWorker,
    requestWebReminderCatchUp,
  } = webReminderTransport;
  const { initializeLlmSecretStore, silentHealthCheck } = llmConfig;
  const {
    handleMedicationReminderAction,
    replayPendingMedicationReminderActions,
  } = reminderActions;

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
      }).catch((cause) => reportSilentFailure('reminder.action', cause));
      return;
    }
    const occurrenceId = action.data.occurrenceId ?? action.data.logId;
    if (typeof occurrenceId === 'string') {
      sessionStorage.setItem('medbox.notification-target-occurrence', occurrenceId);
    }
    navigate('/today');
  }).catch((cause) => {
    reportSilentFailure('reminder.initialize', cause);
    /* Permission/plugin failures must not block app startup. */
  });
  void replayPendingMedicationReminderActions().then((handled) => {
    if (handled > 0) navigate('/today');
  }).catch((cause) => reportSilentFailure('reminder.replay', cause));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void replayPendingMedicationReminderActions()
      .catch((cause) => reportSilentFailure('reminder.replay-visible', cause));
  });

  // Android pre-schedules native alarms and keeps the local reminder state reconciled.
  try {
    startReminderScheduler();
  } catch (cause) {
    reportSilentFailure('reminder.scheduler-start', cause);
    /* 提醒调度失败不挡首屏 */
  }

  // 家庭同步：若用户开了「每 30 分钟自动同步」，启动轮询 + 常驻 host（依赖保活）
  try {
    startAutoSync();
  } catch (cause) {
    reportSilentFailure('lan.auto-start', cause);
    /* 自动同步启动失败不挡首屏 */
  }

  // 局域网 APK 分发：在 Android App 启动时自动在 38473 端口对外分发本机 APK，供同局域网设备获取更新
  if (isApkDistributionAvailable()) {
    void startServingInstalledApk().catch((cause) => {
      reportSilentFailure('lan.apk-serve-start', cause);
    });
  }

  for (const [legacyPath, currentPath] of Object.entries(compatibilityRedirects)) {
    route(legacyPath, () => navigate(currentPath));
  }
  for (const moduleRoute of appModuleRoutes) route(moduleRoute.path, moduleRoute.handler);

  setNotFound(() => navigate('/today'));

  try {
    startRouter(appRoot, '/today');
  } catch (cause) {
    const diagnosticId = reportSilentFailure('startup.router', cause);
    console.error('[medbox] 路由启动失败，诊断编号', diagnosticId);
    appRoot.textContent = '页面启动失败，请完全退出后重开。';
  }

  // 全局小助手：挂在 body 上，任何页面右下角都能叫出来
  try {
    mountGlobalAssistant();
  } catch (cause) {
    const diagnosticId = reportSilentFailure('startup.assistant', cause);
    console.error('[medbox] 小助手启动失败，诊断编号', diagnosticId);
  }

  // 密钥恢复依赖原生安全存储；不能让它阻塞首屏路由和页面骨架。
  void Promise.all([
    cleanupRetiredCloudSyncStorage(),
    cleanupRetiredWorkStorage(),
  ])
    .catch(() => undefined)
    .then(() => Promise.all([
      initializeLlmSecretStore(),
    ]))
    .then(() => silentHealthCheck())
    .catch(() => {
      /* Secure storage and startup health checks must not block the app shell. */
    });

  // 空闲时把库里旧的大图压小，避免进「今日/药品」列表时并行解码闪退。
  // requestIdleCallback 在部分 WebView 没有，用 setTimeout 兜底。
  const scheduleIdle =
    typeof window.requestIdleCallback === 'function'
      ? (callback: () => void) => window.requestIdleCallback(() => callback(), { timeout: 4000 })
      : (callback: () => void) => window.setTimeout(callback, 1500);

  scheduleIdle(() => {
    void migrateOversizedMedPhotos(16)
      .catch((cause) => reportSilentFailure('photo.migration-idle', cause));
  });
}
