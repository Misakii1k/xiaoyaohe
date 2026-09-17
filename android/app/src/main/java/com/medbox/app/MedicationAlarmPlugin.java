package com.medbox.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "MedicationAlarm")
public final class MedicationAlarmPlugin extends Plugin {
    @Override
    public void load() {
        MedicationAlarmContract.ensureChannels(getContext());
    }

    @PluginMethod
    public void reconcile(PluginCall call) {
        JSArray values = call.getArray("notifications", new JSArray());
        MedicationAlarmContract.cancelAll(getContext());
        int scheduled = 0;
        try {
            JSONArray array = values;
            for (int index = 0; index < array.length(); index++) {
                JSONObject value = array.getJSONObject(index);
                MedicationAlarmContract.schedule(getContext(), value);
                scheduled += 1;
            }
            JSObject result = new JSObject();
            result.put("scheduled", scheduled);
            call.resolve(result);
        } catch (JSONException error) {
            call.reject("Invalid medication alarm payload", "INVALID_PAYLOAD");
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String tag = call.getString("tag");
        if (tag == null) {
            call.reject("tag is required", "INVALID_ARGUMENT");
            return;
        }
        MedicationAlarmContract.cancelTag(getContext(), tag);
        call.resolve();
    }

    @PluginMethod
    public void checkFullScreenPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean fullScreen = MedicationAlarmContract.canUseFullScreen(getContext());
        boolean overlay = MedicationAlarmContract.canDrawOverlays(getContext());
        result.put("capability", fullScreen ? "granted" : "denied");
        result.put("overlayCapability", overlay ? "granted" : "denied");
        result.put("canDrawOverlays", overlay);
        call.resolve(result);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        boolean opened = false;
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                opened = true;
            } catch (Throwable ignored) {}
        }
        if (!opened) {
            try {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                opened = true;
            } catch (Throwable ignored) {}
        }
        if (!opened) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Throwable ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void checkOverlayPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean overlay = MedicationAlarmContract.canDrawOverlays(getContext());
        result.put("capability", overlay ? "granted" : "denied");
        result.put("granted", overlay);
        call.resolve(result);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
                    .setData(Uri.parse("package:" + getContext().getPackageName()))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            } catch (Throwable ignored) {
                try {
                    Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                        .setData(Uri.parse("package:" + getContext().getPackageName()))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(fallback);
                } catch (Throwable ignored2) {}
            }
        }
        call.resolve();
    }

    /** Fire a test strong/full-screen alarm immediately (settings page). */
    @PluginMethod
    public void fireNow(PluginCall call) {
        String mode = call.getString("mode", "fullscreen-short");
        String title = call.getString("title", "测试用药提醒");
        String body = call.getString("body", "这是一条全屏/锁屏测试提醒");
        boolean scanVerify = call.getBoolean("scanVerify", false);
        String scanToken = call.getString("scanToken", "");
        boolean slideUnlock = call.getBoolean("slideUnlock", true);
        try {
            JSONObject payload = new JSONObject();
            int id = Math.abs(("medbox-test-" + mode).hashCode()) | 1;
            payload.put("id", id);
            payload.put("at", System.currentTimeMillis());
            payload.put("title", title);
            payload.put("body", body);
            payload.put("tag", "medbox-test");
            payload.put("key", "test");
            payload.put("mode", mode);
            payload.put("slideUnlock", slideUnlock);
            payload.put("testAlarm", true);
            JSONObject data = new JSONObject();
            data.put("reminderMode", mode);
            data.put("medicationName", "测试药");
            data.put("medicationDose", "1 片");
            data.put("slideUnlock", slideUnlock);
            data.put("testAlarm", true);
            if (scanVerify && scanToken != null && !scanToken.isEmpty()) {
                data.put("scanVerify", true);
                data.put("scanToken", scanToken);
                payload.put("scanVerify", true);
                payload.put("scanToken", scanToken);
            }
            payload.put("data", data);
            MedicationAlarmContract.showNotification(getContext(), payload);
            call.resolve();
        } catch (JSONException error) {
            call.reject("Unable to fire test alarm", "INVALID_PAYLOAD");
        }
    }

    @PluginMethod
    public void getPendingActions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("actions", MedicationAlarmContract.getPendingActions(getContext()));
        call.resolve(result);
    }

    /** 非破坏性确认：只移除已处理成功的 action（防丢），未确认项保留待下次重放。 */
    @PluginMethod
    public void acknowledgeActions(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        MedicationAlarmContract.acknowledgeActions(getContext(), ids);
        call.resolve();
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        String tag = call.getString("tag");
        JSONObject data = call.getObject("data", new JSObject());
        Integer minutes = call.getInt("minutes", 10);
        if (tag == null) {
            call.reject("tag is required", "INVALID_ARGUMENT");
            return;
        }
        try {
            JSONObject payload = MedicationAlarmContract.buildSnoozePayload(
                data, tag, System.currentTimeMillis() + Math.max(1, minutes) * 60_000L
            );
            MedicationAlarmContract.schedule(getContext(), payload);
            call.resolve();
        } catch (JSONException error) {
            call.reject("Unable to schedule snooze", "INVALID_PAYLOAD");
        }
    }

    @PluginMethod
    public void isAccessibilityServiceEnabled(PluginCall call) {
        JSObject result = new JSObject();
        boolean enabled = MedboxAccessibilityService.isAccessibilityEnabled(getContext());
        result.put("enabled", enabled);
        call.resolve(result);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Throwable t) {
            call.reject("无法打开系统无障碍设置", "ACCESSIBILITY_ERROR");
        }
    }

    @PluginMethod
    public void getRingtonePreference(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences("medication_alarm_v1", Context.MODE_PRIVATE);
        String ringtone = prefs.getString("alarm_ringtone", "morning_energy");
        JSObject result = new JSObject();
        result.put("ringtone", ringtone != null ? ringtone : "morning_energy");
        call.resolve(result);
    }

    @PluginMethod
    public void setRingtonePreference(PluginCall call) {
        String ringtone = call.getString("ringtone", "morning_energy");
        if (ringtone == null || (!ringtone.equals("morning_energy") && !ringtone.equals("system"))) {
            ringtone = "morning_energy";
        }
        SharedPreferences prefs = getContext().getSharedPreferences("medication_alarm_v1", Context.MODE_PRIVATE);
        prefs.edit().putString("alarm_ringtone", ringtone).apply();
        JSObject result = new JSObject();
        result.put("ringtone", ringtone);
        result.put("success", true);
        call.resolve(result);
    }
}
