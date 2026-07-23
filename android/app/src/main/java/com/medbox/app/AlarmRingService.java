package com.medbox.app;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * 全屏提醒兜底：闹钟触发后直接 startActivity 被系统拦截时（Android 14/15
 * 后台 Activity 启动限制、OEM 深度定制），通过前台服务再拉一次全屏页面。
 * 前台服务在 Android 13- 天然拥有 Activity 启动权限，Android 14 绝大多数
 * ROM 仍放行；Android 15 作为第二层兜底（主路径靠 notify-first 的
 * fullScreenIntent 窗口）。服务在拉起 Activity 后立即自行退出。
 */
public final class AlarmRingService extends Service {

    private static final int NOTIF_ID = 0x414C; // "AL"

    static void launch(Context context, String payloadJson) {
        try {
            Intent intent = new Intent(context, AlarmRingService.class)
                .putExtra(MedicationAlarmContract.EXTRA_PAYLOAD, payloadJson);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Throwable ignored) {
            // 前台服务也无法启动时退化为顶部通知（通知已在调用方先行发出）。
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String payloadJson = intent == null ? null
            : intent.getStringExtra(MedicationAlarmContract.EXTRA_PAYLOAD);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, buildNotification(payloadJson),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, buildNotification(payloadJson));
        }
        if (payloadJson != null) {
            try {
                Intent open = new Intent(this, MedicationAlarmActivity.class)
                    .putExtra(MedicationAlarmContract.EXTRA_PAYLOAD, payloadJson)
                    .addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_CLEAR_TOP
                            | Intent.FLAG_ACTIVITY_NO_USER_ACTION
                    );
                startActivity(open);
            } catch (Throwable ignored) {
                // 所有路径均被拦截：通知已发出，heads-up + 铃声振动仍然生效。
            }
        }
        stopSelf();
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String payloadJson) {
        MedicationAlarmContract.ensureChannels(this);
        String title = "该吃药了";
        try {
            if (payloadJson != null) {
                title = new JSONObject(payloadJson).optString("title", title);
            }
        } catch (JSONException ignored) {}
        return new NotificationCompat.Builder(this, MedicationAlarmContract.CHANNEL_ALARM)
            .setSmallIcon(R.drawable.ic_stat_medbox)
            .setColor(Color.rgb(23, 116, 91))
            .setContentTitle(title)
            .setContentText("点击处理用药提醒")
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setOngoing(true)
            .build();
    }
}
