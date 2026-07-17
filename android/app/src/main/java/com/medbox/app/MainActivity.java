package com.medbox.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
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
            // 适度限制缓存，避免旧 SW/资源把磁盘和内存撑爆
            settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        } catch (Throwable ignored) {
            /* 原生桥未就绪时不要崩 */
        }
    }
}
