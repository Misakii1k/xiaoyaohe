package com.medbox.app;

import android.app.Activity;
import android.content.Intent;
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
import android.widget.ScrollView;
import android.widget.TextView;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class MedicationAlarmActivity extends Activity {
    private static final int GREEN = Color.rgb(23, 116, 91);
    private static final int GREEN_SOFT = Color.rgb(224, 239, 233);
    private static final int INK = Color.rgb(24, 45, 38);
    private static final int INK_SOFT = Color.rgb(60, 82, 74);
    private static final int RED = Color.rgb(174, 47, 55);
    private static final int BACKGROUND = Color.rgb(246, 250, 248);

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
            showContent();
        } catch (JSONException error) {
            finish();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        try {
            // singleTop：同实例被新的闹钟再次拉起时换载荷并重建页面。
            payload = MedicationAlarmContract.payloadFrom(intent);
            showContent();
        } catch (JSONException ignored) {}
    }

    private void showContent() {
        setContentView(buildContent());
        startAlert();
        long timeout = "fullscreen-persistent".equals(payload.optString("mode")) ? 60_000L : 10_000L;
        // 增强通知打开的页面不自动关闭（用户可能还在看）
        handler.removeCallbacksAndMessages(null);
        if (!"strong".equals(payload.optString("mode", "strong"))) {
            handler.postDelayed(this::finish, timeout);
        }
    }

    private View buildContent() {
        JSONObject data = payload.optJSONObject("data");
        if (data != null && "reminder-group".equals(data.optString("kind"))) {
            return buildGroupContent(data);
        }
        return buildLegacyContent();
    }

    private View buildLegacyContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(40), dp(28), dp(32));
        root.setBackgroundColor(BACKGROUND);

        TextView eyebrow = text("用药时间到了", 18, GREEN, true);
        TextView title = text(payload.optString("title", "该吃药了"), 32, INK, true);
        JSONObject data = payload.optJSONObject("data");
        String dose = data == null ? "" : data.optString("medicationDose", "");
        TextView detail = text(dose.isEmpty() ? payload.optString("body") : dose, 22, INK_SOFT, false);
        root.addView(eyebrow, margins(dp(8)));
        root.addView(title, margins(dp(18)));
        root.addView(detail, margins(dp(30)));

        root.addView(button("已服用", GREEN, Color.WHITE, view -> act(MedicationAlarmContract.ACTION_TAKEN)), buttonParams());
        root.addView(button("10 分钟后提醒", GREEN_SOFT, GREEN, view -> act(MedicationAlarmContract.ACTION_SNOOZE)), buttonParams());
        root.addView(button("跳过本次", Color.TRANSPARENT, RED, view -> act(MedicationAlarmContract.ACTION_SKIP)), buttonParams());
        return root;
    }

    /** 组载荷（V2）：头部时段+时间，中部每药一行的可滚动列表，底部整体操作。 */
    private View buildGroupContent(JSONObject data) {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(24));
        root.setBackgroundColor(BACKGROUND);

        TextView eyebrow = text("用药时间到了", 18, GREEN, true);
        TextView title = text(MedicationAlarmContract.buildGroupTitle(data), 26, INK, true);
        TextView time = text(
            MedicationAlarmContract.slotLabel(data.optString("slot")) + " · " + formatTime(data.optLong("dueAt", 0L)),
            18, INK_SOFT, false
        );
        root.addView(eyebrow, margins(dp(6)));
        root.addView(title, margins(dp(12)));
        root.addView(time, margins(dp(22)));

        ScrollView scroll = new ScrollView(this);
        LinearLayout rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        JSONArray occurrences = data.optJSONArray("occurrences");
        if (occurrences != null) {
            for (int index = 0; index < occurrences.length(); index++) {
                JSONObject occurrence = occurrences.optJSONObject(index);
                if (occurrence == null) continue;
                View row = buildMedicationRow(occurrence);
                if (row != null) rows.addView(row, margins(dp(12)));
            }
        }
        scroll.addView(rows);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        root.addView(button("全部已服用", GREEN, Color.WHITE, view -> act(MedicationAlarmContract.ACTION_ALL_TAKEN)), margins(dp(18)));
        root.addView(button("10 分钟后提醒", GREEN_SOFT, GREEN, view -> act(MedicationAlarmContract.ACTION_SNOOZE)), buttonParams());
        return root;
    }

    private View buildMedicationRow(JSONObject occurrence) {
        String name = occurrence.optString("medName");
        String dose = occurrence.optString("dose");
        String occurrenceId = occurrence.optString("occurrenceId");
        if (name.isEmpty() && occurrenceId.isEmpty()) return null;

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(8), dp(14), dp(8));
        row.setBackgroundColor(Color.WHITE);

        LinearLayout info = new LinearLayout(this);
        info.setOrientation(LinearLayout.VERTICAL);
        TextView nameView = text(name.isEmpty() ? "用药" : name, 20, INK, true);
        nameView.setGravity(Gravity.START);
        info.addView(nameView);
        if (!dose.isEmpty()) {
            TextView doseView = text(dose, 16, INK_SOFT, false);
            doseView.setGravity(Gravity.START);
            info.addView(doseView, margins(dp(2)));
        }
        row.addView(info, new LinearLayout.LayoutParams(0, -2, 1f));

        Button taken = smallButton("已服", GREEN, Color.WHITE);
        taken.setOnClickListener(view -> queueOccurrence(MedicationAlarmContract.ACTION_TAKEN, occurrenceId));
        Button skip = smallButton("跳过", Color.TRANSPARENT, RED);
        skip.setOnClickListener(view -> queueOccurrence(MedicationAlarmContract.ACTION_SKIP, occurrenceId));
        row.addView(taken, sideButtonParams());
        row.addView(skip, sideButtonParams());
        return row;
    }

    /** 单药行按钮：向 data 注入 occurrenceId 后入队，TS 侧据此记录到具体 occurrence。 */
    private void queueOccurrence(String action, String occurrenceId) {
        MedicationAlarmContract.queueOccurrenceAction(this, action, payload, occurrenceId);
        finish();
    }

    private String formatTime(long epochMillis) {
        return new SimpleDateFormat("HH:mm", Locale.getDefault()).format(new Date(epochMillis));
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

    private Button button(String label, int background, int foreground, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(18);
        button.setTextColor(foreground);
        button.setBackgroundColor(background);
        button.setMinHeight(dp(52));
        button.setOnClickListener(listener);
        return button;
    }

    private Button smallButton(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(14);
        button.setTextColor(foreground);
        button.setBackgroundColor(background);
        button.setMinHeight(dp(44));
        button.setMinWidth(dp(72));
        button.setPadding(dp(8), 0, dp(8), 0);
        return button;
    }

    private LinearLayout.LayoutParams margins(int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.bottomMargin = bottom;
        return params;
    }

    private LinearLayout.LayoutParams buttonParams() { return margins(dp(10)); }

    private LinearLayout.LayoutParams sideButtonParams() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-2, -2);
        params.leftMargin = dp(8);
        return params;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
