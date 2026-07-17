import { z } from 'zod';
import { rescheduleMedicationReminders } from '../../features/reminderScheduler';
import {
  decryptLanSyncMessage,
  deriveLanSyncSessionKey,
  encryptLanSyncMessage,
  parseLanSyncEncryptedMessage,
  type LanSyncMessageMetadata,
} from './crypto';
import {
  createLanSyncInvitation,
  parseLanSyncInvitation,
  type CreatedLanSyncInvitation,
} from './invitation';
import {
  NativeLanSyncTransport,
  describeLanSyncTransportError,
  type LanSyncFrameEvent,
  type LanSyncStateEvent,
  type LanSyncTransport,
} from './nativeTransport';
import {
  applyLanMergedSnapshot,
  createLanSnapshot,
  mergeLanSnapshots,
  parseLanSyncSnapshot,
  type LanSyncApplyResult,
  type LanSyncMergeResult,
  type LanSyncSnapshot,
} from './store';

const DEVICE_ID_KEY = 'medbox.lan-sync.device-id.v1';
const DEVICE_NAME_KEY = 'medbox.lan-sync.device-name.v1';
const LAST_RESULT_KEY = 'medbox.lan-sync.last-result.v1';
const FRAME_TIMEOUT_MS = 30_000;

export type LanSyncProgressStage = 'waiting' | 'connecting' | 'transferring' | 'complete';

export interface LanSyncProgress {
  stage: LanSyncProgressStage;
  message: string;
}

export interface LanSyncSessionResult {
  peerName: string;
  entryCount: number;
  conflictCount: number;
  inventoryConflicts: string[];
  remindersNeedAttention: boolean;
  completedAt: number;
}

export interface HostedLanSyncSession {
  invitation: CreatedLanSyncInvitation;
  completion: Promise<LanSyncSessionResult>;
  close: () => Promise<void>;
}

export interface LanSyncSessionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: LanSyncProgress) => void;
  deviceName?: string;
}

interface LanSyncDevice {
  id: string;
  name: string;
}

interface LanSyncSessionDependencies {
  transport: LanSyncTransport;
  createSnapshot: typeof createLanSnapshot;
  mergeSnapshots: typeof mergeLanSnapshots;
  applySnapshot: typeof applyLanMergedSnapshot;
  parseSnapshot: typeof parseLanSyncSnapshot;
  reschedule: typeof rescheduleMedicationReminders;
  now: () => number;
}

const deviceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
}).strict();

const joinPayloadSchema = z.object({
  kind: z.literal('medbox.lan.join'),
  version: z.literal(1),
  device: deviceSchema,
  snapshot: z.unknown(),
}).strict();

const resultPayloadSchema = z.object({
  kind: z.literal('medbox.lan.result'),
  version: z.literal(1),
  device: deviceSchema,
  snapshot: z.unknown(),
  conflictCount: z.number().int().nonnegative(),
  inventoryConflicts: z.array(z.string().max(80)).max(1_000),
}).strict();

const ackPayloadSchema = z.object({
  kind: z.literal('medbox.lan.ack'),
  version: z.literal(1),
  applied: z.literal(true),
}).strict();

const errorPayloadSchema = z.object({
  kind: z.literal('medbox.lan.error'),
  version: z.literal(1),
  code: z.enum(['INVALID_DATA', 'APPLY_FAILED']),
}).strict();

export async function startLanSyncHost(
  options: LanSyncSessionOptions = {},
  dependencyOverrides: Partial<LanSyncSessionDependencies> = {},
): Promise<HostedLanSyncSession> {
  const dependencies = buildDependencies(dependencyOverrides);
  const inbox = new LanSyncTransportInbox(dependencies.transport);
  await inbox.start();
  let connectionId = '';
  try {
    const connection = await dependencies.transport.startHost();
    connectionId = connection.connectionId;
    const invitation = createLanSyncInvitation(connection.host, connection.port, dependencies.now());
    const controller = linkedAbortController(options.signal);
    const close = async (): Promise<void> => {
      controller.abort();
      await dependencies.transport.close(connection.connectionId).catch(() => false);
    };
    options.onProgress?.({ stage: 'waiting', message: '请让另一台手机扫这个码' });
    const completion = runHostSession(
      dependencies,
      inbox,
      connection.connectionId,
      invitation,
      resolveDevice(options.deviceName),
      controller.signal,
      options.onProgress,
    ).finally(async () => {
      await dependencies.transport.close(connection.connectionId).catch(() => false);
      await inbox.dispose();
    });
    return { invitation, completion, close };
  } catch (error) {
    if (connectionId) await dependencies.transport.close(connectionId).catch(() => false);
    await inbox.dispose();
    throw normalizeSessionError(error);
  }
}

export async function joinLanSyncHost(
  invitationValue: string,
  options: LanSyncSessionOptions = {},
  dependencyOverrides: Partial<LanSyncSessionDependencies> = {},
): Promise<LanSyncSessionResult> {
  const dependencies = buildDependencies(dependencyOverrides);
  const invitation = parseLanSyncInvitation(invitationValue, dependencies.now());
  const key = await deriveLanSyncSessionKey(invitation.secret, invitation.sessionId);
  const inbox = new LanSyncTransportInbox(dependencies.transport);
  const controller = linkedAbortController(options.signal);
  await inbox.start();
  let connectionId = '';
  try {
    options.onProgress?.({ stage: 'connecting', message: '正在连接' });
    const connection = await dependencies.transport.connect({
      host: invitation.host,
      port: invitation.port,
    });
    connectionId = connection.connectionId;
    await inbox.waitForConnected(connectionId, controller.signal, 10_000);
    if (dependencies.now() > invitation.expiresAt) {
      throw new Error('这个连接码已经过期，请重新生成。');
    }

    options.onProgress?.({ stage: 'transferring', message: '正在传送' });
    const device = resolveDevice(options.deviceName);
    const snapshot = await dependencies.createSnapshot(device.id, invitation.sessionId);
    await dependencies.transport.send({
      connectionId,
      data: await encryptLanSyncMessage(key, messageMetadata(invitation.sessionId, 'joiner', 1, 'join'), {
        kind: 'medbox.lan.join',
        version: 1,
        device,
        snapshot,
      }),
    });

    const response = await inbox.waitForFrame(connectionId, controller.signal, FRAME_TIMEOUT_MS);
    const envelope = parseLanSyncEncryptedMessage(response.data);
    if (envelope.sender !== 'host' || envelope.sequence !== 1) {
      throw new Error('连接已经失效，请重新扫码。');
    }
    if (envelope.messageType === 'error') {
      const payload = errorPayloadSchema.parse(await decryptLanSyncMessage(
        key,
        response.data,
        messageMetadata(invitation.sessionId, 'host', 1, 'error'),
      ));
      throw new Error(payload.code === 'INVALID_DATA'
        ? '另一台手机没有接受这些资料，请重新打开页面后再试。'
        : '资料没有传完，请重新同步。');
    }
    if (envelope.messageType !== 'result') throw new Error('连接已经失效，请重新扫码。');
    const resultPayload = resultPayloadSchema.parse(await decryptLanSyncMessage(
      key,
      response.data,
      messageMetadata(invitation.sessionId, 'host', 1, 'result'),
    ));
    const mergedSnapshot = dependencies.parseSnapshot(resultPayload.snapshot);
    await dependencies.applySnapshot(mergedSnapshot, snapshot);
    const remindersNeedAttention = await checkRemindersAfterSync(dependencies);
    await dependencies.transport.send({
      connectionId,
      data: await encryptLanSyncMessage(key, messageMetadata(invitation.sessionId, 'joiner', 2, 'ack'), {
        kind: 'medbox.lan.ack',
        version: 1,
        applied: true,
      }),
    });

    const result = completeResult(
      resultPayload.device,
      mergedSnapshot,
      resultPayload.conflictCount,
      resultPayload.inventoryConflicts,
      remindersNeedAttention,
      dependencies.now(),
    );
    rememberLastResult(result);
    options.onProgress?.({ stage: 'complete', message: '已同步' });
    return result;
  } catch (error) {
    if (connectionId) {
      await sendSessionError(
        dependencies.transport,
        connectionId,
        key,
        invitation.sessionId,
        'joiner',
        2,
        'APPLY_FAILED',
      );
    }
    throw normalizeSessionError(error);
  } finally {
    controller.abort();
    if (connectionId) await dependencies.transport.close(connectionId).catch(() => false);
    await inbox.dispose();
  }
}

export function getLanSyncDeviceName(): string {
  try {
    return normalizeDeviceName(localStorage.getItem(DEVICE_NAME_KEY) ?? '我的手机');
  } catch {
    return '我的手机';
  }
}

export function setLanSyncDeviceName(value: string): string {
  const normalized = normalizeDeviceName(value);
  try {
    localStorage.setItem(DEVICE_NAME_KEY, normalized);
  } catch {
    /* A denied preference write must not block a one-time sync. */
  }
  return normalized;
}

export function getLastLanSyncResult(): LanSyncSessionResult | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_RESULT_KEY) ?? 'null') as unknown;
    return z.object({
      peerName: z.string().min(1).max(80),
      entryCount: z.number().int().nonnegative(),
      conflictCount: z.number().int().nonnegative(),
      inventoryConflicts: z.array(z.string().max(80)).max(1_000),
      remindersNeedAttention: z.boolean().optional().default(false),
      completedAt: z.number().int().nonnegative(),
    }).strict().parse(parsed);
  } catch {
    return null;
  }
}

async function runHostSession(
  dependencies: LanSyncSessionDependencies,
  inbox: LanSyncTransportInbox,
  connectionId: string,
  invitation: CreatedLanSyncInvitation,
  device: LanSyncDevice,
  signal: AbortSignal,
  onProgress?: (progress: LanSyncProgress) => void,
): Promise<LanSyncSessionResult> {
  const key = await deriveLanSyncSessionKey(invitation.secret, invitation.sessionId);
  let connected = false;
  try {
    const remaining = Math.max(1, invitation.expiresAt - dependencies.now());
    await inbox.waitForConnected(connectionId, signal, remaining);
    connected = true;
    if (dependencies.now() > invitation.expiresAt) {
      throw new Error('这个连接码已经过期，请重新生成。');
    }
    onProgress?.({ stage: 'transferring', message: '正在传送' });
    const incoming = await inbox.waitForFrame(connectionId, signal, FRAME_TIMEOUT_MS);
    const joinPayload = joinPayloadSchema.parse(await decryptLanSyncMessage(
      key,
      incoming.data,
      messageMetadata(invitation.sessionId, 'joiner', 1, 'join'),
    ));
    const remoteSnapshot = dependencies.parseSnapshot(joinPayload.snapshot);
    const localSnapshot = await dependencies.createSnapshot(device.id, invitation.sessionId);
    const merged = await dependencies.mergeSnapshots(localSnapshot, remoteSnapshot);
    if (!merged.snapshot) {
      await sendSessionError(
        dependencies.transport,
        connectionId,
        key,
        invitation.sessionId,
        'host',
        1,
        'INVALID_DATA',
      );
      throw new Error('两台手机里的同一条资料无法核对，本次没有写入。');
    }
    await dependencies.applySnapshot(merged.snapshot, localSnapshot);
    const remindersNeedAttention = await checkRemindersAfterSync(dependencies);
    await dependencies.transport.send({
      connectionId,
      data: await encryptLanSyncMessage(key, messageMetadata(invitation.sessionId, 'host', 1, 'result'), {
        kind: 'medbox.lan.result',
        version: 1,
        device,
        snapshot: merged.snapshot,
        conflictCount: merged.conflicts.length,
        inventoryConflicts: merged.inventoryConflicts,
      }),
    });
    const acknowledgement = await inbox.waitForFrame(connectionId, signal, FRAME_TIMEOUT_MS);
    const ackEnvelope = parseLanSyncEncryptedMessage(acknowledgement.data);
    if (ackEnvelope.messageType === 'error') {
      errorPayloadSchema.parse(await decryptLanSyncMessage(
        key,
        acknowledgement.data,
        messageMetadata(invitation.sessionId, 'joiner', 2, 'error'),
      ));
      throw new Error('另一台手机没有保存完成，请重新同步。');
    }
    ackPayloadSchema.parse(await decryptLanSyncMessage(
      key,
      acknowledgement.data,
      messageMetadata(invitation.sessionId, 'joiner', 2, 'ack'),
    ));
    const result = completeResult(
      joinPayload.device,
      merged.snapshot,
      merged.conflicts.length,
      merged.inventoryConflicts,
      remindersNeedAttention,
      dependencies.now(),
    );
    rememberLastResult(result);
    onProgress?.({ stage: 'complete', message: '已同步' });
    return result;
  } catch (error) {
    if (connected) {
      await sendSessionError(
        dependencies.transport,
        connectionId,
        key,
        invitation.sessionId,
        'host',
        1,
        'APPLY_FAILED',
      );
    }
    throw normalizeSessionError(error);
  }
}

function buildDependencies(overrides: Partial<LanSyncSessionDependencies>): LanSyncSessionDependencies {
  return {
    transport: overrides.transport ?? new NativeLanSyncTransport(),
    createSnapshot: overrides.createSnapshot ?? createLanSnapshot,
    mergeSnapshots: overrides.mergeSnapshots ?? mergeLanSnapshots,
    applySnapshot: overrides.applySnapshot ?? applyLanMergedSnapshot,
    parseSnapshot: overrides.parseSnapshot ?? parseLanSyncSnapshot,
    reschedule: overrides.reschedule ?? rescheduleMedicationReminders,
    now: overrides.now ?? Date.now,
  };
}

function resolveDevice(name?: string): LanSyncDevice {
  let id = '';
  try {
    id = localStorage.getItem(DEVICE_ID_KEY) ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(id)) {
      id = `device:${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
  } catch {
    id = `device:${crypto.randomUUID()}`;
  }
  return { id, name: name ? setLanSyncDeviceName(name) : getLanSyncDeviceName() };
}

function normalizeDeviceName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) throw new Error('手机名称应为 1 到 80 个字。');
  return normalized;
}

function completeResult(
  peer: LanSyncDevice,
  snapshot: LanSyncSnapshot,
  conflictCount: number,
  inventoryConflicts: string[],
  remindersNeedAttention: boolean,
  completedAt: number,
): LanSyncSessionResult {
  return {
    peerName: peer.name,
    entryCount: snapshot.entries.length,
    conflictCount,
    inventoryConflicts: [...inventoryConflicts],
    remindersNeedAttention,
    completedAt,
  };
}

async function checkRemindersAfterSync(
  dependencies: LanSyncSessionDependencies,
): Promise<boolean> {
  try {
    const result = await dependencies.reschedule();
    return !result || result.status !== 'ok' || result.truncated > 0;
  } catch {
    return true;
  }
}

function rememberLastResult(result: LanSyncSessionResult): void {
  try {
    localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result));
  } catch {
    /* Last-sync display is optional. */
  }
}

function messageMetadata(
  sessionId: string,
  sender: 'host' | 'joiner',
  sequence: number,
  messageType: 'join' | 'result' | 'ack' | 'error',
): LanSyncMessageMetadata {
  return { sessionId, sender, sequence, messageType };
}

async function sendSessionError(
  transport: LanSyncTransport,
  connectionId: string,
  key: CryptoKey,
  sessionId: string,
  sender: 'host' | 'joiner',
  sequence: number,
  code: 'INVALID_DATA' | 'APPLY_FAILED',
): Promise<void> {
  await transport.send({
    connectionId,
    data: await encryptLanSyncMessage(key, messageMetadata(sessionId, sender, sequence, 'error'), {
      kind: 'medbox.lan.error',
      version: 1,
      code,
    }),
  }).catch(() => undefined);
}

function linkedAbortController(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller;
}

function normalizeSessionError(error: unknown): Error {
  if (error instanceof LanSyncNativeStateError) {
    return new Error(describeLanSyncTransportError(error.code));
  }
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return new Error(describeLanSyncTransportError(error.code));
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new Error('同步已取消。');
  }
  return error instanceof Error ? error : new Error('资料没有传完，请重新同步。');
}

class LanSyncNativeStateError extends Error {
  constructor(readonly code?: string) {
    super(code ?? 'LAN_SYNC_ERROR');
  }
}

class LanSyncTransportInbox {
  private readonly states: LanSyncStateEvent[] = [];
  private readonly frames: LanSyncFrameEvent[] = [];
  private readonly waiters = new Set<() => void>();
  private removeState?: () => Promise<void>;
  private removeFrame?: () => Promise<void>;

  constructor(private readonly transport: LanSyncTransport) {}

  async start(): Promise<void> {
    this.removeState = await this.transport.onState((event) => {
      this.states.push(event);
      this.notify();
    });
    try {
      this.removeFrame = await this.transport.onFrame((event) => {
        this.frames.push(event);
        this.notify();
      });
    } catch (error) {
      await this.removeState();
      this.removeState = undefined;
      throw error;
    }
  }

  async waitForConnected(connectionId: string, signal: AbortSignal, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.states.findIndex((event) => event.connectionId === connectionId &&
        (event.state === 'connected' || event.state === 'closed' || event.state === 'error'));
      if (index >= 0) {
        const [event] = this.states.splice(index, 1);
        if (event.state === 'connected') return;
        throw new LanSyncNativeStateError(event.code);
      }
      await this.waitForNotification(signal, deadline);
    }
  }

  async waitForFrame(connectionId: string, signal: AbortSignal, timeoutMs: number): Promise<LanSyncFrameEvent> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const frameIndex = this.frames.findIndex((event) => event.connectionId === connectionId);
      if (frameIndex >= 0) return this.frames.splice(frameIndex, 1)[0];
      const stateIndex = this.states.findIndex((event) => event.connectionId === connectionId &&
        (event.state === 'closed' || event.state === 'error'));
      if (stateIndex >= 0) {
        const [event] = this.states.splice(stateIndex, 1);
        throw new LanSyncNativeStateError(event.code);
      }
      await this.waitForNotification(signal, deadline);
    }
  }

  async dispose(): Promise<void> {
    const removals = [this.removeState?.(), this.removeFrame?.()].filter(
      (value): value is Promise<void> => value !== undefined,
    );
    this.removeState = undefined;
    this.removeFrame = undefined;
    await Promise.allSettled(removals);
    this.notify();
  }

  private notify(): void {
    for (const waiter of [...this.waiters]) waiter();
    this.waiters.clear();
  }

  private waitForNotification(signal: AbortSignal, deadline: number): Promise<void> {
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new LanSyncNativeStateError('READ_TIMEOUT'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.waiters.delete(onNotify);
        callback();
      };
      const onNotify = () => finish(resolve);
      const onAbort = () => finish(() => reject(new DOMException('Aborted', 'AbortError')));
      const timer = globalThis.setTimeout(
        () => finish(() => reject(new LanSyncNativeStateError('READ_TIMEOUT'))),
        remaining,
      );
      this.waiters.add(onNotify);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export type { LanSyncApplyResult, LanSyncMergeResult };
