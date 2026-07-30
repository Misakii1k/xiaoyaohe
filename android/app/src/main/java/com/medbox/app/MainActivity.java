package com.medbox.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.medbox.app.lansync.ApkDistributionPlugin;
import com.medbox.app.lansync.LanSyncPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(LanSyncPlugin.class);
        registerPlugin(ApkDistributionPlugin.class);
        registerPlugin(MedicationAlarmPlugin.class);
        registerPlugin(NativeSpeechPlugin.class);
        registerPlugin(PowerSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        // 降低 WebView 缓存与媒体解码压力，缓解大图列表页闪退
        try {
            WebView webView = getBridge() != null ? getBridge().getWebView() : null;
            if (webView == null) return;
            WebSettings settings = webView.getSettings();
            settings.setDomStorageEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(true);
            // 列表里的图用 HTML loading=lazy；关闭 overview 模式避免额外布局内存
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);
            // 适度限制缓存，避免旧缓存资源把磁盘和内存撑爆
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        } catch (Throwable ignored) {
            /* 原生桥未就绪时不要崩 */
        }
        startKeepAlive();
    }

    /** 启动常驻前台服务保活 WebView 与 JS 定时器（提醒 tick、局域网自动同步）。 */
    private void startKeepAlive() {
        try {
            Intent service = new Intent(this, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(service);
            } else {
                startService(service);
            }
        } catch (Throwable ignored) {
            /* 部分机型受限启动失败不影响主流程 */
        }
    }
}
