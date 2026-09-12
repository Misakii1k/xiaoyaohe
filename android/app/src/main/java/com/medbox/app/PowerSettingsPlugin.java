package com.medbox.app;

import android.content.ComponentName;
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
 * 暴露电源/电池优化与各大国产厂商保活设置给前端：
 * - isIgnoringBatteryOptimizations：查本应用是否在系统电池优化白名单
 * - requestIgnoreBatteryOptimizations：弹系统对话框申请加入白名单
 * - openAppSettings：打开本应用系统设置页（兜底）
 * - getDeviceInfo：读取设备厂商与型号并匹配 OEM 品牌
 * - openOemKeepAliveSettings：直达小米/华为/OPPO/vivo 等系统自启动与后台防杀设置
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

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject result = new JSObject();
        String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER : "";
        String brand = Build.BRAND != null ? Build.BRAND : "";
        result.put("manufacturer", manufacturer);
        result.put("brand", brand);
        result.put("model", Build.MODEL != null ? Build.MODEL : "");
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("matchedOem", detectOemBrand(manufacturer, brand));
        call.resolve(result);
    }

    @PluginMethod
    public void openOemKeepAliveSettings(PluginCall call) {
        String requestedBrand = call.getString("brand");
        String brand = requestedBrand != null && !requestedBrand.isEmpty()
            ? requestedBrand.toLowerCase()
            : detectOemBrand(Build.MANUFACTURER, Build.BRAND);

        boolean opened = false;
        String openedAction = "none";
        Context context = getContext();
        String pkg = context.getPackageName();

        if ("xiaomi".equals(brand)) {
            // 小米 / 红米 (MIUI / HyperOS)
            opened = tryStart(new Intent("miui.intent.action.OP_AUTO_START").addCategory(Intent.CATEGORY_DEFAULT).putExtra("extra_pkgname", pkg))
                  || tryStart(new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")).putExtra("extra_pkgname", pkg))
                  || tryStart(new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.permissions.PermissionsEditorActivity")).putExtra("extra_pkgname", pkg));
            openedAction = opened ? "xiaomi_autostart" : "none";
        } else if ("huawei".equals(brand)) {
            // 华为 / 荣耀 (HarmonyOS / EMUI)
            opened = tryStart(new Intent().setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")).putExtra("package_name", pkg))
                  || tryStart(new Intent().setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.bootstart.BootStartActivity")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity")));
            openedAction = opened ? "huawei_startup" : "none";
        } else if ("oppo".equals(brand)) {
            // OPPO / 一加 / realme (ColorOS)
            opened = tryStart(new Intent().setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.oplus.safecenter", "com.oplus.safecenter.permission.startup.StartupAppListActivity")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.singlepage.PermissionSinglePageActivity")).putExtra("package_name", pkg));
            openedAction = opened ? "oppo_startup" : "none";
        } else if ("vivo".equals(brand)) {
            // vivo / iQOO (OriginOS / FuntouchOS)
            opened = tryStart(new Intent().setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.SoftPermissionDetailActivity")).putExtra("packagename", pkg))
                  || tryStart(new Intent().setComponent(new ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.PurviewTabActivity")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")))
                  || tryStart(new Intent().setComponent(new ComponentName("com.iqoo.secure", "com.iqoo.secure.MainGuideActivity")));
            openedAction = opened ? "vivo_permission" : "none";
        }

        // 兜底：未匹配到或品牌专属界面启动失败时打开应用详情设置页
        if (!opened) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.fromParts("package", pkg, null))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                opened = true;
                openedAction = "app_details_fallback";
            } catch (Throwable ignored) {
                opened = false;
            }
        }

        JSObject result = new JSObject();
        result.put("success", opened);
        result.put("brand", brand);
        result.put("openedAction", openedAction);
        call.resolve(result);
    }

    private boolean tryStart(Intent intent) {
        if (intent == null) return false;
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static String detectOemBrand(String manufacturer, String brand) {
        String m = (manufacturer != null ? manufacturer : "").toLowerCase();
        String b = (brand != null ? brand : "").toLowerCase();
        if (m.contains("xiaomi") || m.contains("redmi") || b.contains("xiaomi") || b.contains("redmi")) {
            return "xiaomi";
        }
        if (m.contains("huawei") || m.contains("honor") || b.contains("huawei") || b.contains("honor")) {
            return "huawei";
        }
        if (m.contains("oppo") || m.contains("oneplus") || m.contains("realme") || b.contains("oppo") || b.contains("oneplus") || b.contains("realme")) {
            return "oppo";
        }
        if (m.contains("vivo") || m.contains("iqoo") || b.contains("vivo") || b.contains("iqoo")) {
            return "vivo";
        }
        return "generic";
    }

    private static boolean isIgnoring(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
    }
}
