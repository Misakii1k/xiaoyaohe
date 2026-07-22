package com.medbox.app;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/** Uses the device speech service only when the server-side Tencent proxy is unavailable. */
@CapacitorPlugin(name = "NativeSpeech")
public final class NativeSpeechPlugin extends Plugin {
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall pendingCall;

    @PluginMethod
    public synchronized void start(PluginCall call) {
        if (pendingCall != null) {
            call.reject("已有一段语音正在识别", "BUSY");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("此设备没有可用的系统语音识别服务", "UNAVAILABLE");
            return;
        }
        pendingCall = call;
        call.setKeepAlive(true);
        mainHandler.post(() -> beginListening(call.getString("language", "zh-CN")));
    }

    @PluginMethod
    public synchronized void stop(PluginCall call) {
        mainHandler.post(() -> {
            if (recognizer != null) recognizer.stopListening();
            call.resolve();
        });
    }

    @PluginMethod
    public synchronized void abort(PluginCall call) {
        mainHandler.post(() -> {
            if (recognizer != null) recognizer.cancel();
            resolveCancelled();
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        mainHandler.post(this::destroyRecognizer);
        super.handleOnDestroy();
    }

    private void beginListening(String language) {
        if (pendingCall == null) return;
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle params) { }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float rmsdB) { }
                @Override public void onBufferReceived(byte[] buffer) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onPartialResults(Bundle partialResults) { }
                @Override public void onEvent(int eventType, Bundle params) { }

                @Override
                public void onResults(Bundle results) {
                    ArrayList<String> matches = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String text = matches != null && !matches.isEmpty() ? matches.get(0).trim() : "";
                    if (text.isEmpty()) rejectPending("没听清，请再说一次", "NO_SPEECH");
                    else resolveText(text);
                }

                @Override
                public void onError(int error) {
                    if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                        rejectPending("没听清，请再说一次", "NO_SPEECH");
                    } else if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        rejectPending("没有麦克风权限", "NOT_ALLOWED");
                    } else {
                        rejectPending("设备语音识别暂时不可用，请检查网络或系统语音服务", "SERVICE_UNAVAILABLE");
                    }
                }
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language == null ? "zh-CN" : language);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language == null ? "zh-CN" : language);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            recognizer.startListening(intent);
        } catch (Throwable error) {
            rejectPending("设备语音识别启动失败，请检查系统语音服务", "SERVICE_UNAVAILABLE");
        }
    }

    private synchronized void resolveText(String text) {
        if (pendingCall == null) return;
        JSObject result = new JSObject();
        result.put("text", text);
        pendingCall.resolve(result);
        clearPending();
    }

    private synchronized void resolveCancelled() {
        if (pendingCall == null) return;
        JSObject result = new JSObject();
        result.put("cancelled", true);
        pendingCall.resolve(result);
        clearPending();
    }

    private synchronized void rejectPending(String message, String code) {
        if (pendingCall == null) return;
        pendingCall.reject(message, code);
        clearPending();
    }

    private synchronized void clearPending() {
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Throwable ignored) { }
            recognizer = null;
        }
        pendingCall = null;
    }

    private synchronized void destroyRecognizer() {
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Throwable ignored) { }
            try { recognizer.destroy(); } catch (Throwable ignored) { }
        }
        recognizer = null;
        pendingCall = null;
    }
}
