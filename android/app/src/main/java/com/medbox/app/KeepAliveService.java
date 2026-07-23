package com.medbox.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * 常驻前台服务：让系统把小药盒视为前台进程，WebView 与 JS 定时器
 * （提醒 tick、局域网自动同步轮询）在切后台时仍能存活，不被轻易回收。
 * 通知用低优先级通道，无声无振动，不打扰用户。
 */
public class KeepAliveService extends Service {

    static final String CHANNEL_ID = "keep_alive_v1";
    static final int NOTIF_ID = 0x4D42; // "MB"

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIF_ID, buildNotification());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopForeground(true);
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "后台运行",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("小药盒在后台运行，保证提醒和同步不中断");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.enableLights(false);
        manager.createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        ensureChannel(this);
        Intent open = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(
            this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_medbox)
            .setContentTitle("小药盒正在后台运行")
            .setContentText("提醒与同步会持续工作")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setShowWhen(false)
            .setContentIntent(pi)
            .build();
    }
}
