// 申请电池优化白名单与各大厂商保活：让系统不杀后台 WebView 与 JS 定时器。
import { Capacitor } from '@capacitor/core';

export type OemBrand = 'xiaomi' | 'huawei' | 'oppo' | 'vivo' | 'generic';

export interface DeviceKeepAliveInfo {
  manufacturer: string;
  brand: string;
  model: string;
  sdkInt: number;
  matchedOem: OemBrand;
}

export interface OemOpenResult {
  success: boolean;
  brand: string;
  openedAction: string;
}

interface PowerSettingsPlugin {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  openAppSettings(): Promise<void>;
  getDeviceInfo(): Promise<DeviceKeepAliveInfo>;
  openOemKeepAliveSettings(options?: { brand?: string }): Promise<OemOpenResult>;
}

let plugin: PowerSettingsPlugin | null = null;
function getPlugin(): PowerSettingsPlugin | null {
  if (plugin) return plugin;
  if (!Capacitor.isNativePlatform()) return null;
  try {
    plugin = Capacitor.registerPlugin<PowerSettingsPlugin>('PowerSettings');
    return plugin;
  } catch {
    return null;
  }
}

/** 是否已在电池优化白名单（非原生平台返回 true，视为不需要保活）。 */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  const p = getPlugin();
  if (!p) return true;
  try {
    return (await p.isIgnoringBatteryOptimizations()).ignoring;
  } catch {
    return false;
  }
}

/** 弹系统对话框申请加入电池优化白名单。 */
export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  const p = getPlugin();
  if (!p) return true;
  try {
    return (await p.requestIgnoreBatteryOptimizations()).ignoring;
  } catch {
    return false;
  }
}

/** 兜底：打开本应用系统设置页。 */
export async function openAppSettings(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.openAppSettings();
  } catch {
    /* ignore */
  }
}

/** 获取当前设备型号、制造商与匹配到的主流安卓 OEM 厂商。 */
export async function getDeviceKeepAliveInfo(): Promise<DeviceKeepAliveInfo> {
  const p = getPlugin();
  if (!p) {
    return {
      manufacturer: '',
      brand: '',
      model: '',
      sdkInt: 0,
      matchedOem: 'generic',
    };
  }
  try {
    return await p.getDeviceInfo();
  } catch {
    return {
      manufacturer: '',
      brand: '',
      model: '',
      sdkInt: 0,
      matchedOem: 'generic',
    };
  }
}

/** 直接打开目标厂商的自启动或后台保活管理界面（失败时自动兜底打开应用系统设置）。 */
export async function openOemKeepAliveSettings(brand?: OemBrand): Promise<OemOpenResult> {
  const p = getPlugin();
  if (!p) {
    return { success: false, brand: brand || 'generic', openedAction: 'unsupported_platform' };
  }
  try {
    return await p.openOemKeepAliveSettings(brand ? { brand } : undefined);
  } catch {
    await openAppSettings();
    return { success: false, brand: brand || 'generic', openedAction: 'fallback_exception' };
  }
}
