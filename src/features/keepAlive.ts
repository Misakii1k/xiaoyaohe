// 申请电池优化白名单：保活的前置条件，让系统不杀后台 WebView。
import { Capacitor } from '@capacitor/core';

interface PowerSettingsPlugin {
  isIgnoringBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ ignoring: boolean }>;
  openAppSettings(): Promise<void>;
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
