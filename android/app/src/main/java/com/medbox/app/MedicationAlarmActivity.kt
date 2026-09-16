package com.medbox.app

import android.Manifest
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.KeyEvent
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.draw.scale
import java.util.concurrent.atomic.AtomicBoolean
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import android.util.Log
import android.util.Size
import android.view.MotionEvent
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.SurfaceOrientedMeteringPointFactory
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.Result
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer
import androidx.compose.ui.input.pointer.pointerInput
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.shapes.Capsule
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.runtime.rememberCoroutineScope
import kotlinx.coroutines.launch
import kotlin.math.roundToInt
import androidx.compose.ui.input.pointer.PointerEventPass
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.coroutineScope
import android.os.SystemClock
import org.json.JSONException
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * 全屏用药提醒页（Compose 版，0.9.9 重设计）。
 *
 * 行为契约：载荷解析走 MedicationAlarmContract；铃声/振动保留；singleTop onNewIntent
 * 换载荷重建页面。0.9.8 起自动关闭计时由 Compose 侧驱动（原 Handler 移除），
 * 进入扫码取景器时暂停倒计时、退出后恢复剩余秒数。
 *
 * 「扫码解除强制提醒」（scanVerify=true）：
 * - 解锁前不展示任何完成/贪睡/跳过按钮（防睡迷糊随手关），仅提供扫码入口；
 * - 内嵌 CameraX 取景器 + MLKit 条码识别，扫到内容 == scanToken 才解锁；
 * - 相机权限在 Activity 内即时请求；取景期间自动关闭倒计时暂停。
 *
 * UI 玻璃按钮为 Kyant0/AndroidLiquidGlass（drawBackdrop + vibrancy/blur/lens），
 * lens 需 AGSL（API 33+），低版本库内自动降级为 blur+vibrancy。
 */
class MedicationAlarmActivity : ComponentActivity() {

    // Compose 可观察载荷：onNewIntent 更新后界面自动重建
    private var payloadState = mutableStateOf<JSONObject?>(null)

    /** 扫码解锁与滑动解锁状态，Activity 级别可观察 */
    private val scanUnlockedState = mutableStateOf(false)
    private val slideUnlockedState = mutableStateOf(false)
    private val autoResolvedState = mutableStateOf(false)

    /** 闹钟会话计数：onNewIntent 换载荷时 +1，驱动解锁态/取景器/倒计时全部复位 */
    private var scanSession = mutableIntStateOf(0)

    // 相机权限结果在 Activity 构建期注册（ComponentActivity 规范）
    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        cameraPermissionGranted.value = granted
        if (!granted) {
            Toast.makeText(this, "需要相机权限以扫描解锁条码或二维码", Toast.LENGTH_SHORT).show()
        }
        updateAccessibilityGuard()
    }

    private fun requestCameraPermissionSafely() {
        // 请求权限弹窗前暂停无障碍前台拦截，防止无障碍服务把权限弹窗误判为离开应用而死循环抢占焦点导致系统窗口管理器崩溃
        MedboxAccessibilityService.setGuarded(false)
        cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    private val cameraPermissionGranted = mutableStateOf(false)

    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingPullTask: Runnable? = null

    private val finishAllReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == MedicationAlarmContract.ACTION_FINISH_ALL_ALARMS) {
                dismissThisActivity()
            }
        }
    }

    private fun clearDelayedTasks() {
        pendingPullTask?.let { mainHandler.removeCallbacks(it) }
        pendingPullTask = null
        mainHandler.removeCallbacksAndMessages(null)
    }

    private fun dismissThisActivity() {
        autoResolvedState.value = true
        clearDelayedTasks()
        MedboxAccessibilityService.setGuarded(false)
        silenceAlert()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                finishAndRemoveTask()
            } else {
                finish()
            }
        } catch (ignored: Throwable) {
            finish()
        }
    }

    private fun isLocked(): Boolean {
        if (isFinishing || isDestroyed || autoResolvedState.value || scanUnlockedState.value) return false
        val current = payloadState.value ?: return false
        return MedicationAlarmContract.requiresScanVerification(current)
    }

    /** 沉浸粘性全屏模式：隐藏底部导航手势栏与状态栏，滑动屏幕边缘仅唤出半透明指示条，不触发 Home 退出手势 */
    private fun enableImmersiveMode() {
        try {
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } catch (ignored: Throwable) {
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            enableImmersiveMode()
        }
    }

    private fun updateAccessibilityGuard() {
        if (isLocked()) {
            MedboxAccessibilityService.setGuarded(true, payloadState.value?.toString())
        } else {
            MedboxAccessibilityService.setGuarded(false)
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (isFinishing || autoResolvedState.value) return

        // 仅在扫码锁定态下，提醒未完成前拦截退回桌面，强制拉回前台
        if (isLocked()) {
            reclaimForeground()
            triggerHapticWarning()
            Toast.makeText(this, "强制提醒：请扫描条码解除", Toast.LENGTH_SHORT).show()
        }
    }

    override fun onStop() {
        super.onStop()
        if (!isFinishing && !isDestroyed && !autoResolvedState.value && isLocked()) {
            // 意外退入后台时强力拉回
            reclaimForeground()
        } else {
            clearDelayedTasks()
        }
    }

    private fun reclaimForeground() {
        if (isFinishing || isDestroyed || autoResolvedState.value) return
        val payload = payloadState.value ?: return

        clearDelayedTasks()

        val pullTask = Runnable {
            if (isFinishing || isDestroyed || autoResolvedState.value) return@Runnable
            try {
                val am = getSystemService(ACTIVITY_SERVICE) as? ActivityManager
                am?.moveTaskToFront(taskId, ActivityManager.MOVE_TASK_NO_USER_ACTION)
            } catch (ignored: Throwable) {
            }
            try {
                val reopenIntent = Intent(this@MedicationAlarmActivity, MedicationAlarmActivity::class.java).apply {
                    putExtra(MedicationAlarmContract.EXTRA_PAYLOAD, payload.toString())
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK
                            or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                            or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                }
                startActivity(reopenIntent)
            } catch (ignored: Throwable) {
            }
        }

        pendingPullTask = pullTask
        pullTask.run()
        mainHandler.postDelayed(pullTask, 120L)
    }

    private fun triggerHapticWarning() {
        try {
            val v = getSystemService(VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v?.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                v?.vibrate(120)
            }
        } catch (ignored: Throwable) {
        }
    }

    private fun triggerHapticBypass() {
        try {
            val v = getSystemService(VIBRATOR_SERVICE) as? Vibrator
            val pattern = longArrayOf(0, 60, 80, 60)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                v?.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                v?.vibrate(pattern, -1)
            }
        } catch (ignored: Throwable) {
        }
    }

    /** 扫描时暂停震动，避免机身抖动影响对焦与条码识别率；保留声音 */
    private fun pauseVibration() {
        AlarmAudioPlayer.pauseVibration()
    }

    /** 退出扫描且未解除时恢复震动 */
    private fun resumeVibration() {
        AlarmAudioPlayer.resumeVibration(this)
    }

    private fun startAlert() {
        AlarmAudioPlayer.start(this)
    }

    private fun silenceAlert() {
        AlarmAudioPlayer.stop()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        volumeControlStream = AudioManager.STREAM_ALARM
        activeActivities.add(this)

        try {
            val filter = IntentFilter(MedicationAlarmContract.ACTION_FINISH_ALL_ALARMS)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(finishAllReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
            } else {
                registerReceiver(finishAllReceiver, filter)
            }
        } catch (ignored: Throwable) {
        }

        cameraPermissionGranted.value = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        // 锁屏全屏：点亮屏幕 + 显示在锁屏之上
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                or WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
                or WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                or WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )
        enableImmersiveMode()
        try {
            val p = MedicationAlarmContract.payloadFrom(intent)
            payloadState.value = p
            recordActivePayload(p)
        } catch (error: Throwable) {
            Log.e("MedicationAlarm", "Failed to parse alarm payload", error)
            dismissThisActivity()
            return
        }
        setContent {
            val payload = payloadState.value ?: return@setContent
            AlarmRoot(payload)
        }
        startAlert()
        updateAccessibilityGuard()
    }

    override fun onResume() {
        super.onResume()
        enableImmersiveMode()
        if (!autoResolvedState.value && !isFinishing) {
            updateAccessibilityGuard()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        try {
            val newPayload = MedicationAlarmContract.payloadFrom(intent)
            recordActivePayload(newPayload)
            val currentPayload = payloadState.value
            val currentId = currentPayload?.optInt("id", -1)
            val newId = newPayload.optInt("id", -1)
            val sameAlarm = currentId != null && currentId != -1 && currentId == newId

            payloadState.value = newPayload
            enableImmersiveMode()
            startAlert()
            updateAccessibilityGuard()

            // 仅当切换到完全不同的新闹钟时，才重置解锁态与会话计数；同提醒拉回时保持当前进度
            if (!sameAlarm) {
                scanUnlockedState.value = false
                slideUnlockedState.value = false
                autoResolvedState.value = false
                scanSession.value += 1
            }
        } catch (error: Throwable) {
            Log.e("MedicationAlarm", "Failed to parse new alarm intent payload", error)
        }
    }

    // ============================== UI（Compose） ==============================

    @Composable
    private fun AlarmRoot(payload: JSONObject) {
        val requireScan = isLocked()
        val expectedTokens = remember(payload, scanSession.value) {
            val list = getActivePayloadsSnapshot()
            if (list.isNotEmpty()) {
                MedicationAlarmContract.allExpectedTokens(list)
            } else {
                MedicationAlarmContract.allExpectedTokens(payload)
            }
        }
        val mode = payload.optString("mode", "strong")
        val data = payload.optJSONObject("data")
        val isGroup = data != null && "reminder-group" == data.optString("kind")

        val scanUnlocked = scanUnlockedState
        val showScanner = remember { mutableStateOf(false) }
        val scannerEmergencyMode = remember { mutableStateOf(false) }
        val scanFeedback = remember { mutableStateOf<String?>(null) }
        // 扫码匹配后直接视为已服用（单药记已服用、群组记全部已服用），展示成功态后自动关闭。
        val autoResolved = autoResolvedState
        val showEmergencyDialog = remember { mutableStateOf(false) }

        // 会话切换：复位解锁/滑动解锁/取景/反馈/应急对话框
        LaunchedEffect(scanSession.value) {
            scanUnlockedState.value = false
            slideUnlockedState.value = false
            showScanner.value = false
            scannerEmergencyMode.value = false
            scanFeedback.value = null
            autoResolvedState.value = false
            showEmergencyDialog.value = false
        }

        // 扫码模式下关闭震动，降低机身震动对摄像头扫码对焦的物理干扰；退出扫码时恢复
        LaunchedEffect(showScanner.value) {
            if (showScanner.value) {
                pauseVibration()
            } else if (!autoResolved.value && !scanUnlocked.value && !slideUnlockedState.value) {
                resumeVibration()
            }
        }

        val locked = requireScan && !scanUnlocked.value

        // 返回手势/按键拦截加固：
        // 0. 应急暗门对话框开启时：返回收起对话框并恢复响铃；
        // 1. 取景器开启时：返回仅收起取景器；
        // 2. 扫码锁定态：严禁退出，提示必须扫码并短震警告；
        // 3. 扫码已自动记录：返回仅关闭页面，绝不能再叠加贪睡动作；
        // 4. 未滑动解锁态：防误触拦截，提示「请向右滑动解锁」并短震警告；
        // 5. 滑动解锁后操作态：返回手势自动转为「10分钟后提醒（贪睡）」，杜绝随手划掉漏服。
        BackHandler(enabled = true) {
            if (showEmergencyDialog.value) {
                showEmergencyDialog.value = false
                startAlert()
            } else if (showScanner.value) {
                showScanner.value = false
                scannerEmergencyMode.value = false
                scanFeedback.value = null
            } else if (autoResolved.value) {
                MedboxAccessibilityService.setGuarded(false)
                finishAllAlarms(this@MedicationAlarmActivity)
            } else if (locked) {
                val isCustom = expectedTokens.any { it.isNotEmpty() && !it.startsWith(TOKEN_PREFIX) }
                val msg = if (isCustom) "强制提醒：请扫描已绑定的药盒或物品条码解除" else "强制提醒：请扫描专属解锁二维码解除"
                scanFeedback.value = msg
                triggerHapticWarning()
                Toast.makeText(this@MedicationAlarmActivity, msg, Toast.LENGTH_SHORT).show()
            } else if (!slideUnlockedState.value) {
                val msg = "请向右滑动解锁"
                scanFeedback.value = msg
                triggerHapticWarning()
                Toast.makeText(this@MedicationAlarmActivity, msg, Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(this@MedicationAlarmActivity, "已延后 10 分钟提醒", Toast.LENGTH_SHORT).show()
                act(MedicationAlarmContract.ACTION_SNOOZE)
            }
        }

        LaunchedEffect(scanFeedback.value) {
            if (scanFeedback.value != null) {
                delay(3000)
                scanFeedback.value = null
            }
        }

        // 扫码自动记录成功态停留约 1.5s（足够看清反馈），然后自动关闭页面返回原应用。
        LaunchedEffect(autoResolved.value) {
            if (!autoResolved.value) return@LaunchedEffect
            delay(1500)
            finishAllAlarms(this@MedicationAlarmActivity)
        }

        // 全屏持续提醒：未解锁前持续响铃；若达到 10 分钟无人滑动解锁，自动延后 10 分钟提醒退出，防止耗尽电量
        val MAX_RING_TIMEOUT_SECONDS = 600
        LaunchedEffect(scanSession.value, slideUnlockedState.value, locked) {
            if (locked || slideUnlockedState.value) return@LaunchedEffect
            delay(MAX_RING_TIMEOUT_SECONDS * 1_000L)
            if (!slideUnlockedState.value && !autoResolvedState.value && !isFinishing) {
                Toast.makeText(this@MedicationAlarmActivity, "提醒超时，已自动延后 10 分钟提醒", Toast.LENGTH_SHORT).show()
                act(MedicationAlarmContract.ACTION_SNOOZE)
            }
        }

        // 每秒跳动排序放在内容之前初始化，供 footer 引用

        val backdrop = rememberLayerBackdrop()

        Box(
            Modifier
                .fillMaxSize()
                .background(Background)
        ) {
            DecorLayer(
                Modifier
                    .matchParentSize()
                    .layerBackdrop(backdrop)
            )

            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp)
            ) {
                Spacer(Modifier.height(20.dp))
                HeaderBlock(mode = mode, payload = payload, locked = locked)

                Spacer(Modifier.height(18.dp))
                if (locked || autoResolved.value) {
                    FooterActions(
                        payload = payload,
                        expectedTokens = expectedTokens,
                        backdrop = backdrop,
                        groupPayload = isGroup,
                        locked = locked,
                        slideUnlocked = slideUnlockedState.value,
                        onSlideUnlock = {
                            slideUnlockedState.value = true
                            silenceAlert()
                            triggerHapticBypass()
                        },
                        resolved = autoResolved.value,
                        scanFeedback = scanFeedback.value,
                        secondsLeft = -1,
                        onStartScan = {
                            scanFeedback.value = null
                            scannerEmergencyMode.value = false
                            showScanner.value = true
                            if (!cameraPermissionGranted.value &&
                                ContextCompat.checkSelfPermission(this@MedicationAlarmActivity, Manifest.permission.CAMERA)
                                != PackageManager.PERMISSION_GRANTED
                            ) {
                                requestCameraPermissionSafely()
                            }
                        },
                        onEmergencyTriggered = {
                            scanFeedback.value = null
                            vibrateUnlock()
                            scannerEmergencyMode.value = true
                            showScanner.value = true
                            if (!cameraPermissionGranted.value &&
                                ContextCompat.checkSelfPermission(this@MedicationAlarmActivity, Manifest.permission.CAMERA)
                                != PackageManager.PERMISSION_GRANTED
                            ) {
                                requestCameraPermissionSafely()
                            }
                        },
                        onDismissAll = {
                            finishAllAlarms(this@MedicationAlarmActivity)
                        },
                    )

                    Spacer(Modifier.height(20.dp))
                    if (isGroup && data != null) {
                        GroupBody(data, backdrop, locked = true, canAct = false)
                    } else {
                        LegacyBody(payload, data)
                    }
                } else {
                    if (isGroup && data != null) {
                        GroupBody(data, backdrop, locked = false, canAct = slideUnlockedState.value)
                    } else {
                        LegacyBody(payload, data)
                    }

                    Spacer(Modifier.height(24.dp))
                    FooterActions(
                        payload = payload,
                        expectedTokens = expectedTokens,
                        backdrop = backdrop,
                        groupPayload = isGroup,
                        locked = locked,
                        slideUnlocked = slideUnlockedState.value,
                        onSlideUnlock = {
                            slideUnlockedState.value = true
                            silenceAlert()
                            triggerHapticBypass()
                        },
                        resolved = autoResolved.value,
                        scanFeedback = scanFeedback.value,
                        secondsLeft = -1,
                        onStartScan = {
                            scanFeedback.value = null
                            scannerEmergencyMode.value = false
                            showScanner.value = true
                            if (!cameraPermissionGranted.value &&
                                ContextCompat.checkSelfPermission(this@MedicationAlarmActivity, Manifest.permission.CAMERA)
                                != PackageManager.PERMISSION_GRANTED
                            ) {
                                requestCameraPermissionSafely()
                            }
                        },
                        onEmergencyTriggered = {
                            scanFeedback.value = null
                            vibrateUnlock()
                            scannerEmergencyMode.value = true
                            showScanner.value = true
                            if (!cameraPermissionGranted.value &&
                                ContextCompat.checkSelfPermission(this@MedicationAlarmActivity, Manifest.permission.CAMERA)
                                != PackageManager.PERMISSION_GRANTED
                            ) {
                                requestCameraPermissionSafely()
                            }
                        },
                        onDismissAll = {
                            finishAllAlarms(this@MedicationAlarmActivity)
                        },
                    )
                }
                Spacer(Modifier.height(28.dp))
            }

            if (showScanner.value) {
                ScannerOverlay(
                    expectedTokens = expectedTokens,
                    showEmergencyBypass = scannerEmergencyMode.value,
                    onClose = {
                        showScanner.value = false
                        scannerEmergencyMode.value = false
                        scanFeedback.value = null
                    },
                    onEmergencyTriggered = {
                        showScanner.value = false
                        vibrateUnlock()
                        showEmergencyDialog.value = true
                    },
                    onMatched = {
                        showScanner.value = false
                        scanUnlocked.value = true
                        scanFeedback.value = "已验证 · 操作已解锁"
                        vibrateUnlock()
                        MedboxAccessibilityService.setGuarded(false)
                        val payloadsToResolve = getActivePayloadsSnapshot().ifEmpty {
                            listOfNotNull(payloadState.value)
                        }
                        for (p in payloadsToResolve) {
                            dispatchScanAutoTaken(p)
                        }
                        autoResolved.value = true
                    },
                )
            }

            if (showEmergencyDialog.value) {
                EmergencyBypassDialog(
                    groupPayload = isGroup,
                    onSnooze = {
                        MedboxAccessibilityService.setGuarded(false)
                        showEmergencyDialog.value = false
                        Toast.makeText(this@MedicationAlarmActivity, "已延后 10 分钟提醒", Toast.LENGTH_SHORT).show()
                        act(MedicationAlarmContract.ACTION_SNOOZE)
                    },
                    onSkip = {
                        MedboxAccessibilityService.setGuarded(false)
                        showEmergencyDialog.value = false
                        val action = if (isGroup) MedicationAlarmContract.ACTION_ALL_SKIPPED else MedicationAlarmContract.ACTION_SKIP
                        Toast.makeText(this@MedicationAlarmActivity, "已跳过本次用药", Toast.LENGTH_SHORT).show()
                        act(action)
                    },
                    onForceStop = {
                        MedboxAccessibilityService.setGuarded(false)
                        showEmergencyDialog.value = false
                        silenceAlert()
                        Toast.makeText(this@MedicationAlarmActivity, "已强行停止提醒", Toast.LENGTH_SHORT).show()
                        val action = if (isGroup) MedicationAlarmContract.ACTION_ALL_SKIPPED else MedicationAlarmContract.ACTION_SKIP
                        act(action)
                    },
                    onCancel = {
                        showEmergencyDialog.value = false
                        startAlert()
                    }
                )
            }
        }
    }

    /** 扫码成功后的短振动与停止警报反馈 */
    private fun vibrateUnlock() {
        silenceAlert()
        triggerHapticBypass()
    }

    /**
     * 扫码匹配即视为已服用：单药记「已服用」，群组提醒记「全部已服用」。
     * 复用 handleAction 的原生队列，TS 侧 replayPendingMedicationReminderActions 落库。
     */
    private fun dispatchScanAutoTaken(payload: JSONObject) {
        val data = payload.optJSONObject("data")
        val action = if (data != null && "reminder-group" == data.optString("kind")) {
            MedicationAlarmContract.ACTION_ALL_TAKEN
        } else {
            MedicationAlarmContract.ACTION_TAKEN
        }
        try {
            MedicationAlarmContract.handleAction(this, action, payload)
        } catch (ignored: JSONException) {
        }
    }

    // ------------------------------ 头部：呼吸点 + 实时时钟 ------------------------------

    @Composable
    private fun HeaderBlock(mode: String, payload: JSONObject, locked: Boolean) {
        val clock = remember { mutableStateOf("") }
        LaunchedEffect(Unit) {
            val fmt = SimpleDateFormat("HH:mm", Locale.getDefault())
            while (true) {
                clock.value = fmt.format(Date())
                delay(15_000)
            }
        }
        val breathing = rememberInfiniteTransition(label = "breathing")
        val dotAlpha by breathing.animateFloat(
            initialValue = 1f,
            targetValue = 0.30f,
            animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
            label = "dot",
        )

        Row(verticalAlignment = Alignment.CenterVertically) {
            Canvas(Modifier.size(9.dp).graphicsLayer { alpha = dotAlpha }) {
                drawCircle(GreenBright)
            }
            Spacer(Modifier.width(8.dp))
            BasicText(
                ALARM_EYEBROW,
                style = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = GreenDeep),
            )
            Spacer(Modifier.weight(1f))
            if (!locked && clock.value.isNotEmpty()) {
                BasicText(
                    clock.value,
                    style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = InkSoft.copy(alpha = 0.85f)),
                )
            }
        }
    }


    // ------------------------------ 主体内容 ------------------------------

    /** 组载荷（V2）：头部时段+时间，中部每药一行，操作在底部统一。 */
    @Composable
    private fun GroupBody(data: JSONObject, backdrop: Backdrop, locked: Boolean, canAct: Boolean = !locked) {
        GlassText(
            MedicationAlarmContract.buildGroupTitle(data),
            30.sp, FontWeight.Bold, Ink,
        )
        Spacer(Modifier.height(6.dp))
        GlassText(
            "${MedicationAlarmContract.slotLabel(data.optString("slot"))} · " +
                formatTime(data.optLong("dueAt", 0L)),
            16.sp, FontWeight.Medium, InkSoft.copy(alpha = 0.9f),
        )
        Spacer(Modifier.height(20.dp))

        val occurrences = data.optJSONArray("occurrences")
        val count = occurrences?.length() ?: 0
        for (index in 0 until count) {
            occurrences?.optJSONObject(index)?.let { occurrence ->
                MedicationRow(occurrence, backdrop, locked, canAct)
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    @Composable
    private fun MedicationRow(occurrence: JSONObject, backdrop: Backdrop, locked: Boolean, canAct: Boolean = !locked) {
        val name = occurrence.optString("medName")
        val dose = occurrence.optString("dose")
        val occurrenceId = occurrence.optString("occurrenceId")
        if (name.isEmpty() && occurrenceId.isEmpty()) return

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(22.dp))
                .background(Color.White.copy(alpha = 0.86f))
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                GlassText(name.ifEmpty { "用药" }, 19.sp, FontWeight.SemiBold, Ink)
                if (dose.isNotEmpty()) {
                    GlassText(dose, 14.sp, FontWeight.Normal, InkSoft)
                }
            }
            if (canAct && occurrenceId.isNotEmpty()) {
                Spacer(Modifier.width(10.dp))
                PillAction(label = "已服", fg = GreenDeep, backdrop = backdrop) {
                    queueOccurrence(MedicationAlarmContract.ACTION_TAKEN, occurrenceId)
                }
                Spacer(Modifier.width(8.dp))
                PillAction(label = "跳过", fg = Red, backdrop = backdrop) {
                    queueOccurrence(MedicationAlarmContract.ACTION_SKIP, occurrenceId)
                }
            } else if (!canAct) {
                Spacer(Modifier.width(10.dp))
                LockBadge(label = if (locked) "待扫码" else "待解锁")
            }
        }
    }

    /** 锁定态行内徽标：提示该行需扫码或滑动解锁后才能操作 */
    @Composable
    private fun LockBadge(label: String = "待解锁") {
        Box(
            Modifier
                .clip(Capsule())
                .background(GreenDeep.copy(alpha = 0.08f))
                .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            BasicText(
                label,
                style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = GreenDeep),
            )
        }
    }

    /** 旧单药载荷布局：超大标题 + 剂量信息，居中聚焦。 */
    @Composable
    private fun LegacyBody(payload: JSONObject, data: JSONObject?) {
        val dose = data?.optString("medicationDose").orEmpty()
        val medName = data?.optString("medicationName").orEmpty()

        Spacer(Modifier.height(28.dp))
        GlassText(
            payload.optString("title", "该吃药了"),
            34.sp, FontWeight.ExtraBold, Ink,
            modifier = Modifier.fillMaxWidth(),
            align = TextAlign.Center,
        )
        if (medName.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            GlassText(medName, 22.sp, FontWeight.SemiBold, InkSoft,
                modifier = Modifier.fillMaxWidth(), align = TextAlign.Center)
        }
        if (dose.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.Center,
            ) {
                BasicText(
                    dose,
                    style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = GreenDeep),
                )
            }
        }
    }

    /**
     * 向右滑动解锁组件（Slide to Unlock）。
     * 优雅的微毛玻璃质感轨道 + 阻尼拖拽手柄 + 弹簧释放回弹动效。
     * 滑动超过 70% 判定解锁成功，触发 onUnlock 回调并伴随触觉反馈。
     */
    @Composable
    private fun SlideToUnlockBar(
        onUnlock: () -> Unit,
        modifier: Modifier = Modifier,
    ) {
        val coroutineScope = rememberCoroutineScope()
        val dragOffset = remember { Animatable(0f) }
        val density = LocalDensity.current
        var unlockedTriggered by remember { mutableStateOf(false) }

        // 呼吸微动效用于提示文字
        val hintTransition = rememberInfiniteTransition(label = "slideHint")
        val hintAlpha by hintTransition.animateFloat(
            initialValue = 0.45f,
            targetValue = 0.95f,
            animationSpec = infiniteRepeatable(tween(1200, easing = LinearEasing), RepeatMode.Reverse),
            label = "hintAlpha"
        )

        BoxWithConstraints(
            modifier = modifier
                .fillMaxWidth()
                .height(64.dp)
                .clip(RoundedCornerShape(32.dp))
                .background(Color.White.copy(alpha = 0.85f))
                .border(1.dp, Green.copy(alpha = 0.20f), RoundedCornerShape(32.dp)),
            contentAlignment = Alignment.CenterStart
        ) {
            val totalWidthPx = with(density) { maxWidth.toPx() }
            val handleSizePx = with(density) { 52.dp.toPx() }
            val paddingPx = with(density) { 6.dp.toPx() }
            val maxDragDistance = (totalWidthPx - handleSizePx - paddingPx * 2).coerceAtLeast(1f)
            val dragFraction = (dragOffset.value / maxDragDistance).coerceIn(0f, 1f)

            // 背景文字：随着向右拖拽逐渐淡出
            val textAlpha = (1f - dragFraction * 1.6f).coerceIn(0f, 1f) * hintAlpha
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 60.dp),
                contentAlignment = Alignment.Center
            ) {
                BasicText(
                    text = "向右滑动解锁 ❯❯❯",
                    style = TextStyle(
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = GreenDeep.copy(alpha = textAlpha),
                        textAlign = TextAlign.Center
                    )
                )
            }

            // 滑动手柄
            Box(
                modifier = Modifier
                    .offset { IntOffset((paddingPx + dragOffset.value).roundToInt(), 0) }
                    .size(52.dp)
                    .clip(CircleShape)
                    .background(
                        Brush.linearGradient(
                            listOf(Green, GreenBright)
                        )
                    )
                    .pointerInput(maxDragDistance) {
                        detectHorizontalDragGestures(
                            onDragStart = { },
                            onDragEnd = {
                                coroutineScope.launch {
                                    if (dragOffset.value >= maxDragDistance * 0.70f) {
                                        dragOffset.animateTo(maxDragDistance, tween(120, easing = FastOutSlowInEasing))
                                        if (!unlockedTriggered) {
                                            unlockedTriggered = true
                                            onUnlock()
                                        }
                                    } else {
                                        dragOffset.animateTo(0f, spring(dampingRatio = 0.75f, stiffness = 400f))
                                    }
                                }
                            },
                            onDragCancel = {
                                coroutineScope.launch {
                                    dragOffset.animateTo(0f, spring(dampingRatio = 0.75f, stiffness = 400f))
                                }
                            },
                            onHorizontalDrag = { change, dragAmount ->
                                change.consume()
                                coroutineScope.launch {
                                    val next = (dragOffset.value + dragAmount).coerceIn(0f, maxDragDistance)
                                    dragOffset.snapTo(next)
                                    if (next >= maxDragDistance * 0.98f && !unlockedTriggered) {
                                        unlockedTriggered = true
                                        onUnlock()
                                    }
                                }
                            }
                        )
                    },
                contentAlignment = Alignment.Center
            ) {
                Canvas(modifier = Modifier.size(18.dp)) {
                    val strokeW = 2.6.dp.toPx()
                    val w = size.width
                    val h = size.height
                    val path = Path().apply {
                        moveTo(w * 0.35f, h * 0.22f)
                        lineTo(w * 0.65f, h * 0.50f)
                        lineTo(w * 0.35f, h * 0.78f)
                    }
                    drawPath(
                        path = path,
                        color = Color.White,
                        style = Stroke(width = strokeW, cap = StrokeCap.Round, join = StrokeJoin.Round)
                    )
                }
            }
        }
    }

    // ------------------------------ 底部操作区 ------------------------------

    @Composable
    private fun FooterActions(
        payload: JSONObject,
        expectedTokens: List<String>,
        backdrop: Backdrop,
        groupPayload: Boolean,
        locked: Boolean,
        slideUnlocked: Boolean = true,
        onSlideUnlock: () -> Unit = {},
        resolved: Boolean = false,
        scanFeedback: String? = null,
        secondsLeft: Int,
        onStartScan: () -> Unit,
        onEmergencyTriggered: () -> Unit = {},
        onDismissAll: () -> Unit = {},
    ) {
        if (resolved) {
            // 扫码已自动记录：成功态替代操作按钮，提供显式完成按钮并支持点击即退，伴随 1.5s 自动退出。
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(22.dp))
                        .background(GreenDeep.copy(alpha = 0.12f))
                        .clickable { onDismissAll() }
                        .padding(vertical = 18.dp, horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        GlassText("✓ 已扫码 · 已记录为已服用", 17.sp, FontWeight.SemiBold, GreenDeep)
                        Spacer(Modifier.height(4.dp))
                        BasicText(
                            "1.5 秒后自动返回原应用",
                            style = TextStyle(fontSize = 12.sp, color = GreenDeep.copy(alpha = 0.7f)),
                        )
                    }
                }
                Spacer(Modifier.height(14.dp))
                PrimaryGradientButton(
                    label = "完成并返回",
                    onClick = onDismissAll
                )
            }
            return
        }

        if (locked) {
            ScanLockedCard(expectedTokens, scanFeedback, onStartScan, onEmergencyTriggered)
            return
        }

        if (!slideUnlocked) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                SlideToUnlockBar(
                    onUnlock = onSlideUnlock
                )
                if (!scanFeedback.isNullOrEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    BasicText(
                        scanFeedback,
                        style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Red, textAlign = TextAlign.Center),
                    )
                }
            }
            return
        }

        if (groupPayload) {
            PrimaryGradientButton(label = "全部已服用") { act(MedicationAlarmContract.ACTION_ALL_TAKEN) }
            Spacer(Modifier.height(12.dp))
            GlassButton(
                label = "10 分钟后提醒",
                container = Color.White.copy(alpha = 0.30f),
                contentColor = GreenDeep,
                onClick = { act(MedicationAlarmContract.ACTION_SNOOZE) },
                backdrop = backdrop,
                modifier = Modifier.fillMaxWidth()
            )
        } else {
            PrimaryGradientButton(label = "已服用") { act(MedicationAlarmContract.ACTION_TAKEN) }
            Spacer(Modifier.height(12.dp))
            GlassButton(
                label = "10 分钟后提醒",
                container = Color.White.copy(alpha = 0.30f),
                contentColor = GreenDeep,
                onClick = { act(MedicationAlarmContract.ACTION_SNOOZE) },
                backdrop = backdrop,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(10.dp))
            GhostButton(label = "跳过本次", contentColor = Red) { act(MedicationAlarmContract.ACTION_SKIP) }
        }

        if (secondsLeft >= 0) {
            Spacer(Modifier.height(16.dp))
            BasicText(
                "${secondsLeft} 秒后自动收起",
                style = TextStyle(fontSize = 13.sp, color = InkSoft.copy(alpha = 0.55f), textAlign = TextAlign.Center),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    /** 锁定态卡片：锁定说明 + 扫码主 CTA（渐变填充） */
    @OptIn(ExperimentalFoundationApi::class)
    @Composable
    private fun ScanLockedCard(
        expectedTokens: List<String>,
        scanFeedback: String?,
        onStartScan: () -> Unit,
        onEmergencyTriggered: () -> Unit,
    ) {
        val isCustom = expectedTokens.any { it.isNotEmpty() && !it.startsWith(TOKEN_PREFIX) }
        val interactionSource = remember { MutableInteractionSource() }
        val isPressed by interactionSource.collectIsPressedAsState()
        val scale by animateFloatAsState(
            targetValue = if (isPressed) 0.88f else 1f,
            animationSpec = tween(durationMillis = 150),
            label = "qrScale"
        )

        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp))
                .background(Color.White.copy(alpha = 0.72f))
                .padding(horizontal = 20.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // 暗门：长按二维码图标触发应急解除（基于 Compose 原生 combinedClickable，长按触发震动并进入带应急解除的扫码页）
            Box(
                Modifier
                    .size(96.dp)
                    .scale(scale)
                    .clip(CircleShape)
                    .combinedClickable(
                        interactionSource = interactionSource,
                        indication = null,
                        onClick = {
                            onStartScan()
                        },
                        onLongClick = {
                            try {
                                triggerHapticBypass()
                            } catch (ignored: Throwable) {}
                            onEmergencyTriggered()
                        }
                    ),
                contentAlignment = Alignment.Center
            ) {
                QrGlyph(Modifier.size(68.dp))
            }
            Spacer(Modifier.height(14.dp))
            BasicText(
                "扫码确认服药",
                style = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Ink),
            )
            Spacer(Modifier.height(6.dp))
            BasicText(
                if (isCustom) "请扫描已绑定的药盒、条形码或二维码，完成本次服药确认"
                else "请扫描已绑定的专属二维码或药盒条码，完成本次服药确认",
                style = TextStyle(fontSize = 14.sp, color = InkSoft, textAlign = TextAlign.Center, lineHeight = 21.sp),
            )
            if (!scanFeedback.isNullOrEmpty()) {
                Spacer(Modifier.height(10.dp))
                BasicText(
                    scanFeedback,
                    style = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Red, textAlign = TextAlign.Center),
                )
            }
            Spacer(Modifier.height(18.dp))
            PrimaryGradientButton(
                label = "立即扫码验证",
                onClick = onStartScan
            )
        }
    }

    /** 应急解除暗门对话框（长按二维码触发） */
    @Composable
    private fun EmergencyBypassDialog(
        groupPayload: Boolean,
        onSnooze: () -> Unit,
        onSkip: () -> Unit,
        onForceStop: () -> Unit,
        onCancel: () -> Unit,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.60f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = { /* 阻断外部点击穿透 */ }
                ),
            contentAlignment = Alignment.Center
        ) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 28.dp)
                    .clip(RoundedCornerShape(26.dp))
                    .background(Color.White)
                    .padding(horizontal = 22.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                BasicText(
                    "紧急解除用药提醒",
                    style = TextStyle(
                        fontSize = 19.sp,
                        fontWeight = FontWeight.Bold,
                        color = Ink,
                        textAlign = TextAlign.Center
                    )
                )
                Spacer(Modifier.height(8.dp))
                BasicText(
                    "已触发应急暗门。如遇条码遗失或无法扫描等情况，可选择以下方式解除当前提醒：",
                    style = TextStyle(
                        fontSize = 14.sp,
                        color = InkSoft,
                        textAlign = TextAlign.Center,
                        lineHeight = 20.sp
                    )
                )
                Spacer(Modifier.height(20.dp))
                PrimaryGradientButton(
                    label = "延后 10 分钟",
                    onClick = onSnooze
                )
                Spacer(Modifier.height(10.dp))
                GhostButton(
                    label = if (groupPayload) "跳过本组服药" else "跳过本次服药",
                    contentColor = InkSoft,
                    onClick = onSkip
                )
                Spacer(Modifier.height(10.dp))
                GhostButton(
                    label = "强行停止提醒",
                    contentColor = Red,
                    onClick = onForceStop
                )
                Spacer(Modifier.height(10.dp))
                BasicText(
                    "取消",
                    style = TextStyle(
                        fontSize = 15.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = InkSoft.copy(alpha = 0.65f),
                        textAlign = TextAlign.Center
                    ),
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .clickable(onClick = onCancel)
                        .padding(horizontal = 20.dp, vertical = 8.dp)
                )
            }
        }
    }

    // ------------------------------ 扫码取景器 ------------------------------

    @Composable
    private fun ScannerOverlay(
        expectedTokens: List<String>,
        showEmergencyBypass: Boolean = false,
        onClose: () -> Unit,
        onEmergencyTriggered: () -> Unit,
        onMatched: () -> Unit,
    ) {
        val cameraPermissionGranted = cameraPermissionGranted.value
        val scanFeedback = remember { mutableStateOf<String?>(null) }
        val context = LocalContext.current

        LaunchedEffect(scanFeedback.value) {
            if (scanFeedback.value != null) {
                delay(2500)
                scanFeedback.value = null
            }
        }

        Box(Modifier.fillMaxSize()) {
            if (cameraPermissionGranted) {
                CameraScanner(
                    expectedTokens = expectedTokens,
                    onMismatch = {
                        scanFeedback.value = "这不是配对的解锁码或药盒条码"
                    },
                    onMatched = onMatched,
                    modifier = Modifier.matchParentSize(),
                )
                // 上暗下暗遮罩，中央留给取景框
                Canvas(
                    Modifier
                        .matchParentSize()
                        .graphicsLayer(alpha = 0.62f)
                ) {
                    drawRect(Color.Black)
                    drawRoundRect(
                        color = Color.Transparent,
                        topLeft = Offset(size.width / 2 - size.minDimension * 0.36f, size.height / 2 - size.minDimension * 0.36f),
                        size = androidx.compose.ui.geometry.Size(size.minDimension * 0.72f, size.minDimension * 0.72f),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(48f, 48f),
                        blendMode = androidx.compose.ui.graphics.BlendMode.DstOut,
                    )
                }
            }

            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.weight(1f))
                if (!cameraPermissionGranted) {
                    BasicText(
                        "相机权限未授予",
                        style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White),
                    )
                    Spacer(Modifier.height(8.dp))
                    BasicText(
                        "需要使用相机扫描解锁二维码或药盒条码",
                        style = TextStyle(fontSize = 14.sp, color = Color.White.copy(alpha = 0.85f)),
                    )
                    Spacer(Modifier.height(20.dp))
                    Box(
                        Modifier
                            .clip(Capsule())
                            .background(Color.White)
                            .clickable { requestCameraPermissionSafely() }
                            .padding(horizontal = 26.dp, vertical = 14.dp)
                    ) {
                        BasicText(
                            "允许相机",
                            style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = GreenDeep),
                        )
                    }
                } else {
                    ViewfinderFrame(Modifier.size(244.dp))
                    Spacer(Modifier.height(18.dp))
                    val isCustom = expectedTokens.any { it.isNotEmpty() && !it.startsWith(TOKEN_PREFIX) }
                    BasicText(
                        scanFeedback.value ?: if (isCustom) "请对准已绑定的条形码或二维码" else "请对准贴好的解锁二维码或药盒条码",
                        style = TextStyle(
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (scanFeedback.value != null) Color(0xFFFFB4AB) else Color.White.copy(alpha = 0.92f),
                        ),
                    )
                }
                Spacer(Modifier.weight(1f))
                Row(
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        Modifier
                            .clip(Capsule())
                            .background(Color.White.copy(alpha = 0.16f))
                            .clickable { onClose() }
                            .padding(horizontal = 24.dp, vertical = 13.dp)
                    ) {
                        BasicText(
                            "返回提醒页",
                            style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White),
                        )
                    }
                    if (showEmergencyBypass) {
                        Spacer(Modifier.width(16.dp))
                        Box(
                            Modifier
                                .clip(Capsule())
                                .background(Color.White.copy(alpha = 0.16f))
                                .clickable { onEmergencyTriggered() }
                                .padding(horizontal = 20.dp, vertical = 13.dp)
                        ) {
                            BasicText(
                                "应急解除",
                                style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFFFB4AB)),
                            )
                        }
                    }
                }
            }
        }
    }

    /** 取景框：白色圆角描边 + 上下扫动的激光线 */
    @Composable
    private fun ViewfinderFrame(modifier: Modifier) {
        val transition = rememberInfiniteTransition(label = "laser")
        val progress by transition.animateFloat(
            initialValue = 0f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(tween(1800, easing = LinearEasing)),
            label = "laserProgress",
        )
        Canvas(modifier.clip(RoundedCornerShape(28.dp))) {
            val stroke = 3.dp.toPx()
            drawRoundRect(
                color = Color.White,
                style = Stroke(width = stroke),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(28.dp.toPx(), 28.dp.toPx()),
            )
            val y = (size.height - stroke * 2) * progress + stroke
            drawLine(
                brush = Brush.horizontalGradient(listOf(Color.Transparent, GreenBright, Color.Transparent)),
                start = Offset(stroke, y),
                end = Offset(size.width - stroke, y),
                strokeWidth = 3.dp.toPx(),
            )
        }
    }

    /**
     * CameraX 取景 + ZXing 条码与二维码解码。
     * analyzer 回调在单线程执行器上跑；ImageProxy 在 finally 中 close；
     * KEEP_ONLY_LATEST 策略下解码器忙时自动丢帧，无需额外节流。
     */
    @Composable
    private fun CameraScanner(
        expectedTokens: List<String>,
        onMatched: () -> Unit,
        onMismatch: () -> Unit,
        modifier: Modifier = Modifier,
    ) {
        val context = LocalContext.current
        val previewView = remember { PreviewView(context) }
        val scanAlreadyMatched = remember { AtomicBoolean(false) }

        val currentExpectedTokens by rememberUpdatedState(expectedTokens)
        val currentOnMatched by rememberUpdatedState(onMatched)
        val currentOnMismatch by rememberUpdatedState(onMismatch)

        DisposableEffect(Unit) {
            var isDisposed = false
            val executor = Executors.newSingleThreadExecutor()
            var boundProvider: ProcessCameraProvider? = null
            // 解码器会话级复用：hints 只装一次，帧间由 decodeLuminance 的 reset() 复位；
            // 每帧 new MultiFormatReader 的分配开销在低端机上会明显拖慢出帧节奏。
            val barcodeReader = MultiFormatReader().apply { setHints(BARCODE_HINTS) }

            ProcessCameraProvider.getInstance(context).addListener({
                if (isDisposed || isFinishing || isDestroyed || executor.isShutdown) return@addListener
                try {
                    val cameraProvider = ProcessCameraProvider.getInstance(context).get()
                    boundProvider = cameraProvider
                    if (isDisposed || isFinishing || isDestroyed || executor.isShutdown) {
                        cameraProvider.unbindAll()
                        return@addListener
                    }

                    val preview = Preview.Builder().build()
                        .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                    val analysis = ImageAnalysis.Builder()
                        .setTargetResolution(Size(1280, 720))
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also {
                            it.setAnalyzer(executor) { proxy ->
                                analyzeBarcodeFrame(
                                    proxy,
                                    currentExpectedTokens,
                                    barcodeReader,
                                    scanAlreadyMatched,
                                    currentOnMatched,
                                    currentOnMismatch
                                )
                            }
                        }

                    cameraProvider.unbindAll()
                    val camera = cameraProvider.bindToLifecycle(
                        this@MedicationAlarmActivity,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )

                    // 自动中心对焦
                    try {
                        val factory = SurfaceOrientedMeteringPointFactory(1f, 1f)
                        val centerPoint = factory.createPoint(0.5f, 0.5f)
                        val action = FocusMeteringAction.Builder(centerPoint, FocusMeteringAction.FLAG_AF).build()
                        camera.cameraControl.startFocusAndMetering(action)
                    } catch (ignored: Throwable) {
                    }

                    // 触摸对焦支持
                    previewView.setOnTouchListener { v, event ->
                        when (event.action) {
                            MotionEvent.ACTION_DOWN -> true
                            MotionEvent.ACTION_UP -> {
                                try {
                                    val viewFactory = previewView.meteringPointFactory
                                    val point = viewFactory.createPoint(event.x, event.y)
                                    val touchAction = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF).build()
                                    camera.cameraControl.startFocusAndMetering(touchAction)
                                    v.performClick()
                                } catch (ignored: Throwable) {
                                }
                                true
                            }
                            else -> false
                        }
                    }
                } catch (ignored: Throwable) {
                }
            }, ContextCompat.getMainExecutor(context))

            onDispose {
                isDisposed = true
                try {
                    previewView.setOnTouchListener(null)
                    boundProvider?.unbindAll()
                } catch (ignored: Throwable) {
                }
                try {
                    executor.shutdownNow()
                } catch (ignored: Throwable) {
                }
            }
        }

        AndroidView(factory = { previewView }, modifier = modifier)
    }

    /** 会话级复用的解码提示集：格式白名单 + TRY_HARDER，避免每帧重建 map 与 reader。 */
    private val BARCODE_HINTS: Map<DecodeHintType, Any> = mapOf(
        DecodeHintType.TRY_HARDER to true,
        DecodeHintType.POSSIBLE_FORMATS to listOf(
            BarcodeFormat.QR_CODE,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.AZTEC,
            BarcodeFormat.PDF_417,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.ITF
        )
    )

    /** Y 平面 → ZXing；逐帧在后台线程执行，匹配结果统一抛回主线程。 */
    private fun analyzeBarcodeFrame(
        proxy: ImageProxy,
        expectedTokens: List<String>,
        reader: MultiFormatReader,
        scanAlreadyMatched: AtomicBoolean,
        onMatched: () -> Unit,
        onMismatch: () -> Unit,
    ) {
        try {
            if (isFinishing || isDestroyed || scanAlreadyMatched.get()) {
                return
            }

            val media = proxy.image ?: return

            val width = proxy.width
            val height = proxy.height
            val planes = proxy.planes
            if (planes.isEmpty()) return
            val plane0 = planes[0]
            val rowStride = plane0.rowStride
            val buffer = plane0.buffer
            buffer.rewind()

            // 处理 rowStride > width 的对齐填充：逐行拷贝有效像素，严防 BufferUnderflowException
            val data = ByteArray(width * height)
            if (rowStride == width && buffer.remaining() >= data.size) {
                buffer.get(data)
            } else {
                var offset = 0
                val bufferLimit = buffer.limit()
                for (row in 0 until height) {
                    val pos = row * rowStride
                    if (pos >= bufferLimit) break
                    buffer.position(pos)
                    val available = buffer.remaining()
                    val copyLen = minOf(width, available)
                    if (copyLen > 0) {
                        buffer.get(data, offset, copyLen)
                    }
                    offset += width
                }
            }

            // CameraX rotationDegrees 是使画面直立所需的顺时针角度。
            // 注意：ZXing 的 PlanarYUVLuminanceSource 不支持 rotateCounterClockwise()（会抛出 UnsupportedOperationException）！
            // 因此必须在构建 LuminanceSource 之前直接对灰度像素数组进行物理旋转。
            val rotation = proxy.imageInfo.rotationDegrees
            val rotatedData: ByteArray
            val rotatedWidth: Int
            val rotatedHeight: Int

            when (rotation) {
                90 -> {
                    // 顺时针旋转 90 度：新宽度为原 height，新高度为原 width
                    rotatedWidth = height
                    rotatedHeight = width
                    rotatedData = ByteArray(width * height)
                    for (y in 0 until height) {
                        val yOffset = y * width
                        for (x in 0 until width) {
                            rotatedData[x * height + (height - 1 - y)] = data[yOffset + x]
                        }
                    }
                }
                180 -> {
                    // 顺时针旋转 180 度
                    rotatedWidth = width
                    rotatedHeight = height
                    rotatedData = ByteArray(width * height)
                    val total = width * height
                    for (i in 0 until total) {
                        rotatedData[total - 1 - i] = data[i]
                    }
                }
                270 -> {
                    // 顺时针旋转 270 度（逆时针 90 度）
                    rotatedWidth = height
                    rotatedHeight = width
                    rotatedData = ByteArray(width * height)
                    for (y in 0 until height) {
                        val yOffset = y * width
                        for (x in 0 until width) {
                            rotatedData[(width - 1 - x) * height + y] = data[yOffset + x]
                        }
                    }
                }
                else -> {
                    rotatedWidth = width
                    rotatedHeight = height
                    rotatedData = data
                }
            }

            val source: LuminanceSource =
                PlanarYUVLuminanceSource(rotatedData, rotatedWidth, rotatedHeight, 0, 0, rotatedWidth, rotatedHeight, false)

            var raw = decodeLuminance(source, reader)

            // 全图未识别时，尝试裁剪中央取景框区域（排除背景干扰与反光，提高局部对比度）
            if (raw == null && source.isCropSupported) {
                try {
                    val cropW = (source.width * 0.72).toInt()
                    val cropH = (source.height * 0.72).toInt()
                    val cropLeft = (source.width - cropW) / 2
                    val cropTop = (source.height - cropH) / 2
                    val croppedSource = source.crop(cropLeft, cropTop, cropW, cropH)
                    raw = decodeLuminance(croppedSource, reader)
                } catch (ignored: Throwable) {
                }
            }

            // 若旋转图仍未识别且存在旋转，使用未旋转原图再试一次（防止某些机型传感器旋转角度异常）
            if (raw == null && rotation != 0) {
                try {
                    val rawSource: LuminanceSource =
                        PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)
                    raw = decodeLuminance(rawSource, reader)
                    if (raw == null && rawSource.isCropSupported) {
                        val cropW = (width * 0.72).toInt()
                        val cropH = (height * 0.72).toInt()
                        raw = decodeLuminance(rawSource.crop((width - cropW) / 2, (height - cropH) / 2, cropW, cropH), reader)
                    }
                } catch (ignored: Throwable) {
                }
            }

            val scannedText = raw?.trim()
            when {
                scannedText == null -> Unit
                isFinishing || isDestroyed || scanAlreadyMatched.get() -> Unit
                MedicationAlarmContract.isAnyTokenMatch(scannedText, expectedTokens) -> {
                    if (scanAlreadyMatched.compareAndSet(false, true)) {
                        Log.i("MedicationAlarm", "Scan matched! Scanned=[$scannedText], ExpectedList=$expectedTokens")
                        runOnUiThread { onMatched() }
                    }
                }
                else -> {
                    Log.w("MedicationAlarm", "Scan mismatch! Scanned=[$scannedText], ExpectedList=$expectedTokens")
                    runOnUiThread { onMismatch() }
                }
            }
        } catch (t: Throwable) {
            Log.e("MedicationAlarm", "Frame analysis failed: ${t.message}", t)
        } finally {
            proxy.close()
        }
    }

    /** 结合多种二值化策略（默认混合、黑底白码反色、全局直方图），最大化提升生活环境条码与二维码识别率 */
    private fun decodeLuminance(source: LuminanceSource, reader: MultiFormatReader): String? {
        // 1. 默认混合二值化器
        try {
            val result = reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))
            return result.text
        } catch (ignored: Exception) {
        } finally {
            reader.reset()
        }

        // 2. 反色解码（支持手机暗黑模式屏幕、黑底白字包装）
        try {
            val result = reader.decodeWithState(BinaryBitmap(HybridBinarizer(source.invert())))
            return result.text
        } catch (ignored: Exception) {
        } finally {
            reader.reset()
        }

        // 3. 全局直方图二值化（针对药盒反光、低对比度条码）
        try {
            val result = reader.decodeWithState(BinaryBitmap(GlobalHistogramBinarizer(source)))
            return result.text
        } catch (ignored: Exception) {
        } finally {
            reader.reset()
        }

        return null
    }

    // ------------------------------ 装饰层 ------------------------------

    /** 柔光渐变网：记录进 LayerBackdrop，玻璃按钮采样其边缘折射流光。 */
    @Composable
    private fun DecorLayer(modifier: Modifier) {
        Box(modifier) {
            Box(
                Modifier
                    .offset { androidx.compose.ui.unit.IntOffset((-40).dp.roundToPx(), (-120).dp.roundToPx()) }
                    .size(340.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(Brush.radialGradient(listOf(GlowGreen, Color.Transparent), radius = 560f))
            )
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(y = (-60).dp)
                    .size(300.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(Brush.radialGradient(listOf(GlowTeal, Color.Transparent), radius = 520f))
            )
            Box(
                Modifier
                    .align(Alignment.BottomStart)
                    .offset(x = (-50).dp, y = 110.dp)
                    .size(380.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(Brush.radialGradient(listOf(GlowLilac, Color.Transparent), radius = 620f))
            )
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .offset(y = 140.dp)
                    .size(320.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(Brush.radialGradient(listOf(GlowGreen, Color.Transparent), radius = 560f))
            )
        }
    }

    // ------------------------------ 按钮组 ------------------------------

    /** 主 CTA：实色渐变胶囊 + 顶部内高光 + 按压缩放 */
    @Composable
    private fun PrimaryGradientButton(label: String, onClick: () -> Unit) {
        val interaction = remember { MutableInteractionSource() }
        val pressed by interaction.collectIsPressedAsState()
        val scale by animateFloatAsState(if (pressed) 0.97f else 1f, label = "pressScale")
        Box(
            Modifier
                .fillMaxWidth()
                .height(58.dp)
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .clip(Capsule())
                .background(
                    Brush.horizontalGradient(listOf(GreenBright, Green))
                )
                .clickable(interactionSource = interaction, indication = null, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            // 顶部受光高光条
            Canvas(Modifier.matchParentSize()) {
                drawRect(
                    Brush.verticalGradient(
                        colors = listOf(
                            Color.White.copy(alpha = 0.42f),
                            Color.Transparent,
                        ),
                        endY = size.height * 0.55f,
                    )
                )
            }
            BasicText(
                label,
                style = TextStyle(
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    shadow = Shadow(color = Color(0x33000000), blurRadius = 8f),
                ),
            )
        }
    }

    /** 玻璃胶囊按钮（vibrancy + blur + lens，官方 LiquidButton 同款效果组合） */
    @Composable
    private fun GlassButton(
        label: String,
        container: Color,
        contentColor: Color,
        onClick: () -> Unit,
        backdrop: Backdrop,
        modifier: Modifier = Modifier,
        useLens: Boolean = true,
    ) {
        Box(
            modifier
                .height(56.dp)
                .drawBackdrop(
                    backdrop = backdrop,
                    shape = { Capsule() },
                    effects = {
                        vibrancy()
                        blur(4f.dp.toPx())
                        if (useLens) lens(12f.dp.toPx(), 24f.dp.toPx())
                    },
                    onDrawSurface = {
                        if (container != Color.Transparent) drawRect(container)
                        drawRect(
                            Brush.verticalGradient(
                                colors = listOf(
                                    Color.White.copy(alpha = 0.55f),
                                    Color.White.copy(alpha = 0.08f),
                                    Color.Transparent
                                ),
                                endY = size.height * 0.5f
                            )
                        )
                    }
                )
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center
        ) {
            GlassText(label, 18.sp, FontWeight.SemiBold, contentColor)
        }
    }

    /** 幽灵按钮：透明背景 + 文字色胶囊（危险/次要操作） */
    @Composable
    private fun GhostButton(label: String, contentColor: Color, onClick: () -> Unit) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(52.dp)
                .clip(Capsule())
                .background(contentColor.copy(alpha = 0.07f))
                .clickable(onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(
                label,
                style = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = contentColor),
            )
        }
    }

    /** 单药行小操作钮：同款玻璃材质，44dp 高。 */
    @Composable
    private fun PillAction(
        label: String,
        fg: Color,
        backdrop: Backdrop,
        onClick: () -> Unit
    ) {
        Box(
            Modifier
                .height(44.dp)
                .drawBackdrop(
                    backdrop = backdrop,
                    shape = { Capsule() },
                    effects = {
                        vibrancy()
                        blur(3f.dp.toPx())
                        lens(9f.dp.toPx(), 18f.dp.toPx())
                    },
                    onDrawSurface = {
                        drawRect(Color.White.copy(alpha = 0.42f))
                    }
                )
                .clickable(onClick = onClick)
                .padding(horizontal = 14.dp),
            contentAlignment = Alignment.Center
        ) {
            GlassText(label, 14.sp, FontWeight.SemiBold, fg)
        }
    }

    /** 手绘二维码示意图形（锁定卡片顶部的识别符号） */
    @Composable
    private fun QrGlyph(modifier: Modifier) {
        Canvas(modifier) {
            val unit = size.minDimension / 7f
            val corner = androidx.compose.ui.geometry.CornerRadius(unit * 0.9f, unit * 0.9f)

            fun finderBlock(x: Int, y: Int) {
                drawRoundRect(
                    color = GreenDeep,
                    topLeft = Offset(x * unit, y * unit),
                    size = androidx.compose.ui.geometry.Size(unit * 3, unit * 3),
                    cornerRadius = corner,
                )
                drawRoundRect(
                    color = Background,
                    topLeft = Offset((x + 1) * unit, (y + 1) * unit),
                    size = androidx.compose.ui.geometry.Size(unit, unit),
                    cornerRadius = corner,
                )
            }
            finderBlock(0, 0)
            finderBlock(4, 0)
            finderBlock(0, 4)
            drawRoundRect(
                color = GreenBright,
                topLeft = Offset(4.4f * unit, 4.4f * unit),
                size = androidx.compose.ui.geometry.Size(unit * 2.2f, unit * 2.2f),
                cornerRadius = corner,
            )
        }
    }

    /** 文字（foundation.BasicText，避免引入无稳定版的 material3）。 */
    @Composable
    private fun GlassText(
        text: String,
        size: androidx.compose.ui.unit.TextUnit,
        weight: FontWeight,
        color: Color,
        modifier: Modifier = Modifier,
        align: TextAlign = TextAlign.Unspecified,
        lineHeight: androidx.compose.ui.unit.TextUnit? = null,
    ) {
        BasicText(
            text = text,
            modifier = modifier,
            style = TextStyle(
                fontSize = size,
                fontWeight = weight,
                color = color,
                textAlign = align,
                lineHeight = lineHeight ?: TextStyle.Default.lineHeight,
            ),
        )
    }

    // ------------------------------ 动作分发 ------------------------------

    /** 单药行按钮：向 data 注入 occurrenceId 后入队，TS 侧据此记录到具体 occurrence。 */
    private fun queueOccurrence(action: String, occurrenceId: String) {
        MedboxAccessibilityService.setGuarded(false)
        autoResolvedState.value = true
        clearDelayedTasks()
        silenceAlert()
        val payloadsToAct = getActivePayloadsSnapshot().ifEmpty {
            listOfNotNull(payloadState.value)
        }
        for (p in payloadsToAct) {
            MedicationAlarmContract.queueOccurrenceAction(this, action, p, occurrenceId)
        }
        finishAllAlarms(this)
    }

    private fun formatTime(epochMillis: Long): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epochMillis))

    private fun act(action: String) {
        MedboxAccessibilityService.setGuarded(false)
        autoResolvedState.value = true
        clearDelayedTasks()
        silenceAlert()
        val payloadsToAct = getActivePayloadsSnapshot().ifEmpty {
            listOfNotNull(payloadState.value)
        }
        for (p in payloadsToAct) {
            try {
                MedicationAlarmContract.handleAction(this, action, p)
            } catch (ignored: JSONException) {
            }
        }
        finishAllAlarms(this)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            when (event.keyCode) {
                KeyEvent.KEYCODE_VOLUME_DOWN,
                KeyEvent.KEYCODE_VOLUME_UP -> {
                    // 按物理音量键仅静音当前警报铃声与振动，页面在屏幕上保持显示，用户仍须在屏幕上完成操作
                    silenceAlert()
                    return true
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onDestroy() {
        activeActivities.remove(this)
        try {
            unregisterReceiver(finishAllReceiver)
        } catch (ignored: Throwable) {
        }
        clearDelayedTasks()
        MedboxAccessibilityService.setGuarded(false)
        silenceAlert()
        super.onDestroy()
    }

    companion object {
        private val activeActivities = java.util.Collections.synchronizedSet(mutableSetOf<MedicationAlarmActivity>())
        private val activePayloads = java.util.Collections.synchronizedList(mutableListOf<JSONObject>())

        fun recordActivePayload(payload: JSONObject?) {
            if (payload == null) return
            synchronized(activePayloads) {
                val newId = payload.optInt("id", -1)
                val existingIndex = if (newId != -1) {
                    activePayloads.indexOfFirst { it.optInt("id", -1) == newId }
                } else -1
                if (existingIndex >= 0) {
                    activePayloads[existingIndex] = payload
                } else {
                    activePayloads.add(payload)
                }
            }
        }

        fun getActivePayloadsSnapshot(): List<JSONObject> {
            return synchronized(activePayloads) { ArrayList(activePayloads) }
        }

        @JvmStatic
        @JvmOverloads
        fun finishAllAlarms(context: Context? = null) {
            val ctx = context ?: synchronized(activeActivities) { activeActivities.firstOrNull()?.applicationContext }
            // 1. 取消系统通知栏中的所有闹钟/强提醒通知，防止通知栏残留全屏意图导致再次弹出
            ctx?.let { MedicationAlarmContract.cancelAllAlarmNotifications(it) }

            // 2. 发送应用内全局广播，通知可能存在于其他任务栈的闹钟页面自毁
            ctx?.let { c ->
                try {
                    val broadcastIntent = Intent(MedicationAlarmContract.ACTION_FINISH_ALL_ALARMS)
                        .setPackage(c.packageName)
                    c.sendBroadcast(broadcastIntent)
                } catch (ignored: Throwable) {
                }
            }

            // 3. 关闭当前进程内登记的所有 MedicationAlarmActivity 实例
            synchronized(activeActivities) {
                val list = activeActivities.toList()
                list.forEach { act ->
                    try {
                        act.dismissThisActivity()
                    } catch (ignored: Throwable) {
                        try { act.finish() } catch (ignored2: Throwable) {}
                    }
                }
                activeActivities.clear()
            }

            // 4. 清除活跃载荷列表
            synchronized(activePayloads) {
                activePayloads.clear()
            }

            // 5. 解除无障碍前台锁定守护与停止警报声音
            MedboxAccessibilityService.setGuarded(false)
            AlarmAudioPlayer.stop()
        }

        /** 解锁码前缀必须与 TS alarmScanVerify.ts 一致 */
        const val TOKEN_PREFIX = "medbox-unlock:"

        // 与 web 端同一套绿色系色板（#17745B 主绿 / 浅底 / 墨色文字）
        val Green = Color(0xFF17745B)
        val GreenDeep = Color(0xFF17603F)
        val GreenBright = Color(0xFF1DA87C)
        val Ink = Color(0xFF182D26)
        val InkSoft = Color(0xFF3C524A)
        val Red = Color(0xFFAE2F37)
        val Background = Color(0xFFF4F9F6)
        val GlowTeal = Color(0xFF9ED8E6).copy(alpha = 0.50f)
        val GlowGreen = Color(0xFF9FD8C3).copy(alpha = 0.55f)
        val GlowLilac = Color(0xFFC6C5F2).copy(alpha = 0.42f)

        const val ALARM_EYEBROW = "用药提醒"
    }
}
