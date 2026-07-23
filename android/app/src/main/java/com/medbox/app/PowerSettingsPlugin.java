package com.medbox.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 暴露电源/电池优化相关设置给前端：
 * - isIgnoringBatteryOptimizations：查本应用是否在电池优化白名单
 * - requestIgnoreBatteryOptimizations：弹系统对话框申请加入白名单
 * - openAppSettings：打开本应用系统设置页（兜底）
 */
@CapacitorPlugin(name = "PowerSettings")
public final class PowerSettingsPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ignoring", isIgnoring(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        try {
            if (!isIgnoring(getContext())) {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
            JSObject result = new JSObject();
            result.put("ignoring", isIgnoring(getContext()));
            call.resolve(result);
        } catch (Throwable error) {
            call.reject("无法申请电池优化白名单", "POWER_SETTINGS_ERROR");
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", getContext().getPackageName(), null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Throwable error) {
            call.reject("无法打开应用设置", "POWER_SETTINGS_ERROR");
        }
    }

    private static boolean isIgnoring(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
    }
}
