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
  mergeLanSnapshotsWithPolicy,
  parseLanSyncSnapshot,
  type LanSyncApplyResult,
  type LanSyncMergeResult,
  type LanSyncSnapshot,
} from './store';
import {
  LOCAL_APP_VERSION,
  LOCAL_APP_VERSION_CODE,
  recordPeerVersion,
} from './apkTransport';
import {
  applySyncExtras,
  collectSyncExtras,
  syncExtrasSchema,
  type LanSyncContentOptions,
} from './extras';
import {
  buildLocalLanSummary,
  isLanAllowRemoteOverwrite,
  recommendLanPolicy,
  summarizeLanSnapshot,
  type LanDeviceSummary,
  type LanSyncPolicy,
} from './policy';
import {
  getOrCreateLocalAutoIdentity,
  rememberPeer,
} from './knownPeers';

const DEVICE_ID_KEY = 'medbox.lan-sync.device-id.v1';
const DEVICE_NAME_KEY = 'medbox.lan-sync.device-name.v1';
const LAST_RESULT_KEY = 'medbox.lan-sync.last-result.v1';
const FRAME_TIMEOUT_MS = 90_000;

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
  /** 可选同步内容（照片、API 配置） */
  syncOptions?: LanSyncContentOptions;
  /**
   * After both snapshots are known, choose merge vs whole-copy overwrite.
   * Host resolves policy (may prompt UI). Joiner may refuse overwrite via allowOverwrite flag.
   */
  choosePolicy?: (input: {
    local: LanDeviceSummary;
    remote: LanDeviceSummary;
    recommended: LanSyncPolicy;
  }) => Promise<LanSyncPolicy>;
  /** Joiner: allow peer to overwrite this device (default false unless settings switch). */
  allowRemoteOverwrite?: boolean;
  /** Host: bind a fixed port (auto-sync). Omit for ephemeral QR port. */
  port?: number;
  /** Host: reuse long-lived secret/sessionId for auto-sync host identity. */
  invitationOverride?: {
    sessionId: string;
    secret: Uint8Array;
    lifetimeMs?: number;
  };
}

interface LanSyncDevice {
  id: string;
  name: string;
}

interface LanSyncSessionDependencies {
  transport: LanSyncTransport;
  createSnapshot: typeof createLanSnapshot;
  /**
   * @deprecated 从未被消费（会话用 mergeLanSnapshotsWithPolicy 直接合并）。
   * 仅保留类型定义以兼容既有测试注入，buildDependencies 不再实例化。
   */
  mergeSnapshots?: typeof mergeLanSnapshots;
  applySnapshot: typeof applyLanMergedSnapshot;
  parseSnapshot: typeof parseLanSyncSnapshot;
  reschedule: typeof rescheduleMedicationReminders;
  buildLocalSummary: typeof buildLocalLanSummary;
  now: () => number;
}

const deviceSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/),
  name: z.string().trim().min(1).max(80),
}).strict();

/** 双方交换的自动同步身份（对方以后 join 本机用）。 */
const autoIdentitySchema = z.object({
  host: z.string().min(7).max(45),
  port: z.number().int().min(1024).max(65_535),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  secretB64: z.string().min(22).max(64),
}).strict();

const joinPayloadSchema = z.object({
  kind: z.literal('medbox.lan.join'),
  version: z.literal(1),
  device: deviceSchema,
  snapshot: z.unknown(),
  extras: z.unknown().optional(),
  allowOverwrite: z.boolean().optional().default(false),
  summary: z.object({
    dataUpdatedAt: z.number().int().nonnegative(),
    inventoryHint: z.string().max(200),
    medicationCount: z.number().int().nonnegative(),
    withInventoryCount: z.number().int().nonnegative(),
    maxClock: z.number().int().nonnegative(),
  }).optional(),
  autoIdentity: autoIdentitySchema.optional(),
  /** 加入端运行的应用版本（如 "0.9.1"），用于主机端 APK 更新发现。 */
  appVersion: z.string().max(40).optional(),
  /** 加入端 Android versionCode，用于版本比较。 */
  versionCode: z.number().int().nonnegative().optional(),
}).strict();

const resultPayloadSchema = z.object({
  kind: z.literal('medbox.lan.result'),
  version: z.literal(1),
  device: deviceSchema,
  snapshot: z.unknown(),
  conflictCount: z.number().int().nonnegative(),
  inventoryConflicts: z.array(z.string().max(80)).max(1_000),
  extras: z.unknown().optional(),
  policy: z.enum(['merge', 'overwrite-local', 'overwrite-remote']).optional(),
  autoIdentity: autoIdentitySchema.optional(),
  /** 主机端运行的应用版本（如 "0.9.1"），用于加入端 APK 更新发现。 */
  appVersion: z.string().max(40).optional(),
  /** 主机端 Android versionCode，用于版本比较。 */
  versionCode: z.number().int().nonnegative().optional(),
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
    const connection = await dependencies.transport.startHost(
      options.port != null ? { port: options.port } : undefined,
    );
    connectionId = connection.connectionId;
    const invitation = createLanSyncInvitation(
      connection.host,
      connection.port,
      dependencies.now(),
      options.invitationOverride
        ? {
            sessionId: options.invitationOverride.sessionId,
            secret: options.invitationOverride.secret,
            lifetimeMs: options.invitationOverride.lifetimeMs,
          }
        : undefined,
    );
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
      options.syncOptions,
      options.choosePolicy,
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
    const localSummary = await dependencies.buildLocalSummary(snapshot, device);
    const extras = options.syncOptions
      ? await collectSyncExtras(options.syncOptions)
      : undefined;
    const allowOverwrite = options.allowRemoteOverwrite ?? isLanAllowRemoteOverwrite();
    // joiner 公告本机 IP（不是 invitation.host，那是对方地址）
    let localHost: string | null = null;
    try {
      localHost = dependencies.transport.getLocalAddress
        ? await dependencies.transport.getLocalAddress()
        : null;
    } catch {
      localHost = null;
    }
    const localAuto = localHost ? buildAutoIdentityPayload(localHost) : null;
    await dependencies.transport.send({
      connectionId,
      data: await encryptLanSyncMessage(key, messageMetadata(invitation.sessionId, 'joiner', 1, 'join'), {
        kind: 'medbox.lan.join',
        version: 1,
        device,
        snapshot,
        allowOverwrite,
        summary: {
          dataUpdatedAt: localSummary.dataUpdatedAt,
          inventoryHint: localSummary.inventoryHint,
          medicationCount: localSummary.medicationCount,
          withInventoryCount: localSummary.withInventoryCount,
          maxClock: localSummary.maxClock,
        },
        ...(extras ? { extras } : {}),
        ...(localAuto ? { autoIdentity: localAuto } : {}),
        // 把本机应用版本公告给主机端，便于主机端发现可用更新。
        ...(LOCAL_APP_VERSION ? { appVersion: LOCAL_APP_VERSION } : {}),
        ...(LOCAL_APP_VERSION_CODE ? { versionCode: LOCAL_APP_VERSION_CODE } : {}),
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
    // 应用主机端发来的可选内容（照片、API 配置）
    if (resultPayload.extras) {
      const parsed = syncExtrasSchema.safeParse(resultPayload.extras);
      if (parsed.success) await applySyncExtras(parsed.data);
    }
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
    // 记住主机的自动同步身份，供之后 30 分钟轮询 join
    if (resultPayload.autoIdentity) {
      rememberPeerFromAutoIdentity(resultPayload.device, resultPayload.autoIdentity, dependencies.now());
    }
    // 主机端公告的应用版本更高时，记录可用更新（供 autoSync/UI 订阅）
    recordPeerVersion(invitation.host, resultPayload);
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
  syncOptions?: LanSyncContentOptions,
  choosePolicy?: LanSyncSessionOptions['choosePolicy'],
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
    const localSummary = await dependencies.buildLocalSummary(localSnapshot, device);
    const remoteSummary = joinPayload.summary
      ? {
          deviceId: joinPayload.device.id,
          deviceName: joinPayload.device.name,
          entryCount: remoteSnapshot.entries.length,
          medicationCount: joinPayload.summary.medicationCount,
          withInventoryCount: joinPayload.summary.withInventoryCount,
          maxClock: joinPayload.summary.maxClock,
          dataUpdatedAt: joinPayload.summary.dataUpdatedAt,
          inventoryHint: joinPayload.summary.inventoryHint,
        }
      : summarizeLanSnapshot(
        remoteSnapshot,
        joinPayload.device,
        0,
        '对方未提供库存摘要',
      );
    // 加入端公告的应用版本更高时，记录可用更新。主机端用 invitation.host 暂作 fallback。
    // 一般主机端不需要主动升级，所以这里只是兜底记录，主机端的版本判断通常不重要。
    recordPeerVersion(invitation.host, joinPayload);
    const recommended = recommendLanPolicy(localSummary, remoteSummary);
    let policy: LanSyncPolicy = recommended;
    if (choosePolicy) {
      onProgress?.({ stage: 'transferring', message: '请选择同步方式' });
      policy = await choosePolicy({ local: localSummary, remote: remoteSummary, recommended });
    }
    if (policy === 'overwrite-local' && !joinPayload.allowOverwrite) {
      throw new Error('对方未开启「允许被覆盖」。请对方打开该开关，或改用智能合并。');
    }
    // overwrite-remote: host takes remote data — host always consents by choosing it.
    const merged = await mergeLanSnapshotsWithPolicy(localSnapshot, remoteSnapshot, policy);
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
    // 应用加入端发来的可选内容（照片、API 配置）
    if (joinPayload.extras) {
      const parsed = syncExtrasSchema.safeParse(joinPayload.extras);
      if (parsed.success) await applySyncExtras(parsed.data);
    }
    const remindersNeedAttention = await checkRemindersAfterSync(dependencies);
    // 收集主机端的可选内容回传给加入端
    const hostExtras = syncOptions
      ? await collectSyncExtras(syncOptions)
      : undefined;
    // 主机把自己的自动同步身份发给 joiner（host IP 就是 invitation.host）
    const hostAuto = buildAutoIdentityPayload(invitation.host);
    // 同时记住 joiner 发来的自动同步身份
    if (joinPayload.autoIdentity) {
      rememberPeerFromAutoIdentity(joinPayload.device, joinPayload.autoIdentity, dependencies.now());
    }
    await dependencies.transport.send({
      connectionId,
      data: await encryptLanSyncMessage(key, messageMetadata(invitation.sessionId, 'host', 1, 'result'), {
        kind: 'medbox.lan.result',
        version: 1,
        device,
        snapshot: merged.snapshot,
        conflictCount: merged.conflicts.length,
        inventoryConflicts: merged.inventoryConflicts,
        policy,
        ...(hostExtras ? { extras: hostExtras } : {}),
        ...(hostAuto ? { autoIdentity: hostAuto } : {}),
        // 把本机应用版本公告给加入端，便于加入端发现可用更新。
        ...(LOCAL_APP_VERSION ? { appVersion: LOCAL_APP_VERSION } : {}),
        ...(LOCAL_APP_VERSION_CODE ? { versionCode: LOCAL_APP_VERSION_CODE } : {}),
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
    applySnapshot: overrides.applySnapshot ?? applyLanMergedSnapshot,
    parseSnapshot: overrides.parseSnapshot ?? parseLanSyncSnapshot,
    reschedule: overrides.reschedule ?? rescheduleMedicationReminders,
    buildLocalSummary: overrides.buildLocalSummary ?? buildLocalLanSummary,
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

/** 本机当前 Wi‑Fi IPv4（来自 invitation host）+ localAutoIdentity → 发给对端。 */
function buildAutoIdentityPayload(host: string): {
  host: string;
  port: number;
  sessionId: string;
  secretB64: string;
} | null {
  try {
    const identity = getOrCreateLocalAutoIdentity();
    return {
      host,
      port: identity.port,
      sessionId: identity.sessionId,
      secretB64: identity.secretB64,
    };
  } catch {
    return null;
  }
}

function rememberPeerFromAutoIdentity(
  device: { id: string; name: string },
  auto: { host: string; port: number; sessionId: string; secretB64: string },
  now: number,
): void {
  rememberPeer({
    deviceId: device.id,
    deviceName: device.name,
    host: auto.host,
    port: auto.port,
    pairingSessionId: auto.sessionId,
    pairingSecretB64: auto.secretB64,
    lastSeenAt: now,
  });
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
