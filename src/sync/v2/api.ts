import {
  SYNC_V2_LIMITS,
  isValidDeviceId,
  isValidHouseholdId,
  validateDeviceName,
  validateSyncRequest,
  validateSyncResponse,
  type SyncRequestV2,
  type SyncResponseV2,
} from './protocol';

const SMALL_REQUEST_LIMIT = 2_048;
const ERROR_RESPONSE_LIMIT = 64 * 1024;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{3,64}\.[A-Za-z0-9_-]{40,64}$/;

export type SyncFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SyncV2ApiOptions {
  fetch?: SyncFetch;
  timeoutMs?: number;
}

export interface SyncV2CallOptions {
  signal?: AbortSignal;
}

export interface CreatedSyncDevice {
  id: string;
  name: string;
  token: string;
  rotatedAt?: number;
}

export interface CreatedHouseholdResponse {
  householdId: string;
  householdRevision: number;
  device: CreatedSyncDevice;
}

export interface PairingSecretResponse {
  pairingCode: string;
  expiresAt: number;
}

export interface SyncDeviceSummary {
  id: string;
  name: string;
  createdAt: number;
  rotatedAt?: number;
  revokedAt?: number;
}

export interface DeviceListResponse {
  authenticatedDeviceId: string;
  devices: SyncDeviceSummary[];
}

export interface RevokeDeviceResponse {
  deviceId: string;
  revokedAt: number;
}

export class SyncV2HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details: unknown,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Sync API returned ${status}: ${code}`);
    this.name = 'SyncV2HttpError';
  }
}

export class SyncV2NetworkError extends Error {
  constructor(message: string, readonly timedOut: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SyncV2NetworkError';
  }
}

export class SyncV2ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncV2ProtocolError';
  }
}

export class SyncV2Api {
  readonly endpoint: string;
  private readonly fetchImpl: SyncFetch;
  private readonly timeoutMs: number;

  constructor(endpoint: string, options: SyncV2ApiOptions = {}) {
    this.endpoint = normalizeEndpoint(endpoint);
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 120_000) {
      throw new Error('Sync request timeout must be between 1 ms and 120 seconds.');
    }
  }

  async createHousehold(deviceName: string, options: SyncV2CallOptions = {}): Promise<CreatedHouseholdResponse> {
    const name = parseDeviceName(deviceName);
    const value = await this.requestJson(
      '/api/v2/households',
      { method: 'POST', body: { deviceName: name }, signal: options.signal },
      SMALL_REQUEST_LIMIT,
    );
    return parseHouseholdResponse(value);
  }

  async createPairingCode(
    householdId: string,
    deviceToken: string,
    options: SyncV2CallOptions = {},
  ): Promise<PairingSecretResponse> {
    assertHouseholdId(householdId);
    assertDeviceToken(deviceToken);
    const value = await this.requestJson(
      `/api/v2/households/${householdId}/pairing-codes`,
      { method: 'POST', body: {}, bearer: deviceToken, signal: options.signal },
      SMALL_REQUEST_LIMIT,
    );
    const record = expectRecord(value, 'pairing-code response');
    if (
      typeof record.pairingCode !== 'string' ||
      !/^[A-Za-z0-9_-]{20,128}$/.test(record.pairingCode) ||
      !isTimestamp(record.expiresAt)
    ) {
      throw new SyncV2ProtocolError('The pairing-code response is invalid.');
    }
    return { pairingCode: record.pairingCode, expiresAt: record.expiresAt };
  }

  async pairDevice(
    householdId: string,
    pairingCode: string,
    deviceName: string,
    options: SyncV2CallOptions = {},
  ): Promise<CreatedHouseholdResponse> {
    assertHouseholdId(householdId);
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(pairingCode)) throw new Error('Invalid one-time pairing code.');
    const name = parseDeviceName(deviceName);
    const value = await this.requestJson(
      `/api/v2/households/${householdId}/pair`,
      {
        method: 'POST',
        body: { deviceName: name },
        headers: { 'x-medbox-pairing-code': pairingCode },
        signal: options.signal,
      },
      SMALL_REQUEST_LIMIT,
    );
    return parseHouseholdResponse(value);
  }

  async listDevices(
    householdId: string,
    deviceToken: string,
    options: SyncV2CallOptions = {},
  ): Promise<DeviceListResponse> {
    assertHouseholdId(householdId);
    assertDeviceToken(deviceToken);
    const value = await this.requestJson(
      `/api/v2/households/${householdId}/devices`,
      { method: 'GET', bearer: deviceToken, signal: options.signal },
      SMALL_REQUEST_LIMIT,
    );
    const record = expectRecord(value, 'device-list response');
    if (!isValidDeviceId(record.authenticatedDeviceId) || !Array.isArray(record.devices) || record.devices.length > 16) {
      throw new SyncV2ProtocolError('The device-list response is invalid.');
    }
    const devices = record.devices.map(parseDeviceSummary);
    return { authenticatedDeviceId: record.authenticatedDeviceId, devices };
  }

  async revokeDevice(
    householdId: string,
    deviceToken: string,
    targetDeviceId: string,
    options: SyncV2CallOptions = {},
  ): Promise<RevokeDeviceResponse> {
    assertHouseholdId(householdId);
    assertDeviceToken(deviceToken);
    assertDeviceId(targetDeviceId);
    const value = await this.requestJson(
      `/api/v2/households/${householdId}/devices/${encodeURIComponent(targetDeviceId)}`,
      { method: 'DELETE', bearer: deviceToken, signal: options.signal },
      SMALL_REQUEST_LIMIT,
    );
    const record = expectRecord(value, 'device-revocation response');
    if (record.deviceId !== targetDeviceId || !isTimestamp(record.revokedAt)) {
      throw new SyncV2ProtocolError('The device-revocation response is invalid.');
    }
    return { deviceId: record.deviceId, revokedAt: record.revokedAt };
  }

  async rotateDeviceToken(
    householdId: string,
    deviceToken: string,
    deviceId: string,
    options: SyncV2CallOptions = {},
  ): Promise<CreatedSyncDevice> {
    assertHouseholdId(householdId);
    assertDeviceToken(deviceToken);
    assertDeviceId(deviceId);
    const value = await this.requestJson(
      `/api/v2/households/${householdId}/devices/${encodeURIComponent(deviceId)}/rotate`,
      { method: 'POST', body: {}, bearer: deviceToken, signal: options.signal },
      SMALL_REQUEST_LIMIT,
    );
    const record = expectRecord(value, 'device-token response');
    const device = parseCreatedDevice(record.device);
    if (device.id !== deviceId || device.rotatedAt === undefined) {
      throw new SyncV2ProtocolError('The device-token response is invalid.');
    }
    return device;
  }

  async sync(
    householdId: string,
    deviceToken: string,
    request: SyncRequestV2,
    options: SyncV2CallOptions = {},
  ): Promise<SyncResponseV2> {
    assertHouseholdId(householdId);
    assertDeviceToken(deviceToken);
    const parsedRequest = validateSyncRequest(request);
    if (!parsedRequest.ok) throw new Error(parsedRequest.issues[0]?.message ?? 'Invalid sync request.');
    const value = await this.requestJson(
      `/api/v2/households/${householdId}/sync`,
      { method: 'POST', body: parsedRequest.value, bearer: deviceToken, signal: options.signal },
      SYNC_V2_LIMITS.requestBytes,
      SYNC_V2_LIMITS.responseBytes,
    );
    const parsedResponse = validateSyncResponse(value);
    if (!parsedResponse.ok) {
      throw new SyncV2ProtocolError(parsedResponse.issues[0]?.message ?? 'The sync response is invalid.');
    }
    return parsedResponse.value;
  }

  private async requestJson(
    path: string,
    request: {
      method: 'GET' | 'POST' | 'DELETE';
      body?: unknown;
      bearer?: string;
      headers?: HeadersInit;
      signal?: AbortSignal;
    },
    requestLimit: number,
    responseLimit = SYNC_V2_LIMITS.responseBytes,
  ): Promise<unknown> {
    const headers = new Headers(request.headers);
    headers.set('accept', 'application/json');
    headers.set('cache-control', 'no-store');
    headers.set('pragma', 'no-cache');
    if (request.bearer) headers.set('authorization', `Bearer ${request.bearer}`);

    let body: string | undefined;
    if (request.body !== undefined) {
      body = JSON.stringify(request.body);
      if (byteLength(body) > requestLimit) throw new Error(`Sync request exceeds ${requestLimit} bytes.`);
      headers.set('content-type', 'application/json');
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = (): void => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Sync request timed out.', 'TimeoutError'));
    }, this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}${path}`, {
        method: request.method,
        headers,
        body,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (error) {
      const message = timedOut ? 'Sync request timed out.' : 'Sync endpoint is unreachable.';
      throw new SyncV2NetworkError(message, timedOut, { cause: error });
    } finally {
      globalThis.clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abortFromCaller);
    }

    const limit = response.ok ? responseLimit : ERROR_RESPONSE_LIMIT;
    const value = await readBoundedJson(response, limit);
    if (!response.ok) {
      const error = isRecord(value) && typeof value.error === 'string' ? value.error : 'http_error';
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      throw new SyncV2HttpError(response.status, error, value, retryAfter);
    }
    return value;
  }
}

export function normalizeEndpoint(value: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error('Invalid sync endpoint.');
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '')
  ) {
    throw new Error('Sync endpoint must be an HTTPS origin without credentials, path, query, or fragment.');
  }
  return endpoint.origin;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SyncV2ProtocolError(`Sync response exceeds ${maxBytes} bytes.`);
  }
  const text = await readBoundedResponseText(response, maxBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SyncV2ProtocolError('Sync endpoint returned invalid JSON.');
  }
}

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('Response byte limit must be a positive integer.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new SyncV2ProtocolError(`Sync response exceeds ${maxBytes} bytes.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof SyncV2ProtocolError) throw error;
    throw new SyncV2ProtocolError('Sync endpoint returned invalid UTF-8.');
  } finally {
    reader.releaseLock();
  }
}

function parseHouseholdResponse(value: unknown): CreatedHouseholdResponse {
  const record = expectRecord(value, 'household response');
  if (!isValidHouseholdId(record.householdId) || !isRevision(record.householdRevision)) {
    throw new SyncV2ProtocolError('The household response is invalid.');
  }
  return {
    householdId: record.householdId,
    householdRevision: record.householdRevision,
    device: parseCreatedDevice(record.device),
  };
}

function parseCreatedDevice(value: unknown): CreatedSyncDevice {
  const record = expectRecord(value, 'created device');
  if (!isValidDeviceId(record.id) || typeof record.name !== 'string' || !DEVICE_TOKEN_PATTERN.test(String(record.token))) {
    throw new SyncV2ProtocolError('The created device response is invalid.');
  }
  const device: CreatedSyncDevice = { id: record.id, name: record.name, token: record.token as string };
  if (record.rotatedAt !== undefined) {
    if (!isTimestamp(record.rotatedAt)) throw new SyncV2ProtocolError('The device rotation timestamp is invalid.');
    device.rotatedAt = record.rotatedAt;
  }
  return device;
}

function parseDeviceSummary(value: unknown): SyncDeviceSummary {
  const record = expectRecord(value, 'device');
  if (!isValidDeviceId(record.id) || typeof record.name !== 'string' || !isTimestamp(record.createdAt)) {
    throw new SyncV2ProtocolError('A device record is invalid.');
  }
  const result: SyncDeviceSummary = { id: record.id, name: record.name, createdAt: record.createdAt };
  if (record.rotatedAt !== undefined) {
    if (!isTimestamp(record.rotatedAt)) throw new SyncV2ProtocolError('A device rotation timestamp is invalid.');
    result.rotatedAt = record.rotatedAt;
  }
  if (record.revokedAt !== undefined) {
    if (!isTimestamp(record.revokedAt)) throw new SyncV2ProtocolError('A device revocation timestamp is invalid.');
    result.revokedAt = record.revokedAt;
  }
  return result;
}

function parseDeviceName(value: string): string {
  const result = validateDeviceName(value);
  if (!result.ok) throw new Error(result.issues[0]?.message ?? 'Invalid device name.');
  return result.value;
}

function assertHouseholdId(value: string): void {
  if (!isValidHouseholdId(value)) throw new Error('Invalid sync household ID.');
}

function assertDeviceId(value: string): void {
  if (!isValidDeviceId(value)) throw new Error('Invalid sync device ID.');
}

function assertDeviceToken(value: string): void {
  if (!DEVICE_TOKEN_PATTERN.test(value)) throw new Error('Invalid sync device token.');
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new SyncV2ProtocolError(`The ${label} is not an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
