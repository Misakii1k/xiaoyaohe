// autoSync 单元测试：覆盖新增的 triggerManualJoinAll 与 lanAutoSyncSilent 开关。
// 通过 vi.mock 隔离 nativeTransport / knownPeers / session 等依赖，避免触碰真实网络与 localStorage。
// 使用 vi.hoisted 让 mock 工厂能安全引用共享状态（vitest 会把 vi.mock 提升到顶部，
// 直接在工厂闭包里读 const/let 变量会触发 TDZ）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- 浏览器全局 polyfill：autoSync.ts 用到 window.setTimeout/setInterval 和 localStorage，
// 在 Node 测试环境里没有，需要 stub。
const memoryLocalStorage = (() => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  };
})();

const stubWindow = {
  setTimeout: (handler: () => void, ms?: number) => setTimeout(handler, ms),
  clearTimeout: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (handler: () => void, ms?: number) => setInterval(handler, ms),
  clearInterval: (id: unknown) => clearInterval(id as ReturnType<typeof setInterval>),
  localStorage: memoryLocalStorage,
};

const state = vi.hoisted(() => ({
  // 已配对 peer 列表
  peers: [] as Array<{
    deviceId: string;
    deviceName: string;
    host: string;
    port: number;
    pairingSessionId: string;
    pairingSecretB64: string;
    lastSeenAt: number;
  }>,
  // 记录每次 joinLanSyncHost 调用的入参，便于断言 allowOverwrite 等
  joinCalls: [] as Array<{ uri: string; allowOverwrite: boolean }>,
  // joinLanSyncHost 的可注入实现；null = 默认成功
  joinImpl: null as
    | ((uri: string, opts: { allowRemoteOverwrite?: boolean }) => Promise<void>)
    | null,
}));

// ---- 模块 mock ----
vi.mock('./nativeTransport', () => ({
  isLanSyncAvailable: () => true,
}));

vi.mock('./knownPeers', () => ({
  listKnownPeers: () => [...state.peers],
  rememberPeer: (peer: (typeof state.peers)[number]) => {
    const idx = state.peers.findIndex((p) => p.deviceId === peer.deviceId);
    if (idx >= 0) state.peers[idx] = peer;
    else state.peers.push(peer);
  },
  getOrCreateLocalAutoIdentity: () => ({
    sessionId: 'fixedsessionid0000001',
    secretB64: 'dGVzdC1zZWNyZXQtc3RyaW5n',
    port: 38_472,
  }),
  decodePairingSecret: (b64: string) => {
    const len = Math.max(1, Math.floor(b64.length * 0.75));
    return new Uint8Array(len);
  },
}));

vi.mock('./invitation', () => ({
  encodeLanSyncInvitation: (input: {
    host: string;
    port: number;
    sessionId: string;
    expiresAt: number;
  }) => ({
    uri: `medbox-lan://join?host=${input.host}&port=${input.port}&sid=${input.sessionId}`,
    ...input,
  }),
}));

vi.mock('./policy', () => ({
  isLanAllowRemoteOverwrite: () => true,
}));

vi.mock('./session', () => ({
  getLanSyncDeviceName: () => '测试设备',
  startLanSyncHost: vi.fn().mockResolvedValue({
    invitation: { uri: 'medbox-lan://host' },
    completion: new Promise(() => undefined), // 永不完成（host 长驻）
    close: async () => undefined,
  }),
  joinLanSyncHost: (
    uri: string,
    opts: { allowRemoteOverwrite?: boolean } = {},
  ) => {
    state.joinCalls.push({ uri, allowOverwrite: opts.allowRemoteOverwrite ?? false });
    if (state.joinImpl) return state.joinImpl(uri, opts);
    return Promise.resolve();
  },
}));

// ---- 引入被测模块（在 mock 之后）----
import {
  isLanAutoSyncSilent,
  setLanAutoSyncSilent,
  triggerManualJoinAll,
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  stopAutoSync,
} from './autoSync';

// ---- 测试夹具 ----
const SAMPLE_PEER = {
  deviceId: 'device-aaa',
  deviceName: '客厅手机',
  host: '192.168.1.10',
  port: 38_472,
  pairingSessionId: 'fixedsessionid0000001',
  pairingSecretB64: 'dGVzdC1zZWNyZXQtc3RyaW5n',
  lastSeenAt: 1_725_000_000_000,
};

function setPeers(peers: typeof state.peers): void {
  state.peers.length = 0;
  state.peers.push(...peers);
}

function setJoinImpl(
  impl: ((uri: string, opts: { allowRemoteOverwrite?: boolean }) => Promise<void>) | null,
): void {
  state.joinImpl = impl;
}

function resetState(): void {
  state.peers.length = 0;
  state.joinCalls.length = 0;
  state.joinImpl = null;
}

describe('lanAutoSyncSilent toggle', () => {
  beforeEach(() => {
    resetState();
    memoryLocalStorage.clear();
    vi.stubGlobal('window', stubWindow);
    vi.stubGlobal('localStorage', memoryLocalStorage);
    setAutoSyncEnabled(false);
    stopAutoSync();
  });

  afterEach(() => {
    setAutoSyncEnabled(false);
    stopAutoSync();
    vi.unstubAllGlobals();
  });

  it('defaults to silent=true when localStorage has no value', () => {
    expect(isLanAutoSyncSilent()).toBe(true);
  });

  it('persists across reads after setLanAutoSyncSilent', () => {
    setLanAutoSyncSilent(false);
    expect(isLanAutoSyncSilent()).toBe(false);
    setLanAutoSyncSilent(true);
    expect(isLanAutoSyncSilent()).toBe(true);
  });
});

describe('triggerManualJoinAll', () => {
  beforeEach(() => {
    resetState();
    memoryLocalStorage.clear();
    vi.stubGlobal('window', stubWindow);
    vi.stubGlobal('localStorage', memoryLocalStorage);
    setAutoSyncEnabled(false);
    stopAutoSync();
  });

  afterEach(() => {
    setAutoSyncEnabled(false);
    stopAutoSync();
    vi.unstubAllGlobals();
  });

  it('returns zero summary when no known peers', async () => {
    setPeers([]);
    const summary = await triggerManualJoinAll();
    expect(summary).toEqual({ joined: 0, failed: 0, skipped: 0 });
    expect(state.joinCalls).toHaveLength(0);
  });

  it('joins all peers and reports success counts in silent mode', async () => {
    setPeers([
      { ...SAMPLE_PEER, deviceId: 'd1', host: '192.168.1.10' },
      { ...SAMPLE_PEER, deviceId: 'd2', host: '192.168.1.11' },
    ]);
    setLanAutoSyncSilent(true);
    setJoinImpl(() => Promise.resolve());

    const summary = await triggerManualJoinAll();

    expect(summary).toEqual({ joined: 2, failed: 0, skipped: 0 });
    expect(state.joinCalls).toHaveLength(2);
    // silent=true → allowRemoteOverwrite 跟随 isLanAllowRemoteOverwrite() = true
    expect(state.joinCalls[0].allowOverwrite).toBe(true);
  });

  it('marks peer as skipped when not silent and host refuses overwrite-local', async () => {
    setPeers([{ ...SAMPLE_PEER }]);
    setLanAutoSyncSilent(false);
    setJoinImpl(() =>
      Promise.reject(new Error('对方未开启「允许被覆盖」。请对方打开该开关。')),
    );

    const summary = await triggerManualJoinAll();

    expect(summary).toEqual({ joined: 0, failed: 0, skipped: 1 });
    // silent=false → allowRemoteOverwrite=false 强制关闭
    expect(state.joinCalls[0].allowOverwrite).toBe(false);
  });

  it('does not catch unrelated errors when silent=false', async () => {
    setPeers([{ ...SAMPLE_PEER }]);
    setLanAutoSyncSilent(false);
    setJoinImpl(() => Promise.reject(new Error('网络连接失败')));

    const summary = await triggerManualJoinAll();

    expect(summary).toEqual({ joined: 0, failed: 1, skipped: 0 });
  });

  it('does not require autoSync to be enabled', async () => {
    setPeers([{ ...SAMPLE_PEER }]);
    setLanAutoSyncSilent(true);
    setAutoSyncEnabled(false);
    setJoinImpl(() => Promise.resolve());

    const summary = await triggerManualJoinAll();

    expect(summary.joined).toBe(1);
    expect(isAutoSyncEnabled()).toBe(false);
  });
});
