import { describe, expect, it, vi } from 'vitest';
import { createLanSyncInvitation } from './invitation';
import type {
  LanSyncConnection,
  LanSyncFrameEvent,
  LanSyncStateEvent,
  LanSyncTransport,
} from './nativeTransport';
import {
  joinLanSyncHost,
  startLanSyncHost,
} from './session';
import {
  parseLanSyncSnapshot,
  type LanSyncApplyResult,
  type LanSyncMergeResult,
  type LanSyncSnapshot,
} from './store';

describe('LAN sync session orchestration', () => {
  it('completes one-scan host/join exchange and applies the same merged snapshot on both phones', async () => {
    const hub = new MemoryTransportHub();
    const hostTransport = new MemoryTransport(hub, 'host');
    const joinTransport = new MemoryTransport(hub, 'joiner');
    const hostApplied: LanSyncSnapshot[] = [];
    const joinApplied: LanSyncSnapshot[] = [];
    const hostReschedule = vi.fn(async () => reminderResult('ok'));
    const joinReschedule = vi.fn(async () => reminderResult('failed'));

    const hosted = await startLanSyncHost({ deviceName: '妈妈的手机' }, {
      transport: hostTransport,
      createSnapshot: async (_deviceId, sessionId) => emptySnapshot(sessionId),
      mergeSnapshots: async (local, remote) => merged(local, remote),
      applySnapshot: async (snapshot) => {
        hostApplied.push(snapshot);
        return applyResult();
      },
      parseSnapshot: parseLanSyncSnapshot,
      reschedule: hostReschedule,
    });
    const joined = joinLanSyncHost(hosted.invitation.uri, { deviceName: '爸爸的手机' }, {
      transport: joinTransport,
      createSnapshot: async (_deviceId, sessionId) => emptySnapshot(sessionId),
      mergeSnapshots: async (local, remote) => merged(local, remote),
      applySnapshot: async (snapshot) => {
        joinApplied.push(snapshot);
        return applyResult();
      },
      parseSnapshot: parseLanSyncSnapshot,
      reschedule: joinReschedule,
    });

    const [hostResult, joinResult] = await Promise.all([hosted.completion, joined]);
    expect(hostResult.peerName).toBe('爸爸的手机');
    expect(joinResult.peerName).toBe('妈妈的手机');
    expect(hostResult.remindersNeedAttention).toBe(false);
    expect(joinResult.remindersNeedAttention).toBe(true);
    expect(hostApplied).toEqual(joinApplied);
    expect(hostApplied).toHaveLength(1);
    expect(hostReschedule).toHaveBeenCalledOnce();
    expect(joinReschedule).toHaveBeenCalledOnce();
    expect(hostTransport.closed).toContain('host-connection');
    expect(joinTransport.closed).toContain('joiner-connection');
  });

  it('closes an in-progress connection when the route is aborted', async () => {
    const hub = new MemoryTransportHub(false);
    const transport = new MemoryTransport(hub, 'joiner');
    const controller = new AbortController();
    const invitation = createLanSyncInvitation('192.168.1.9', 52_000);
    const joining = joinLanSyncHost(invitation.uri, { signal: controller.signal }, {
      transport,
      createSnapshot: async (_deviceId, sessionId) => emptySnapshot(sessionId),
      mergeSnapshots: async (local, remote) => merged(local, remote),
      applySnapshot: async () => applyResult(),
      parseSnapshot: parseLanSyncSnapshot,
      reschedule: async () => undefined,
    });
    queueMicrotask(() => controller.abort());

    await expect(joining).rejects.toThrow('同步已取消');
    expect(transport.closed).toContain('joiner-connection');
  });
});

function emptySnapshot(sessionId: string): LanSyncSnapshot {
  return parseLanSyncSnapshot({ schemaVersion: 1, sessionId, entries: [] });
}

function merged(local: LanSyncSnapshot, remote: LanSyncSnapshot): LanSyncMergeResult {
  expect(remote.sessionId).toBe(local.sessionId);
  return {
    snapshot: local,
    conflicts: [],
    inventoryConflicts: [],
    stats: { total: 0, selectedLocal: 0, selectedRemote: 0, tombstones: 0 },
  };
}

function applyResult(): LanSyncApplyResult {
  return {
    applied: 0,
    unchanged: 0,
    tombstones: 0,
    medications: 0,
    reminderRules: 0,
    schedules: 0,
    intakes: 0,
    reminderRescheduleRequired: false,
  };
}

function reminderResult(status: 'ok' | 'failed') {
  return {
    status,
    scheduled: status === 'ok' ? 1 : 0,
    cancelled: 0,
    truncated: 0,
    exactAlarm: 'granted' as const,
  };
}

class MemoryTransportHub {
  host?: MemoryTransport;
  joiner?: MemoryTransport;

  constructor(readonly autoConnect = true) {}
}

class MemoryTransport implements LanSyncTransport {
  readonly closed: string[] = [];
  private readonly stateListeners = new Set<(event: LanSyncStateEvent) => void>();
  private readonly frameListeners = new Set<(event: LanSyncFrameEvent) => void>();

  constructor(
    private readonly hub: MemoryTransportHub,
    private readonly role: 'host' | 'joiner',
  ) {}

  async startHost(): Promise<LanSyncConnection> {
    this.hub.host = this;
    return { connectionId: 'host-connection', host: '192.168.1.7', port: 51_000 };
  }

  async connect(options: { host: string; port: number }): Promise<LanSyncConnection> {
    this.hub.joiner = this;
    if (this.hub.autoConnect) {
      queueMicrotask(() => {
        this.hub.host?.emitState({ connectionId: 'host-connection', state: 'connected' });
        this.emitState({ connectionId: 'joiner-connection', state: 'connected' });
      });
    }
    return { connectionId: 'joiner-connection', ...options };
  }

  async send(options: { connectionId: string; data: string }): Promise<{ bytes: number }> {
    const target = this.role === 'host' ? this.hub.joiner : this.hub.host;
    if (!target) throw new Error('No peer');
    target.emitFrame({
      connectionId: this.role === 'host' ? 'joiner-connection' : 'host-connection',
      data: options.data,
    });
    return { bytes: new TextEncoder().encode(options.data).byteLength };
  }

  async close(connectionId: string): Promise<boolean> {
    this.closed.push(connectionId);
    this.emitState({ connectionId, state: 'closed' });
    return true;
  }

  async onState(listener: (event: LanSyncStateEvent) => void): Promise<() => Promise<void>> {
    this.stateListeners.add(listener);
    return async () => { this.stateListeners.delete(listener); };
  }

  async onFrame(listener: (event: LanSyncFrameEvent) => void): Promise<() => Promise<void>> {
    this.frameListeners.add(listener);
    return async () => { this.frameListeners.delete(listener); };
  }

  private emitState(event: LanSyncStateEvent): void {
    for (const listener of this.stateListeners) listener(event);
  }

  private emitFrame(event: LanSyncFrameEvent): void {
    for (const listener of this.frameListeners) listener(event);
  }
}
