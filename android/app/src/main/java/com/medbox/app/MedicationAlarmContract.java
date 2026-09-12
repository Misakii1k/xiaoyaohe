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
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

final class MedicationAlarmContract {
    static final String ACTION_ALARM = "com.medbox.app.MEDICATION_ALARM";
    static final String ACTION_TAKEN = "com.medbox.app.MEDICATION_TAKEN";
    static final String ACTION_SNOOZE = "com.medbox.app.MEDICATION_SNOOZE";
    static final String ACTION_SKIP = "com.medbox.app.MEDICATION_SKIP";
    static final String ACTION_ALL_TAKEN = "com.medbox.app.MEDICATION_ALL_TAKEN";
    static final String ACTION_ALL_SKIPPED = "com.medbox.app.MEDICATION_ALL_SKIPPED";
    static final String ACTION_FINISH_ALL_ALARMS = "com.medbox.app.ACTION_FINISH_ALL_ALARMS";
    public static final String TOKEN_PREFIX = "medbox-unlock:";
    static final String EXTRA_PAYLOAD = "payload";
    static final String CHANNEL_STRONG = "medication_strong_v3";
    static final String CHANNEL_ALARM = "medication_alarm_v2";

    private static final String PREFS = "medication_alarm_v1";
    private static final String IDS = "scheduled_ids";
    private static final String ACTIONS = "pending_actions";

    private MedicationAlarmContract() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        // 清理老版本带系统提示音的旧渠道，避免通知声音与 AlarmAudioPlayer 专属音乐冲突混杂
        try {
            manager.deleteNotificationChannel("medication_strong_v2");
            manager.deleteNotificationChannel("medication_alarm_v1");
        } catch (Throwable ignored) {}

        NotificationChannel strong = new NotificationChannel(
            CHANNEL_STRONG, "用药增强提醒", NotificationManager.IMPORTANCE_HIGH
        );
        strong.setDescription("高优先级用药通知与振动（声音由专属闹钟引擎管理）");
        strong.enableVibration(true);
        strong.setVibrationPattern(new long[]{0, 500, 250, 500});
        // 关键：通知渠道彻底静音，避免 Android 系统自动播放系统提示音
        strong.setSound(null, null);
        strong.enableLights(true);
        strong.setLightColor(Color.rgb(23, 116, 91));
        strong.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

        NotificationChannel alarm = new NotificationChannel(
            CHANNEL_ALARM, "用药全屏提醒", NotificationManager.IMPORTANCE_HIGH
        );
        alarm.setDescription("需要立即处理的全屏用药提醒（声音由专属闹钟引擎管理）");
        alarm.enableVibration(true);
        alarm.setVibrationPattern(new long[]{0, 700, 250, 700, 250, 700});
        // 关键：全屏通知渠道彻底静音
        alarm.setSound(null, null);
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

    static boolean canDrawOverlays(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(context);
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
        // 优先使用 setAlarmClock 调度：
        // setAlarmClock 在 Android 5.0+ 始终精确执行，不受 Doze 深度休眠延迟，
        // 且在触发时由系统授予官方后台启动 Activity 豁免（BAL exemption），
        // 是亮屏使用其他 App 时能够全屏弹出的核心系统基础。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Intent clockOpen = new Intent(context, MedicationAlarmActivity.class)
                .putExtra(EXTRA_PAYLOAD, payload.toString())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent clockPending = PendingIntent.getActivity(
                context, id + 0x10000, clockOpen,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            manager.setAlarmClock(new AlarmManager.AlarmClockInfo(at, clockPending), pending);
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
        // 0.9.13：所有提醒到点一律自动全屏接管（前台任意页面 / 后台 / 锁屏 / 灭屏），
        // 通知只作为全屏页拉起被系统拦截时的兜底入口。
        // mode 不再区分是否全屏，只决定全屏页的自动收起策略
        // （strong 不自动收起、fullscreen-persistent 60s、fullscreen-short 10s）。
        boolean requireScan = requiresScanVerification(payload);
        boolean fullScreen = canUseFullScreen(context);
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
        // 全屏路径走 CHANNEL_ALARM（更长的振动模式）；仅当全屏意图权限被拒时
        // 降级回 CHANNEL_STRONG 的 heads-up 通知（仍带操作按钮可正常处理）。
        String channel = fullScreen ? CHANNEL_ALARM : CHANNEL_STRONG;
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
            .setSound(null)
            .setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
            .setOnlyAlertOnce(false)
            .setAutoCancel(false)
            // 常驻：下拉里不能被随手划掉，必须经全屏页或按钮完成操作
            .setOngoing(true);
        if (!requireScan) {
            if (isGroupPayload(payload)) {
                // 组载荷：通知按钮只提供整体操作。「全部已服用」→ all-taken（TS 侧一次批量记录）；
                // 组级 skip 没有 occurrenceId 无法解析，省略；单药 taken/skip 由全屏页每行按钮处理。
                builder.addAction(0, "全部已服用", actionPending(context, payload, ACTION_ALL_TAKEN, id + 11))
                    .addAction(0, "10 分钟后提醒", actionPending(context, payload, ACTION_SNOOZE, id + 12));
            } else {
                builder.addAction(0, "已服用", actionPending(context, payload, ACTION_TAKEN, id + 11))
                    .addAction(0, "10 分钟后提醒", actionPending(context, payload, ACTION_SNOOZE, id + 12))
                    .addAction(0, "跳过", actionPending(context, payload, ACTION_SKIP, id + 13));
            }
        }
        // requireScan 时通知不带任何动作按钮：从通知点动作可绕过全屏页扫码，
        // 一切操作都必须进全屏页、扫码解锁后才出现。
        // 无论系统当前权限如何，始终绑定全屏意图与最高优先级通知
        builder.setFullScreenIntent(openPending, true);

        // ── 临时点亮屏幕与唤醒 CPU ──
        try {
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                android.os.PowerManager.WakeLock wakeLock = pm.newWakeLock(
                    android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                        | android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP
                        | android.os.PowerManager.ON_AFTER_RELEASE,
                    "medbox:alarm_wake"
                );
                wakeLock.acquire(8_000L); // 保持 8 秒唤醒
            }
        } catch (Throwable ignored) {}

        // ── 到点立即启动音频播放引擎（独占 STREAM_ALARM 闹钟流）──
        // 即使 Activity 弹窗因权限拦截或系统延迟，声音也能准时在后台响起，杜绝漏药
        try {
            AlarmAudioPlayer.start(context);
        } catch (Throwable ignored) {}

        // ── 时序关键：先发通知唤起系统全屏意图 ──
        context.getSystemService(NotificationManager.class).notify(id, builder.build());

        // ── 多重路径拉起全屏 Activity ──
        boolean started = false;
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                android.app.ActivityOptions options = android.app.ActivityOptions.makeBasic();
                try {
                    options.setPendingIntentBackgroundActivityStartMode(
                        android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
                    );
                } catch (Throwable ignored) {}
                try {
                    openPending.send(context, 0, null, null, null, null, options.toBundle());
                    started = true;
                } catch (Throwable sendFailed) {
                    context.startActivity(open, options.toBundle());
                    started = true;
                }
            } else {
                context.startActivity(open);
                started = true;
            }
        } catch (Throwable directFailed) {
            // 直接拉起被系统拦截
        }

        // 前台服务坚固兜底：亮屏使用其他应用或后台启动受限时再拉一次
        try {
            AlarmRingService.launch(context, payload.toString());
        } catch (Throwable ignored) {}
    }

    /**
     * 该提醒是否要求「扫指定二维码才能解除」（防止睡迷糊时随手关掉）。
     * 开启时通知不提供任何动作按钮（按钮可绕过全屏页），一切操作必须经扫码解锁后的页面完成。
     * 顶层与 data 双写：贪睡重建（buildSnoozePayload 只透传 data）后仍能找回标记。
     */
    static boolean requiresScanVerification(JSONObject payload) {
        if (payload.optBoolean("scanVerify", false) && !payload.optString("scanToken").isEmpty()) {
            return true;
        }
        JSONObject data = payload.optJSONObject("data");
        return data != null
            && data.optBoolean("scanVerify", false)
            && !data.optString("scanToken").isEmpty();
    }

    /** 解锁码完整内容（顶层优先，data 兜底）。 */
    static String scanTokenOf(JSONObject payload) {
        String top = payload.optString("scanToken");
        if (!top.isEmpty()) return top;
        JSONObject data = payload.optJSONObject("data");
        return data == null ? "" : data.optString("scanToken");
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
        AlarmAudioPlayer.stop();
        int id = payload.getInt("id");
        context.getSystemService(NotificationManager.class).cancel(id);
        if (ACTION_SNOOZE.equals(action)) {
            payload.put("at", System.currentTimeMillis() + 10 * 60_000L);
            payload.put("key", "snooze-" + System.currentTimeMillis());
            schedule(context, payload);
            return;
        }
        String actionId;
        if (ACTION_ALL_TAKEN.equals(action)) {
            actionId = "all-taken";
        } else if (ACTION_ALL_SKIPPED.equals(action)) {
            actionId = "all-skipped";
        } else if (ACTION_TAKEN.equals(action)) {
            actionId = "taken";
        } else {
            actionId = "skip";
        }
        queueAction(context, actionId, payload);
    }

    static void queueAction(Context context, String actionId, JSONObject payload) {
        SharedPreferences prefs = prefs(context);
        try {
            JSONArray actions = new JSONArray(prefs.getString(ACTIONS, "[]"));
            JSONObject item = new JSONObject();
            item.put("id", nextActionId(context));
            item.put("actionId", actionId);
            item.put("tag", payload.optString("tag"));
            item.put("data", payload.optJSONObject("data") != null ? payload.optJSONObject("data") : new JSONObject());
            actions.put(item);
            while (actions.length() > 20) actions.remove(0);
            prefs.edit().putString(ACTIONS, actions.toString()).apply();
        } catch (JSONException ignored) {}
    }

    /** 单调递增 action id：TS 侧处理后按 id 精确 acknowledge，避免重放时重复确认。 */
    private static String nextActionId(Context context) {
        SharedPreferences prefs = prefs(context);
        long seq = prefs.getLong("ack_seq", 0L) + 1L;
        prefs.edit().putLong("ack_seq", seq).apply();
        return "ack-" + seq;
    }

    /** 非破坏性读取：只读出待处理 action，不删除——处理成功后由 acknowledgeActions 按 id 移除（防丢）。 */
    static JSONArray getPendingActions(Context context) {
        SharedPreferences prefs = prefs(context);
        try { return new JSONArray(prefs.getString(ACTIONS, "[]")); } catch (JSONException ignored) { return new JSONArray(); }
    }

    /** 只移除已确认成功的 action id；未确认项保留待下次重放（含遗留无 id 项，靠 TS 幂等无害）。 */
    static void acknowledgeActions(Context context, JSONArray ids) {
        if (ids == null || ids.length() == 0) return;
        SharedPreferences prefs = prefs(context);
        try {
            JSONArray actions = new JSONArray(prefs.getString(ACTIONS, "[]"));
            prefs.edit().putString(ACTIONS, filterActions(actions, ids).toString()).apply();
        } catch (JSONException ignored) {}
    }

    /** 纯逻辑：保留 id 不在已确认集合中的项；遗留无 id 项永不匹配 → 每次启动重放（靠 TS 幂等无害）。 */
    static JSONArray filterActions(JSONArray actions, JSONArray ids) throws JSONException {
        Set<String> acknowledged = new HashSet<>();
        for (int index = 0; index < ids.length(); index++) acknowledged.add(ids.optString(index));
        JSONArray remaining = new JSONArray();
        for (int index = 0; index < actions.length(); index++) {
            JSONObject item = actions.optJSONObject(index);
            if (item == null || !acknowledged.contains(item.optString("id"))) {
                remaining.put(item != null ? item : JSONObject.NULL);
            }
        }
        return remaining;
    }

    /** 组载荷（V2）：data.kind == "reminder-group"。 */
    static boolean isGroupPayload(JSONObject payload) {
        JSONObject data = payload.optJSONObject("data");
        return data != null && "reminder-group".equals(data.optString("kind"));
    }

    static String slotLabel(String slot) {
        if ("morning".equals(slot)) return "早上";
        if ("noon".equals(slot)) return "中午";
        if ("evening".equals(slot)) return "晚上";
        if ("bedtime".equals(slot)) return "睡前";
        return slot == null || slot.isEmpty() ? "服药" : slot;
    }

    /** 组载荷 body：occurrences 逐行「药名 剂量」。 */
    static String buildGroupBody(JSONObject data) {
        JSONArray occurrences = data.optJSONArray("occurrences");
        if (occurrences == null || occurrences.length() == 0) return data.optString("body", "请按医嘱服药");
        StringBuilder builder = new StringBuilder();
        for (int index = 0; index < occurrences.length(); index++) {
            JSONObject occurrence = occurrences.optJSONObject(index);
            if (occurrence == null) continue;
            String name = occurrence.optString("medName");
            String dose = occurrence.optString("dose");
            if (builder.length() > 0) builder.append('\n');
            builder.append(name.isEmpty() ? "用药" : name);
            if (!dose.isEmpty()) builder.append(' ').append(dose);
        }
        return builder.toString();
    }

    /** 组载荷 title：「早上服药时间到了」；第 3 次起加「第 N 次提醒」前缀。 */
    static String buildGroupTitle(JSONObject data) {
        String base = slotLabel(data.optString("slot")) + "服药时间到了";
        int count = data.optInt("reminderCount", 1);
        return count >= 3 ? "第 " + count + " 次提醒 · " + base : base;
    }

    /** snooze 重建：组载荷按组重建 title/body/mode 并沿用组 tag；遗留载荷保持旧格式。 */
    static JSONObject buildSnoozePayload(JSONObject data, String tag, long at) throws JSONException {
        boolean group = data != null && "reminder-group".equals(data.optString("kind"));
        JSONObject payload = new JSONObject();
        payload.put("id", Math.abs((tag + ":snooze").hashCode()) | 1);
        payload.put("at", at);
        payload.put("tag", tag);
        payload.put("key", "snooze");
        if (group) {
            payload.put("title", buildGroupTitle(data));
            payload.put("body", buildGroupBody(data));
            payload.put("mode", data.optString("mode", "strong"));
            payload.put("data", data);
        } else {
            payload.put("title", "⏰ 该吃药了");
            payload.put("body", (data == null ? "用药提醒" : data.optString("medicationName", "用药提醒")) + " · 稍后提醒");
            payload.put("mode", data == null ? "strong" : data.optString("reminderMode", "strong"));
            payload.put("data", data != null ? data : new JSONObject());
        }
        return payload;
    }

    /** 全屏页单药行按钮：克隆载荷并向 data 注入 occurrenceId 后入队，保证 TS 侧能解析到具体 occurrence。 */
    static void queueOccurrenceAction(Context context, String action, JSONObject payload, String occurrenceId) {
        AlarmAudioPlayer.stop();
        // 通知/全屏页按钮走 Java action 常量，入队时归一化成 TS 侧识别的 actionId
        String actionId = ACTION_SKIP.equals(action) ? "skip" : "taken";
        try {
            JSONObject itemPayload = new JSONObject(payload.toString());
            JSONObject data = itemPayload.optJSONObject("data");
            if (data == null) data = new JSONObject();
            data.put("occurrenceId", occurrenceId);
            itemPayload.put("data", data);
            queueAction(context, actionId, itemPayload);
        } catch (JSONException ignored) {}
    }

    static JSONObject payloadFrom(Intent intent) throws JSONException {
        if (intent == null) throw new JSONException("Intent is null");
        String raw = intent.getStringExtra(EXTRA_PAYLOAD);
        if (raw == null || raw.trim().isEmpty()) throw new JSONException("Missing reminder payload");
        return new JSONObject(raw);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** 标准化条码内容，去除 BOM、换行符、控制符及常见 AIM 标识前缀 */
    public static String normalizeScanToken(String token) {
        if (token == null) return "";
        String s = token.trim()
            .replace("\r", "")
            .replace("\n", "")
            .replace("\t", "")
            .replace("\uFEFF", "")
            .replace("\u001D", "")
            .replace("\u0000", "");
        // 剥离两端可能包裹的双引号或单引号
        if (s.length() >= 2 && ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'")))) {
            s = s.substring(1, s.length() - 1).trim();
        }
        // 移除条码 AIM 标识符前缀（如 ]Q1, ]C1, ]d2, ]e0 等）
        if (s.startsWith("]") && s.length() >= 3) {
            char second = s.charAt(1);
            if ((second >= 'A' && second <= 'Z') || (second >= 'a' && second <= 'z')) {
                s = s.substring(3).trim();
            }
        }
        return s;
    }

    public static boolean isAllDigits(String s) {
        if (s == null || s.isEmpty()) return false;
        for (int i = 0; i < s.length(); i++) {
            if (!Character.isDigit(s.charAt(i))) return false;
        }
        return true;
    }

    public static String stripLeadingZeros(String s) {
        if (s == null) return "";
        String res = s.replaceFirst("^0+", "");
        return res.isEmpty() ? "0" : res;
    }

    public static String extractGtin(String s) {
        if (s == null) return null;
        String raw = s.trim();
        // (01)06901234567890 形式
        if (raw.startsWith("(01)") && raw.length() >= 18) {
            String candidate = raw.substring(4, 18);
            if (isAllDigits(candidate)) return candidate;
        }
        // 0106901234567890 形式（AI 01 紧跟 14 位 GTIN）
        if (raw.startsWith("01") && raw.length() >= 16) {
            String candidate = raw.substring(2, 16);
            if (isAllDigits(candidate)) return candidate;
        }
        // GS1 Digital Link 形式，例如 https://id.gs1.org/01/06901234567890
        int idx01 = raw.indexOf("/01/");
        if (idx01 != -1 && raw.length() >= idx01 + 4 + 14) {
            String candidate = raw.substring(idx01 + 4, idx01 + 4 + 14);
            if (isAllDigits(candidate)) return candidate;
        }
        return null;
    }

    private static boolean isCodeContainedInUrl(String url, String code) {
        if (url == null || code == null) return false;
        String trimmedCode = code.trim();
        if (trimmedCode.length() < 8) return false; // 仅对至少 8 位的有效条形码/监管码进行 URL 包含检测，杜绝误判
        // 必须形如 URL 或包含路径/参数
        if (!url.contains("://") && !url.contains("/") && !url.contains("?") && !url.contains("=")) {
            return false;
        }
        if (url.contains(trimmedCode)) return true;
        String stripped = stripLeadingZeros(trimmedCode);
        if (stripped.length() >= 8 && url.contains(stripped)) return true;
        return false;
    }

    /** 智能比对已绑定的码与扫描到的码（支持 TOKEN_PREFIX、URL 协议与结尾斜线、大小写、EAN-13/UPC-A/GTIN-14 前导零及 GS1 AI 容错） */
    public static boolean isTokenMatch(String scanned, String expected) {
        String s1 = normalizeScanToken(scanned);
        String s2 = normalizeScanToken(expected);
        if (s1.isEmpty() || s2.isEmpty()) return false;
        if (s1.equals(s2) || s1.equalsIgnoreCase(s2)) return true;

        // 1. TOKEN_PREFIX (medbox-unlock:) 容错：两边无论带不带前缀均可比对
        String lower1 = s1.toLowerCase();
        String lower2 = s2.toLowerCase();
        String noPrefix1 = lower1.startsWith(TOKEN_PREFIX) ? s1.substring(TOKEN_PREFIX.length()).trim() : s1;
        String noPrefix2 = lower2.startsWith(TOKEN_PREFIX) ? s2.substring(TOKEN_PREFIX.length()).trim() : s2;
        if (!noPrefix1.isEmpty() && noPrefix1.equalsIgnoreCase(noPrefix2)) return true;

        // 2. URL 容错：忽略末尾斜杠、www. 及协议前缀 (http vs https)
        String clean1 = s1.endsWith("/") ? s1.replaceAll("/+$", "") : s1;
        String clean2 = s2.endsWith("/") ? s2.replaceAll("/+$", "") : s2;
        if (clean1.equalsIgnoreCase(clean2)) return true;
        String noProto1 = clean1.replaceFirst("^https?://(www\\.)?", "");
        String noProto2 = clean2.replaceFirst("^https?://(www\\.)?", "");
        if (!noProto1.isEmpty() && noProto1.equalsIgnoreCase(noProto2)) return true;

        // 3. 纯数字条码容错：UPC-A (12位)、EAN-13 (13位)、GTIN-14 (14位带前导0) 剥除前导零统一比对
        if (isAllDigits(noPrefix1) && isAllDigits(noPrefix2)) {
            if (stripLeadingZeros(noPrefix1).equals(stripLeadingZeros(noPrefix2))) {
                return true;
            }
        }

        // 4. GS1 DataMatrix / GS1-128 AI(01) GTIN 提取容错
        String gtin1 = extractGtin(noPrefix1);
        String gtin2 = extractGtin(noPrefix2);
        if (gtin1 != null && isAllDigits(noPrefix2)) {
            if (stripLeadingZeros(gtin1).equals(stripLeadingZeros(noPrefix2))) return true;
        }
        if (gtin2 != null && isAllDigits(noPrefix1)) {
            if (stripLeadingZeros(gtin2).equals(stripLeadingZeros(noPrefix1))) return true;
        }
        if (gtin1 != null && gtin2 != null) {
            if (stripLeadingZeros(gtin1).equals(stripLeadingZeros(gtin2))) return true;
        }

        // 5. 药盒追溯二维码/URL 包含商品条形码或监管码容错（例如扫到药品监管 URL 中包含 20 位监管码或 13/14 位商品码）
        if (isCodeContainedInUrl(clean1, noPrefix2) || isCodeContainedInUrl(clean2, noPrefix1)) {
            return true;
        }

        return false;
    }

    /** 聚合多个活跃提醒期望的所有有效比对码 */
    public static List<String> allExpectedTokens(java.util.Collection<JSONObject> payloads) {
        List<String> tokens = new ArrayList<>();
        if (payloads == null) return tokens;
        for (JSONObject p : payloads) {
            for (String t : allExpectedTokens(p)) {
                if (!tokens.contains(t)) tokens.add(t);
            }
        }
        return tokens;
    }

    /** 聚合该提醒期望的所有有效比对码（专属解锁码 + 本次提醒包含的各药条形码/GTIN/监管码等） */
    public static List<String> allExpectedTokens(JSONObject payload) {
        List<String> tokens = new ArrayList<>();
        if (payload == null) return tokens;
        String primary = scanTokenOf(payload);
        if (!primary.isEmpty() && !tokens.contains(primary)) {
            tokens.add(primary);
        }
        JSONObject data = payload.optJSONObject("data");
        if (data != null) {
            String dataToken = data.optString("scanToken", "");
            if (!dataToken.isEmpty() && !tokens.contains(dataToken)) {
                tokens.add(dataToken);
            }
            JSONArray occurrences = data.optJSONArray("occurrences");
            if (occurrences != null) {
                for (int i = 0; i < occurrences.length(); i++) {
                    JSONObject occ = occurrences.optJSONObject(i);
                    if (occ != null) {
                        extractTokensFromObject(occ, tokens);
                    }
                }
            }
            extractTokensFromObject(data, tokens);
        }
        extractTokensFromObject(payload, tokens);
        return tokens;
    }

    private static void extractTokensFromObject(JSONObject obj, List<String> tokens) {
        if (obj == null) return;
        JSONArray barcodes = obj.optJSONArray("barcodes");
        if (barcodes != null) {
            for (int j = 0; j < barcodes.length(); j++) {
                String b = barcodes.optString(j, "").trim();
                if (!b.isEmpty() && !tokens.contains(b)) {
                    tokens.add(b);
                }
            }
        }
        String[] directKeys = new String[]{"barcode", "gtin", "rawCode", "raw_code"};
        for (String key : directKeys) {
            String v = obj.optString(key, "").trim();
            if (!v.isEmpty() && !tokens.contains(v)) {
                tokens.add(v);
            }
        }
    }

    /** 只要匹配期望码列表中的任意一个（专属码或本次服药任一药盒条码），即视为验证成功 */
    public static boolean isAnyTokenMatch(String scanned, List<String> expectedTokens) {
        if (scanned == null || expectedTokens == null || expectedTokens.isEmpty()) return false;
        for (String expected : expectedTokens) {
            if (isTokenMatch(scanned, expected)) return true;
        }
        return false;
    }

    /** 取消所有强提醒与全屏提醒相关通知，同时严格保留常驻保活服务通知 */
    public static void cancelAllAlarmNotifications(Context context) {
        if (context == null) return;
        try {
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                StatusBarNotification[] sbns = nm.getActiveNotifications();
                if (sbns != null) {
                    for (StatusBarNotification sbn : sbns) {
                        if (sbn == null) continue;
                        int notifId = sbn.getId();
                        if (notifId == KeepAliveService.NOTIF_ID) continue;
                        String channelId = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && sbn.getNotification() != null
                            ? sbn.getNotification().getChannelId()
                            : null;
                        if (CHANNEL_ALARM.equals(channelId) || CHANNEL_STRONG.equals(channelId) || notifId == AlarmRingService.NOTIF_ID) {
                            nm.cancel(sbn.getTag(), notifId);
                        }
                    }
                }
            } else {
                nm.cancel(AlarmRingService.NOTIF_ID);
            }
        } catch (Throwable ignored) {}
    }
}
