import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

export type LanSyncNativeState = 'listening' | 'connecting' | 'connected' | 'closed' | 'error';

export interface LanSyncConnection {
  connectionId: string;
  host: string;
  port: number;
}

export interface LanSyncStateEvent {
  connectionId: string;
  state: LanSyncNativeState;
  host?: string;
  port?: number;
  code?: string;
}

export interface LanSyncFrameEvent {
  connectionId: string;
  data: string;
}

interface LanSyncPlugin {
  startHost(): Promise<LanSyncConnection>;
  connect(options: { host: string; port: number }): Promise<LanSyncConnection>;
  send(options: { connectionId: string; data: string }): Promise<{ bytes: number }>;
  close(options: { connectionId: string }): Promise<{ closed: boolean }>;
  addListener(
    eventName: 'lanSyncState',
    listener: (event: LanSyncStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'lanSyncFrame',
    listener: (event: LanSyncFrameEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export interface LanSyncTransport {
  startHost(): Promise<LanSyncConnection>;
  connect(options: { host: string; port: number }): Promise<LanSyncConnection>;
  send(options: { connectionId: string; data: string }): Promise<{ bytes: number }>;
  close(connectionId: string): Promise<boolean>;
  onState(listener: (event: LanSyncStateEvent) => void): Promise<() => Promise<void>>;
  onFrame(listener: (event: LanSyncFrameEvent) => void): Promise<() => Promise<void>>;
}

const plugin = registerPlugin<LanSyncPlugin>('LanSync');

export class NativeLanSyncTransport implements LanSyncTransport {
  async startHost(): Promise<LanSyncConnection> {
    assertLanSyncAvailable();
    return plugin.startHost();
  }

  async connect(options: { host: string; port: number }): Promise<LanSyncConnection> {
    assertLanSyncAvailable();
    return plugin.connect(options);
  }

  async send(options: { connectionId: string; data: string }): Promise<{ bytes: number }> {
    assertLanSyncAvailable();
    return plugin.send(options);
  }

  async close(connectionId: string): Promise<boolean> {
    if (!isLanSyncAvailable()) return false;
    return (await plugin.close({ connectionId })).closed;
  }

  async onState(listener: (event: LanSyncStateEvent) => void): Promise<() => Promise<void>> {
    assertLanSyncAvailable();
    const handle = await plugin.addListener('lanSyncState', listener);
    return () => handle.remove();
  }

  async onFrame(listener: (event: LanSyncFrameEvent) => void): Promise<() => Promise<void>> {
    assertLanSyncAvailable();
    const handle = await plugin.addListener('lanSyncFrame', listener);
    return () => handle.remove();
  }
}

export function isLanSyncAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LanSync');
  } catch {
    return false;
  }
}

export function describeLanSyncTransportError(code?: string): string {
  switch (code) {
    case 'NO_LAN_ADDRESS':
      return '请先让手机连上 Wi-Fi，再试一次。';
    case 'CONNECT_TIMEOUT':
    case 'ACCEPT_TIMEOUT':
      return '没有连上。请确认两台手机用了同一个 Wi-Fi，再试一次。';
    case 'READ_TIMEOUT':
      return '等待时间太久，请让两台手机都停留在这个页面后重试。';
    case 'FRAME_TOO_LARGE':
      return '要传送的资料太多，请先减少旧记录后再试。';
    default:
      return '当前 Wi-Fi 可能不允许手机互相连接，可以换一个网络后重试。';
  }
}

function assertLanSyncAvailable(): void {
  if (!isLanSyncAvailable()) {
    throw new Error('局域网家庭同步只能在 Android App 中使用。');
  }
}
