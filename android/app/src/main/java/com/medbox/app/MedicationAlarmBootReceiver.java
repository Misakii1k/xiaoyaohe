package com.medbox.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * AlarmManager entries are wiped on reboot / package replace.
 * Restore future medication alarms from SharedPreferences payloads,
 * and restart the keep-alive foreground service so background work continues.
 */
public final class MedicationAlarmBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || Intent.ACTION_TIME_CHANGED.equals(action)
            || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            MedicationAlarmContract.restoreScheduled(context);
            startKeepAlive(context);
        }
    }

    private void startKeepAlive(Context context) {
        try {
            Intent service = new Intent(context, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
        } catch (Throwable ignored) {
            /* 受限启动不影响提醒本身 */
        }
    }
}
