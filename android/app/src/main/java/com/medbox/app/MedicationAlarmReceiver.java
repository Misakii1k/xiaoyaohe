package com.medbox.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONException;
import org.json.JSONObject;

public final class MedicationAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            JSONObject payload = MedicationAlarmContract.payloadFrom(intent);
            if (MedicationAlarmContract.ACTION_ALARM.equals(intent.getAction())) {
                MedicationAlarmContract.showNotification(context, payload);
            } else {
                MedicationAlarmContract.handleAction(context, intent.getAction(), payload);
            }
        } catch (JSONException ignored) {
            // Invalid alarm payloads are dropped instead of crashing the app process.
        }
    }
}
