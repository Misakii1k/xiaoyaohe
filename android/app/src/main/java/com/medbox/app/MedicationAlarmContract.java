package com.medbox.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

final class MedicationAlarmContract {
    static final String ACTION_ALARM = "com.medbox.app.MEDICATION_ALARM";
    static final String ACTION_TAKEN = "com.medbox.app.MEDICATION_TAKEN";
    static final String ACTION_SNOOZE = "com.medbox.app.MEDICATION_SNOOZE";
    static final String ACTION_SKIP = "com.medbox.app.MEDICATION_SKIP";
    static final String EXTRA_PAYLOAD = "payload";
    static final String CHANNEL_STRONG = "medication_strong_v2";
    static final String CHANNEL_ALARM = "medication_alarm_v1";

    private static final String PREFS = "medication_alarm_v1";
    private static final String IDS = "scheduled_ids";
    private static final String ACTIONS = "pending_actions";

    private MedicationAlarmContract() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        Uri sound = Settings.System.DEFAULT_ALARM_ALERT_URI;
        AudioAttributes audio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        NotificationChannel strong = new NotificationChannel(
            CHANNEL_STRONG, "用药增强提醒", NotificationManager.IMPORTANCE_HIGH
        );
        strong.setDescription("高优先级用药通知、声音和振动");
        strong.enableVibration(true);
        strong.setVibrationPattern(new long[]{0, 500, 250, 500});
        strong.setSound(sound, audio);
        strong.enableLights(true);
        strong.setLightColor(Color.rgb(23, 116, 91));
        strong.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

        NotificationChannel alarm = new NotificationChannel(
            CHANNEL_ALARM, "用药全屏提醒", NotificationManager.IMPORTANCE_HIGH
        );
        alarm.setDescription("需要立即处理的全屏用药提醒");
        alarm.enableVibration(true);
        alarm.setVibrationPattern(new long[]{0, 700, 250, 700, 250, 700});
        alarm.setSound(sound, audio);
        alarm.enableLights(true);
        alarm.setLightColor(Color.rgb(23, 116, 91));
        alarm.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(strong);
        manager.createNotificationChannel(alarm);
    }

    static boolean canUseFullScreen(Context context) {
        if (Build.VERSION.SDK_INT < 34) return true;
        return context.getSystemService(NotificationManager.class).canUseFullScreenIntent();
    }

    static void schedule(Context context, JSONObject payload) throws JSONException {
        int id = payload.getInt("id");
        long at = payload.getLong("at");
        Intent intent = new Intent(context, MedicationAlarmReceiver.class)
            .setAction(ACTION_ALARM)
            .putExtra(EXTRA_PAYLOAD, payload.toString());
        PendingIntent pending = PendingIntent.getBroadcast(
            context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        } else {
            manager.setExact(AlarmManager.RTC_WAKEUP, at, pending);
        }
        SharedPreferences prefs = prefs(context);
        Set<String> ids = new HashSet<>(prefs.getStringSet(IDS, new HashSet<>()));
        ids.add(String.valueOf(id));
        prefs.edit().putStringSet(IDS, ids).putString("payload_" + id, payload.toString()).apply();
    }

    static void cancelAll(Context context) {
        SharedPreferences prefs = prefs(context);
        Set<String> ids = new HashSet<>(prefs.getStringSet(IDS, new HashSet<>()));
        for (String raw : ids) cancelId(context, raw);
        prefs.edit().remove(IDS).apply();
    }

    /** Re-register future alarms after reboot / package replace (AlarmManager is wiped). */
    static int restoreScheduled(Context context) {
        SharedPreferences prefs = prefs(context);
        Set<String> ids = new HashSet<>(prefs.getStringSet(IDS, new HashSet<>()));
        int restored = 0;
        long now = System.currentTimeMillis();
        for (String raw : ids) {
            String saved = prefs.getString("payload_" + raw, null);
            if (saved == null) {
                cancelId(context, raw);
                continue;
            }
            try {
                JSONObject payload = new JSONObject(saved);
                long at = payload.optLong("at", 0L);
                if (at <= now) {
                    // Past due: fire once, then drop the stale alarm id so reboot loops don't re-spam.
                    showNotification(context, payload);
                    cancelId(context, raw);
                    Set<String> remaining = new HashSet<>(prefs.getStringSet(IDS, new HashSet<>()));
                    remaining.remove(raw);
                    prefs.edit().putStringSet(IDS, remaining).apply();
                    continue;
                }
                schedule(context, payload);
                restored += 1;
            } catch (JSONException ignored) {
                cancelId(context, raw);
            }
        }
        return restored;
    }

    static void cancelTag(Context context, String tag) {
        SharedPreferences prefs = prefs(context);
        Set<String> ids = new HashSet<>(prefs.getStringSet(IDS, new HashSet<>()));
        Set<String> remaining = new HashSet<>(ids);
        for (String raw : ids) {
            String saved = prefs.getString("payload_" + raw, null);
            try {
                if (saved != null && tag.equals(new JSONObject(saved).optString("tag"))) {
                    cancelId(context, raw);
                    remaining.remove(raw);
                }
            } catch (JSONException ignored) {}
        }
        prefs.edit().putStringSet(IDS, remaining).apply();
    }

    private static void cancelId(Context context, String raw) {
        try {
            int id = Integer.parseInt(raw);
            Intent intent = new Intent(context, MedicationAlarmReceiver.class).setAction(ACTION_ALARM);
            PendingIntent pending = PendingIntent.getBroadcast(
                context, id, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
            );
            if (pending != null) {
                ((AlarmManager) context.getSystemService(Context.ALARM_SERVICE)).cancel(pending);
                pending.cancel();
            }
            prefs(context).edit().remove("payload_" + id).apply();
        } catch (NumberFormatException ignored) {}
    }

    static void showNotification(Context context, JSONObject payload) throws JSONException {
        ensureChannels(context);
        int id = payload.getInt("id");
        String mode = payload.optString("mode", "strong");
        boolean wantsFullScreen = !"strong".equals(mode);
        boolean fullScreen = wantsFullScreen && canUseFullScreen(context);
        Intent open = new Intent(context, MedicationAlarmActivity.class)
            .putExtra(EXTRA_PAYLOAD, payload.toString())
            .addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_NO_USER_ACTION
            );
        PendingIntent openPending = PendingIntent.getActivity(
            context, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        // 增强通知也走高优先级 + 锁屏公开；全屏模式额外挂 fullScreenIntent。
        String channel = wantsFullScreen ? CHANNEL_ALARM : CHANNEL_STRONG;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_medbox)
            .setColor(Color.rgb(23, 116, 91))
            .setContentTitle(payload.optString("title", "该吃药了"))
            .setContentText(payload.optString("body", "请按医嘱服药"))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(payload.optString("body")))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPending)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setOnlyAlertOnce(false)
            .setAutoCancel(false)
            .setOngoing("fullscreen-persistent".equals(mode))
            .addAction(0, "已服用", actionPending(context, payload, ACTION_TAKEN, id + 11))
            .addAction(0, "10 分钟后提醒", actionPending(context, payload, ACTION_SNOOZE, id + 12))
            .addAction(0, "跳过", actionPending(context, payload, ACTION_SKIP, id + 13));
        if (fullScreen) {
            builder.setFullScreenIntent(openPending, true);
        } else if (wantsFullScreen) {
            // 无全屏权限时仍尽量弹出 Activity（部分机型允许从高优先级通知唤起）。
            try {
                context.startActivity(open);
            } catch (Throwable ignored) {
                // Fall back to heads-up notification only.
            }
        }
        context.getSystemService(NotificationManager.class).notify(id, builder.build());
        // 强提醒（非全屏）路径补一次显式振动：部分机型会抑制通道配置的振动，
        // 这里像全屏 Activity 那样主动调 Vibrator，确保用户一定感受到。
        if (!wantsFullScreen) {
            vibrateStrong(context);
        }
    }

    /** strong 模式触发时显式振动 ~1.5 秒后停，不依赖通道配置被 OS 尊重。 */
    private static void vibrateStrong(Context context) {
        try {
            Vibrator vibrator;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vm == null ? null : vm.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            }
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] pattern = {0, 400, 200, 400};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1));
            } else {
                vibrator.vibrate(pattern, -1);
            }
        } catch (Throwable ignored) {
            // 振动不可用时不影响通知本身
        }
    }

    private static PendingIntent actionPending(Context context, JSONObject payload, String action, int requestCode) {
        Intent intent = new Intent(context, MedicationAlarmReceiver.class)
            .setAction(action)
            .putExtra(EXTRA_PAYLOAD, payload.toString());
        return PendingIntent.getBroadcast(
            context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    static void handleAction(Context context, String action, JSONObject payload) throws JSONException {
        int id = payload.getInt("id");
        context.getSystemService(NotificationManager.class).cancel(id);
        if (ACTION_SNOOZE.equals(action)) {
            payload.put("at", System.currentTimeMillis() + 10 * 60_000L);
            payload.put("key", "snooze-" + System.currentTimeMillis());
            schedule(context, payload);
            return;
        }
        String actionId = ACTION_TAKEN.equals(action) ? "taken" : "skip";
        queueAction(context, actionId, payload);
        Intent open = new Intent(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(open);
    }

    static void queueAction(Context context, String actionId, JSONObject payload) {
        SharedPreferences prefs = prefs(context);
        try {
            JSONArray actions = new JSONArray(prefs.getString(ACTIONS, "[]"));
            JSONObject item = new JSONObject();
            item.put("actionId", actionId);
            item.put("tag", payload.optString("tag"));
            item.put("data", payload.optJSONObject("data") != null ? payload.optJSONObject("data") : new JSONObject());
            actions.put(item);
            while (actions.length() > 20) actions.remove(0);
            prefs.edit().putString(ACTIONS, actions.toString()).apply();
        } catch (JSONException ignored) {}
    }

    static JSONArray takeActions(Context context) {
        SharedPreferences prefs = prefs(context);
        String raw = prefs.getString(ACTIONS, "[]");
        prefs.edit().remove(ACTIONS).apply();
        try { return new JSONArray(raw); } catch (JSONException ignored) { return new JSONArray(); }
    }

    static JSONObject payloadFrom(Intent intent) throws JSONException {
        String raw = intent.getStringExtra(EXTRA_PAYLOAD);
        if (raw == null) throw new JSONException("Missing reminder payload");
        return new JSONObject(raw);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
