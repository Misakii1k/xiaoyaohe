package com.medbox.app;

import android.content.Intent;
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
        result.put("capability", MedicationAlarmContract.canUseFullScreen(getContext()) ? "granted" : "denied");
        call.resolve(result);
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 34) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT)
                .setData(Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void getPendingActions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("actions", MedicationAlarmContract.takeActions(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        String tag = call.getString("tag");
        JSObject data = call.getObject("data", new JSObject());
        Integer minutes = call.getInt("minutes", 10);
        if (tag == null) {
            call.reject("tag is required", "INVALID_ARGUMENT");
            return;
        }
        try {
            JSONObject payload = new JSONObject();
            int id = Math.abs((tag + ":snooze").hashCode()) | 1;
            payload.put("id", id);
            payload.put("at", System.currentTimeMillis() + Math.max(1, minutes) * 60_000L);
            payload.put("title", "⏰ 该吃药了");
            payload.put("body", data.getString("medicationName", "用药提醒") + " · 稍后提醒");
            payload.put("tag", tag);
            payload.put("key", "snooze");
            payload.put("mode", data.getString("reminderMode", "strong"));
            payload.put("data", data);
            MedicationAlarmContract.schedule(getContext(), payload);
            call.resolve();
        } catch (JSONException error) {
            call.reject("Unable to schedule snooze", "INVALID_PAYLOAD");
        }
    }
}
