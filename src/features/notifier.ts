// 系统通知封装：复用 vite-plugin-pwa 注册的 Service Worker，调 reg.showNotification 发系统级通知。
// 不写自定义 SW（避免切 injectManifest 的工程开销）；代价：通知 actions 按钮浏览器可能忽略，
// 用户点通知主体会聚焦应用，到 today 页手动确认。

export interface NotifyOpts {
  body: string;
  /** 同 tag 的新通知会覆盖旧的，避免堆积 */
  tag: string;
  /** 是否静默（不响铃/不震动），用于测试或软提醒 */
  silent?: boolean;
  /** 附加数据，通知 click 可读取 */
  data?: Record<string, unknown>;
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

export function getPermission(): NotificationPermission {
  if (!notificationsSupported()) return 'denied';
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  return Notification.requestPermission();
}

/** 弹一条系统通知。返回是否成功送出 */
export async function showNotification(title: string, opts: NotifyOpts): Promise<boolean> {
  if (getPermission() !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    // 兼容性字段（vibrate / badge / icon）用 any，避免不同 TS 版本 lib 差异
    const options: NotificationOptions = {
      body: opts.body,
      tag: opts.tag,
      requireInteraction: true,
      silent: opts.silent ?? false,
      icon: '/icons/icon-192.png',
      data: opts.data,
      ...({ vibrate: [400, 200, 400, 200, 400], badge: '/icons/icon-192.png' } as Record<string, unknown>),
    };
    await reg.showNotification(title, options);
    // 应用在前台时主线程也震一下（部分设备 SW vibrate 仅后台时由系统兑现）
    if (!opts.silent && typeof navigator.vibrate === 'function') {
      navigator.vibrate([400, 200, 400, 200, 400]);
    }
    return true;
  } catch {
    return false;
  }
}

/** 关闭所有 tag 匹配的通知（例如确认已服用后） */
export async function closeNotificationsByTag(tag: string): Promise<void> {
  if (!notificationsSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const list = await reg.getNotifications({ tag });
    for (const n of list) n.close();
  } catch {
    /* ignore */
  }
}
