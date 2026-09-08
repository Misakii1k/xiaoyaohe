package com.medbox.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * 小药盒无障碍辅助服务。
 *
 * 核心职责：
 * 仅在扫码强制用药提醒处于未解除锁定状态时提供前台焦点守护。
 * 替代原系统屏幕固定 (startLockTask)，彻底免去「应用已固定」系统弹窗。
 * 一旦检测到用户通过手势或多任务切出到非本应用窗口，毫秒级将 MedicationAlarmActivity 重新拉回前台。
 * 扫码成功或提醒结束时立即解除守护。
 */
class MedboxAccessibilityService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (!isGuarded) return
        if (event == null) return

        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = event.packageName?.toString()?.lowercase() ?: return
            // 忽略本应用、输入法、系统权限申请弹窗（避免拦截相机权限授予过程与崩溃）
            if (pkg == packageName.lowercase()) return
            if (pkg.contains("inputmethod") || pkg.contains("ime")) return
            if (pkg.contains("permission") || pkg.contains("packageinstaller") ||
                pkg.contains("security") || pkg.contains("systemmanager") ||
                pkg.contains("safecenter") || pkg == "android" || pkg.contains("systemui")
            ) return

            Log.i(TAG, "Non-app window detected during mandatory alarm: $pkg, pulling alarm back to front")
            reclaimAlarm()
        }
    }

    override fun onInterrupt() {
        Log.i(TAG, "MedboxAccessibilityService interrupted")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "MedboxAccessibilityService connected")
    }

    override fun onDestroy() {
        if (instance == this) instance = null
        super.onDestroy()
    }

    private fun reclaimAlarm() {
        if (!isGuarded) return
        val payload = activePayloadString ?: return
        try {
            val reopenIntent = Intent(this, MedicationAlarmActivity::class.java).apply {
                putExtra(MedicationAlarmContract.EXTRA_PAYLOAD, payload)
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK
                        or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                        or Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
            }
            startActivity(reopenIntent)
        } catch (t: Throwable) {
            Log.e(TAG, "Failed to reclaim alarm via accessibility service", t)
        }
    }

    companion object {
        private const val TAG = "MedboxAccessibility"

        @Volatile
        private var instance: MedboxAccessibilityService? = null

        @Volatile
        private var isGuarded: Boolean = false

        @Volatile
        private var activePayloadString: String? = null

        val isServiceRunning: Boolean
            get() = instance != null

        val isGuardActive: Boolean
            get() = isGuarded

        @JvmStatic
        fun setGuarded(guarded: Boolean, payloadJson: String? = null) {
            isGuarded = guarded
            if (guarded) {
                if (payloadJson != null) activePayloadString = payloadJson
            } else {
                activePayloadString = null
            }
            Log.i(TAG, "Guard state set to: $guarded")
        }

        @JvmStatic
        fun isAccessibilityEnabled(context: Context): Boolean {
            if (isServiceRunning) return true
            val expectedServiceName = "${context.packageName}/${MedboxAccessibilityService::class.java.canonicalName}"
            val enabledServicesSetting = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false

            val colonSplitter = TextUtils.SimpleStringSplitter(':')
            colonSplitter.setString(enabledServicesSetting)
            while (colonSplitter.hasNext()) {
                val componentNameString = colonSplitter.next()
                if (componentNameString.equals(expectedServiceName, ignoreCase = true) ||
                    componentNameString.contains(MedboxAccessibilityService::class.java.simpleName)
                ) {
                    return true
                }
            }
            return false
        }
    }
}
