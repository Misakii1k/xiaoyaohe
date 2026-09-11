package com.medbox.app

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log

/**
 * 全局单例闹钟音频控制器。
 *
 * 保证整个 App 进程内永远至多存在一路正在播放的铃声与振动。
 * 在开启新音频前无条件释放并置空旧实例，解决 Activity 重建或重复拉起时出现的双重背景音乐问题。
 * 支持音频焦点管理：响铃时临时暂停背景音频/视频（如红果短剧、音乐 App），停止时自动释放恢复播放。
 */
object AlarmAudioPlayer {

    private const val TAG = "AlarmAudioPlayer"

    private var mediaPlayer: MediaPlayer? = null
    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
    private var audioManager: AudioManager? = null
    private var audioFocusRequest: AudioFocusRequest? = null
    private var active = false

    val isAlerting: Boolean
        @Synchronized get() = active

    /**
     * 启动铃声与振动。
     * 若此前已有正在播放的音频实例，强制先执行 stop() 清理，再分配启动。
     */
    @JvmStatic
    @Synchronized
    fun start(context: Context) {
        stop()

        val appContext = context.applicationContext

        // 申请临时音频焦点：让背景正在播放的短剧、音乐、播客等暂时暂停
        try {
            val am = appContext.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            audioManager = am
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val playbackAttributes = AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
                val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(playbackAttributes)
                    .setAcceptsDelayedFocusGain(false)
                    .setOnAudioFocusChangeListener { /* 由系统自动暂停与恢复背景音 */ }
                    .build()
                am?.requestAudioFocus(request)
                audioFocusRequest = request
            } else {
                @Suppress("DEPRECATION")
                am?.requestAudioFocus(
                    null,
                    AudioManager.STREAM_ALARM,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
                )
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Failed to request audio focus", t)
        }

        val prefs = appContext.getSharedPreferences("medication_alarm_v1", Context.MODE_PRIVATE)
        val ringtonePref = prefs.getString("alarm_ringtone", "morning_energy") ?: "morning_energy"

        var playedCustom = false
        if (ringtonePref == "morning_energy") {
            try {
                val resId = appContext.resources.getIdentifier("morning_energy", "raw", appContext.packageName)
                if (resId != 0) {
                    val attributes = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                    val mp = MediaPlayer.create(appContext, resId, attributes, 0)
                    if (mp != null) {
                        mp.isLooping = true
                        mp.start()
                        mediaPlayer = mp
                        playedCustom = true
                    }
                }
            } catch (t: Throwable) {
                Log.w(TAG, "Failed to start custom morning_energy MediaPlayer, fallback to system ringtone", t)
            }
        }

        if (!playedCustom) {
            try {
                var alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                if (alertUri == null) {
                    alertUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
                }
                val r = RingtoneManager.getRingtone(appContext, alertUri)
                if (r != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        r.audioAttributes = AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                        r.isLooping = true
                    }
                    r.play()
                    ringtone = r
                }
            } catch (t: Throwable) {
                Log.e(TAG, "Failed to start ringtone", t)
            }
        }

        try {
            val v = appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (v != null && v.hasVibrator()) {
                val pattern = longArrayOf(0, 700, 250, 700, 250, 700)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, 0))
                } else {
                    @Suppress("DEPRECATION")
                    v.vibrate(pattern, 0)
                }
                vibrator = v
            }
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to start vibrator", t)
        }

        active = true
    }

    /**
     * 彻底静音并释放全部音频与马达资源，释放音频焦点通知系统恢复原 App 播放。
     * 无条件执行 stop()，不依赖不可靠的 isPlaying 属性。
     */
    @JvmStatic
    @Synchronized
    fun stop() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (ignored: Throwable) {
        }
        mediaPlayer = null

        try {
            ringtone?.stop()
        } catch (ignored: Throwable) {
        }
        ringtone = null

        try {
            vibrator?.cancel()
        } catch (ignored: Throwable) {
        }
        vibrator = null

        // 释放音频焦点：通知系统让此前暂停的背景音频（短剧/音乐等）自动恢复播放
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest?.let { audioManager?.abandonAudioFocusRequest(it) }
                audioFocusRequest = null
            } else {
                @Suppress("DEPRECATION")
                audioManager?.abandonAudioFocus(null)
            }
        } catch (ignored: Throwable) {
        }
        audioManager = null

        active = false
    }

    /**
     * 相机扫码时临时暂停马达振动，保留声音，避免物理抖动干扰镜头对焦。
     */
    @JvmStatic
    @Synchronized
    fun pauseVibration() {
        try {
            vibrator?.cancel()
        } catch (ignored: Throwable) {
        }
    }

    /**
     * 退出扫码但未解除时恢复振动。
     */
    @JvmStatic
    @Synchronized
    fun resumeVibration(context: Context) {
        if (!active) return
        try {
            val v = context.applicationContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (v != null && v.hasVibrator()) {
                val pattern = longArrayOf(0, 700, 250, 700, 250, 700)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, 0))
                } else {
                    @Suppress("DEPRECATION")
                    v.vibrate(pattern, 0)
                }
                vibrator = v
            }
        } catch (ignored: Throwable) {
        }
    }
}
