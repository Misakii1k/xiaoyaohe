package com.medbox.app

import android.content.Context
import android.media.AudioAttributes
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
 */
object AlarmAudioPlayer {

    private const val TAG = "AlarmAudioPlayer"

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null
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
     * 彻底静音并释放全部音频与马达资源。
     * 无条件执行 stop()，不依赖不可靠的 isPlaying 属性。
     */
    @JvmStatic
    @Synchronized
    fun stop() {
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
