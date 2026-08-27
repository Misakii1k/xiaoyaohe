package com.medbox.app;

import android.content.Intent;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
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
            installInsetsBridge(webView);
        } catch (Throwable ignored) {
            /* 原生桥未就绪时不要崩 */
        }
        startKeepAlive();
    }

    /**
     * insetsHandling=disable 后 WebView 拿不到系统栏内边距（env(safe-area-*) 恒 0），
     * 悬浮底栏会被 3 键导航条遮挡。这里在 window 级监听真实 insets，把四边
     * dp 值写进 CSS 变量（tokens.css 的 --safe-* 已留了二级兜底变量）。
     */
    private void installInsetsBridge(WebView webView) {
        final View decorView = getWindow().getDecorView();
        decorView.setOnApplyWindowInsetsListener((view, insets) -> {
            try {
                int left;
                int top;
                int right;
                int bottom;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.navigationBars()
                            | android.view.WindowInsets.Type.displayCutout()
                    );
                    left = bars.left;
                    top = bars.top;
                    right = bars.right;
                    bottom = bars.bottom;
                } else {
                    left = insets.getSystemWindowInsetLeft();
                    top = insets.getSystemWindowInsetTop();
                    right = insets.getSystemWindowInsetRight();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                float density = getResources().getDisplayMetrics().density;
                // 顶部不注入：历史布局已按「无顶部 inset」设计（insetsHandling=disable 的沉浸态），
                // 注入 cutout/状态栏高度会让顶栏凭空变高；只兜底左右与底部导航条。
                String js = "document.documentElement.style.setProperty('--safe-area-inset-bottom','"
                    + (bottom / density) + "px');" +
                    "document.documentElement.style.setProperty('--safe-area-inset-left','"
                    + (left / density) + "px');" +
                    "document.documentElement.style.setProperty('--safe-area-inset-right','"
                    + (right / density) + "px');";
                webView.evaluateJavascript(js, null);
            } catch (Throwable ignored) {
                /* insets 兜底失败不影响主流程 */
            }
            return insets;
        });
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
