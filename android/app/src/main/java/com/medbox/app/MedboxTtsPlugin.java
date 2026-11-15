package com.medbox.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 分药向导语音播报原生桥。
 * 封装系统 TextToSpeech：懒加载初始化、打断重播（QUEUE_FLUSH）、中文语种检测与语速设置，
 * 并在销毁时安全释放 TTS 资源。
 */
@CapacitorPlugin(name = "MedboxTts")
public final class MedboxTtsPlugin extends Plugin {
    private final Object lock = new Object();
    private TextToSpeech tts;
    private boolean initializing = false;
    private boolean ready = false;
    private boolean chineseSupported = false;

    private String pendingText = null;
    private float pendingRate = 1.0f;
    private PluginCall pendingSpeakCall = null;
    private final List<PluginCall> pendingAvailabilityCalls = new ArrayList<>();

    private void ensureEngineLocked() {
        if (tts != null || initializing) return;
        Context appContext = getContext() != null ? getContext().getApplicationContext() : null;
        if (appContext == null) {
            ready = false;
            chineseSupported = false;
            resolveAvailabilityCallsLocked(false);
            resolvePendingSpeakLocked(false, false, false);
            return;
        }
        initializing = true;
        try {
            tts = new TextToSpeech(appContext, status -> {
                synchronized (lock) {
                    initializing = false;
                    boolean engineOk = status == TextToSpeech.SUCCESS && tts != null;
                    boolean zhOk = false;
                    if (engineOk) {
                        zhOk = selectChineseLanguageLocked(tts);
                        try {
                            tts.setAudioAttributes(
                                new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build()
                            );
                        } catch (Throwable ignored) {
                            // 个别定制 ROM 不支持自定义音频属性时走默认通道
                        }
                    }
                    ready = engineOk && zhOk;
                    chineseSupported = zhOk;
                    resolveAvailabilityCallsLocked(engineOk);

                    if (pendingSpeakCall != null && pendingText != null) {
                        PluginCall call = pendingSpeakCall;
                        String text = pendingText;
                        float rate = pendingRate;
                        pendingSpeakCall = null;
                        pendingText = null;
                        if (ready) {
                            boolean spoken = speakInternalLocked(text, rate, true);
                            resolveSpeakCall(call, spoken, true, false);
                        } else {
                            resolveSpeakCall(call, false, chineseSupported, false);
                        }
                    } else if (pendingSpeakCall != null) {
                        PluginCall call = pendingSpeakCall;
                        pendingSpeakCall = null;
                        pendingText = null;
                        resolveSpeakCall(call, false, chineseSupported, true);
                    }
                }
            });
        } catch (Throwable ignored) {
            initializing = false;
            ready = false;
            chineseSupported = false;
            tts = null;
            resolveAvailabilityCallsLocked(false);
            resolvePendingSpeakLocked(false, false, false);
        }
    }

    private boolean selectChineseLanguageLocked(TextToSpeech engine) {
        Locale[] candidates = new Locale[] {
            Locale.SIMPLIFIED_CHINESE,
            Locale.CHINESE,
            Locale.TRADITIONAL_CHINESE,
        };
        for (Locale locale : candidates) {
            try {
                int availability = engine.setLanguage(locale);
                if (availability != TextToSpeech.LANG_MISSING_DATA
                    && availability != TextToSpeech.LANG_NOT_SUPPORTED) {
                    return true;
                }
            } catch (Throwable ignored) {
                // 继续尝试下一个候选中文语种
            }
        }
        return false;
    }

    private boolean speakInternalLocked(String text, float rate, boolean interrupt) {
        if (tts == null || !ready) return false;
        try {
            tts.setSpeechRate(rate);
            int mode = interrupt ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            String utteranceId = "medbox_sort_" + System.nanoTime();
            return tts.speak(text, mode, null, utteranceId) == TextToSpeech.SUCCESS;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private void resolveAvailabilityCallsLocked(boolean available) {
        if (pendingAvailabilityCalls.isEmpty()) return;
        for (PluginCall call : pendingAvailabilityCalls) {
            JSObject result = new JSObject();
            result.put("available", available);
            result.put("chineseSupported", chineseSupported);
            result.put("initialized", true);
            call.resolve(result);
        }
        pendingAvailabilityCalls.clear();
    }

    private void resolvePendingSpeakLocked(boolean spoken, boolean supported, boolean interrupted) {
        if (pendingSpeakCall == null) return;
        resolveSpeakCall(pendingSpeakCall, spoken, supported, interrupted);
        pendingSpeakCall = null;
        pendingText = null;
    }

    private void resolveSpeakCall(PluginCall call, boolean spoken, boolean supported, boolean interrupted) {
        JSObject result = new JSObject();
        result.put("spoken", spoken);
        result.put("supported", supported);
        if (interrupted) result.put("interrupted", true);
        call.resolve(result);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        synchronized (lock) {
            if (!initializing && tts != null) {
                JSObject result = new JSObject();
                result.put("available", ready);
                result.put("chineseSupported", chineseSupported);
                result.put("initialized", true);
                call.resolve(result);
                return;
            }
            pendingAvailabilityCalls.add(call);
            ensureEngineLocked();
        }
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            JSObject result = new JSObject();
            result.put("spoken", false);
            result.put("supported", chineseSupported);
            call.resolve(result);
            return;
        }
        float rawRate = call.getFloat("rate", 1.0f);
        float rate = Math.max(0.5f, Math.min(1.5f, Float.isFinite(rawRate) ? rawRate : 1.0f));
        boolean interrupt = !Boolean.FALSE.equals(call.getBoolean("interrupt", true));

        synchronized (lock) {
            if (tts == null || initializing) {
                if (pendingSpeakCall != null) {
                    resolveSpeakCall(pendingSpeakCall, false, true, true);
                }
                pendingSpeakCall = call;
                pendingText = text.trim();
                pendingRate = rate;
                ensureEngineLocked();
                return;
            }
            if (!ready || !chineseSupported) {
                resolveSpeakCall(call, false, false, false);
                return;
            }
            boolean spoken = speakInternalLocked(text.trim(), rate, interrupt);
            resolveSpeakCall(call, spoken, true, false);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (lock) {
            resolvePendingSpeakLocked(false, chineseSupported, true);
            if (tts != null) {
                try {
                    tts.stop();
                } catch (Throwable ignored) {
                }
            }
        }
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (lock) {
            resolveAvailabilityCallsLocked(false);
            resolvePendingSpeakLocked(false, chineseSupported, true);
            if (tts != null) {
                try {
                    tts.stop();
                    tts.shutdown();
                } catch (Throwable ignored) {
                }
                tts = null;
            }
            ready = false;
            initializing = false;
        }
        super.handleOnDestroy();
    }
}
