package com.medbox.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.capacitorjs.plugins.localnotifications.LocalNotificationRestoreReceiver;

/** Re-evaluates calendar-based local notification triggers after wall-clock changes. */
public class ReminderTimeChangeReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            new LocalNotificationRestoreReceiver().onReceive(context, intent);
        }
    }
}
