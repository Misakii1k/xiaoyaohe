package com.medbox.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONException;
import org.json.JSONObject;

public final class MedicationAlarmActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Ringtone ringtone;
    private Vibrator vibrator;
    private JSONObject payload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 锁屏全屏：点亮屏幕 + 显示在锁屏之上（兼容旧 API）
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        );
        try {
            payload = MedicationAlarmContract.payloadFrom(getIntent());
            setContentView(buildContent());
            startAlert();
            long timeout = "fullscreen-persistent".equals(payload.optString("mode")) ? 60_000L : 10_000L;
            // 增强通知打开的页面不自动关闭（用户可能还在看）
            if (!"strong".equals(payload.optString("mode", "strong"))) {
                handler.postDelayed(this::finish, timeout);
            }
        } catch (JSONException error) {
            finish();
        }
    }

    private View buildContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(40), dp(28), dp(32));
        root.setBackgroundColor(Color.rgb(246, 250, 248));

        TextView eyebrow = text("用药时间到了", 18, Color.rgb(23, 116, 91), true);
        TextView title = text(payload.optString("title", "该吃药了"), 32, Color.rgb(24, 45, 38), true);
        JSONObject data = payload.optJSONObject("data");
        String dose = data == null ? "" : data.optString("medicationDose", "");
        TextView detail = text(dose.isEmpty() ? payload.optString("body") : dose, 22, Color.rgb(60, 82, 74), false);
        root.addView(eyebrow, margins(dp(8)));
        root.addView(title, margins(dp(18)));
        root.addView(detail, margins(dp(30)));

        Button taken = button("已服用", Color.rgb(23, 116, 91), Color.WHITE);
        taken.setOnClickListener(view -> act(MedicationAlarmContract.ACTION_TAKEN));
        Button snooze = button("10 分钟后提醒", Color.rgb(224, 239, 233), Color.rgb(23, 116, 91));
        snooze.setOnClickListener(view -> act(MedicationAlarmContract.ACTION_SNOOZE));
        Button skip = button("跳过本次", Color.TRANSPARENT, Color.rgb(174, 47, 55));
        skip.setOnClickListener(view -> act(MedicationAlarmContract.ACTION_SKIP));
        root.addView(taken, buttonParams());
        root.addView(snooze, buttonParams());
        root.addView(skip, buttonParams());
        return root;
    }

    private void act(String action) {
        try { MedicationAlarmContract.handleAction(this, action, payload); } catch (JSONException ignored) {}
        finish();
    }

    private void startAlert() {
        try {
            ringtone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM));
            if (ringtone != null) ringtone.play();
        } catch (Throwable ignored) {}
        try {
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            long[] pattern = new long[]{0, 700, 250, 700, 250, 700};
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
        } catch (Throwable ignored) {}
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try { if (ringtone != null && ringtone.isPlaying()) ringtone.stop(); } catch (Throwable ignored) {}
        try { if (vibrator != null) vibrator.cancel(); } catch (Throwable ignored) {}
        super.onDestroy();
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setGravity(Gravity.CENTER);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private Button button(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(18);
        button.setTextColor(foreground);
        button.setBackgroundColor(background);
        button.setMinHeight(dp(52));
        return button;
    }

    private LinearLayout.LayoutParams margins(int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = bottom;
        return params;
    }

    private LinearLayout.LayoutParams buttonParams() { return margins(dp(10)); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
