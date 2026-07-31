/* eslint-disable no-restricted-globals */
/**
 * 小药盒网页端 Service Worker。
 *
 * 只负责「通知」，**不缓存任何静态资源**。离线壳会带来「装了新版还在跑旧版」
 * 这类极难排查的问题，本版本不引入，因此也不向用户承诺离线可用。
 *
 * 存在的三个理由：
 * 1. Android Chrome 里 `new Notification()` 会直接抛 Illegal constructor，
 *    网页端要弹用药提醒**必须**经由 registration.showNotification()。
 * 2. iOS 16.4+ 的网页通知只在「已添加到主屏幕」的应用里可用，同样要走 SW。
 * 3. 通知上的「已服用 / 跳过」按钮只有 SW 通知才支持；点击结果回传给页面落库。
 *
 * 关于后台唤醒的诚实说明：
 * 浏览器**没有**可靠的定时唤醒机制。没有推送服务器，SW 只能在 periodicsync
 * （仅 Chromium、需已安装到主屏、间隔由浏览器决定，实测常以小时计）时醒来。
 * 所以这里只做「补发已经过期的提醒」，绝不假装能准点响 —— 准点那部分由页面
 * 还开着时的 60 秒轮询负责。设置页对用户也是这么写的。
 */

const KV_DB = 'medbox-web-reminders';
const KV_STORE = 'kv';
const PLAN_KEY = 'plan';
const FIRED_KEY = 'fired';
/** 只补发 12 小时内过期的提醒；再早的补上去只会打扰人，没有行动价值。 */
const CATCH_UP_WINDOW_MS = 12 * 60 * 60 * 1000;
const PERIODIC_SYNC_TAG = 'medbox-reminder-catch-up';
const ACTION_MESSAGE = 'medbox:reminder-action';
const PLAN_MESSAGE = 'medbox:reminder-plan';
const CANCEL_MESSAGE = 'medbox:reminder-cancel';
const CHECK_MESSAGE = 'medbox:reminder-check';
const DRAIN_MESSAGE = 'medbox:reminder-drain';
const PENDING_KEY = 'pending-actions';
const ICON = 'icons/icon-192.png';

self.addEventListener('install', () => {
  // 立刻接管：这个 SW 不碰任何静态资源，替换掉旧版本没有「新旧代码打架」的风险。
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === PLAN_MESSAGE) {
    event.waitUntil(savePlan(Array.isArray(message.notifications) ? message.notifications : []));
    return;
  }
  if (message.type === CANCEL_MESSAGE && typeof message.tag === 'string') {
    event.waitUntil(dropTag(message.tag));
    return;
  }
  if (message.type === DRAIN_MESSAGE) {
    event.waitUntil(drainPendingActions());
    return;
  }
  if (message.type === CHECK_MESSAGE) {
    event.waitUntil(fireOverdue());
  }
});

self.addEventListener('periodicsync', (event) => {
  if (event.tag !== PERIODIC_SYNC_TAG) return;
  event.waitUntil(fireOverdue());
});

// 一次性 sync 也顺手用上：恢复联网时浏览器会触发，等于多一次免费的补发机会。
self.addEventListener('sync', (event) => {
  if (event.tag !== PERIODIC_SYNC_TAG) return;
  event.waitUntil(fireOverdue());
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  notification.close();
  const data = notification.data && typeof notification.data === 'object' ? notification.data : {};
  const action = {
    actionId: event.action || 'tap',
    tag: typeof data.tag === 'string' ? data.tag : notification.tag || '',
    data,
  };
  event.waitUntil(deliverAction(action));
});

/**
 * 把通知动作交回页面处理（落库、取消同组通知、重排提醒都在页面那边）。
 * 页面没开就先开一个 —— 动作会在页面启动后由 message 监听器接住。
 */
async function deliverAction(action) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: ACTION_MESSAGE, ...action });
  }
  if (clients.length > 0) {
    const focused = clients.find((client) => client.focused) ?? clients[0];
    if (typeof focused.focus === 'function') {
      await focused.focus().catch(() => undefined);
    }
    return;
  }
  if (typeof self.clients.openWindow === 'function') {
    const opened = await self.clients.openWindow('./#/today').catch(() => null);
    // 新开的窗口来不及注册 message 监听器，动作先落在这里，由页面启动时来取。
    if (opened) await pushPendingAction(action);
  }
}

async function savePlan(notifications) {
  const plan = notifications
    .filter((item) => item && typeof item.at === 'number' && typeof item.title === 'string')
    .map((item) => ({
      at: item.at,
      title: item.title,
      body: typeof item.body === 'string' ? item.body : '',
      tag: typeof item.tag === 'string' ? item.tag : '',
      key: typeof item.key === 'string' ? item.key : 'dose',
      data: item.data && typeof item.data === 'object' ? item.data : {},
    }));
  await kvSet(PLAN_KEY, plan);
  // 计划里已经不存在的条目，其「已补发」标记也一并丢掉，避免无限增长。
  const alive = new Set(plan.map(notificationKey));
  const fired = await kvGet(FIRED_KEY);
  if (Array.isArray(fired)) {
    await kvSet(FIRED_KEY, fired.filter((id) => alive.has(id)));
  }
}

/**
 * 补发已经过期、页面还没处理掉的提醒。
 *
 * 页面开着的时候直接让位：那边的 60 秒轮询更准，也能正确处理「第几次提醒」的
 * 升级策略，两边同时发只会让用户收到重复通知。
 */
async function fireOverdue() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.some((client) => client.visibilityState === 'visible')) return;

  const now = Date.now();
  const plan = (await kvGet(PLAN_KEY)) || [];
  const fired = new Set((await kvGet(FIRED_KEY)) || []);
  const overdue = plan.filter((item) => {
    if (item.at > now || now - item.at > CATCH_UP_WINDOW_MS) return false;
    return !fired.has(notificationKey(item));
  });
  if (overdue.length === 0) return;

  // 醒来一次就把攒下的全弹出来会刷屏；多条时只发一条汇总，点开进应用看详情。
  if (overdue.length === 1) {
    const item = overdue[0];
    await showItem(item);
  } else {
    const names = [...new Set(overdue.map((item) => String(item.data?.medicationName || '')).filter(Boolean))];
    await self.registration.showNotification(`⏰ 有 ${overdue.length} 次用药还没记录`, {
      body: names.length > 0 ? `${names.slice(0, 3).join('、')}${names.length > 3 ? ' 等' : ''}` : '打开小药盒看看',
      tag: 'medbox-catch-up',
      icon: ICON,
      badge: ICON,
      data: { kind: 'catch-up', tag: 'medbox-catch-up' },
    });
  }
  for (const item of overdue) fired.add(notificationKey(item));
  await kvSet(FIRED_KEY, [...fired]);
}

async function showItem(item) {
  await self.registration.showNotification(item.title, {
    body: item.body,
    tag: `${item.tag}::${item.key}`,
    icon: ICON,
    badge: ICON,
    data: { ...item.data, tag: item.tag, key: item.key },
    actions: [
      { action: 'taken', title: '已服用' },
      { action: 'skip', title: '跳过' },
    ],
  });
}

/**
 * 用户已经处理掉这次用药（吃了 / 跳过）：关掉在屏通知，并把该 tag 从补发计划里
 * 摘除。只关通知不摘计划的话，下次唤醒还会把同一次用药再补发一遍。
 */
async function dropTag(tag) {
  const shown = await self.registration.getNotifications();
  for (const notification of shown) {
    const data = notification.data || {};
    if (data.tag === tag || notification.tag === tag || String(notification.tag).startsWith(`${tag}::`)) {
      notification.close();
    }
  }
  const plan = (await kvGet(PLAN_KEY)) || [];
  const next = plan.filter((item) => item.tag !== tag);
  if (next.length !== plan.length) await kvSet(PLAN_KEY, next);
}

async function pushPendingAction(action) {
  const pending = (await kvGet(PENDING_KEY)) || [];
  pending.push(action);
  await kvSet(PENDING_KEY, pending.slice(-20));
}

/** 页面起来后主动来取「关闭期间被点掉的通知」，取走即清空。 */
async function drainPendingActions() {
  const pending = (await kvGet(PENDING_KEY)) || [];
  if (pending.length === 0) return;
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (clients.length === 0) return;
  await kvSet(PENDING_KEY, []);
  for (const client of clients) {
    for (const action of pending) client.postMessage({ type: ACTION_MESSAGE, ...action });
  }
}

function notificationKey(item) {
  return `${item.tag}::${item.key}@${item.at}`;
}

/* ---------- 极简 IndexedDB 键值存取（SW 里读不到 localStorage） ---------- */

function openKv() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KV_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(KV_STORE)) {
        request.result.createObjectStore(KV_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function kvGet(key) {
  try {
    const db = await openKv();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(KV_STORE, 'readonly').objectStore(KV_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

async function kvSet(key, value) {
  try {
    const db = await openKv();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(KV_STORE, 'readwrite');
      tx.objectStore(KV_STORE).put(value, key);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 存储被禁用（无痕模式等）时降级为「本次唤醒有效」，不影响页面开着时的提醒 */
  }
}
