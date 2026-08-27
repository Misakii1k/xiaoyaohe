package com.medbox.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.shapes.Capsule
import kotlinx.coroutines.delay
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

    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null

    // Compose 可观察载荷：onNewIntent 更新后界面自动重建
    private var payloadState = mutableStateOf<JSONObject?>(null)

    /** 闹钟会话计数：onNewIntent 换载荷时 +1，驱动解锁态/取景器/倒计时全部复位 */
    private var scanSession = mutableIntStateOf(0)

    // 相机权限结果在 Activity 构建期注册（ComponentActivity 规范）
    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> cameraPermissionGranted.value = granted }

    private val cameraPermissionGranted = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        try {
            payloadState.value = MedicationAlarmContract.payloadFrom(intent)
        } catch (error: JSONException) {
            finish()
            return
        }
        setContent {
            val payload = payloadState.value ?: return@setContent
            AlarmRoot(payload)
        }
        startAlert()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        try {
            // singleTop：同实例被新的闹钟再次拉起时换载荷并重建页面。
            // scanSession 自增让「解锁态 / 取景器 / 倒计时」全部回到初始状态。
            payloadState.value = MedicationAlarmContract.payloadFrom(intent)
            scanSession.value += 1
            startAlert()
        } catch (ignored: JSONException) {
        }
    }

    // ============================== UI（Compose） ==============================

    @Composable
    private fun AlarmRoot(payload: JSONObject) {
        val requireScan = MedicationAlarmContract.requiresScanVerification(payload)
        val expectedToken = MedicationAlarmContract.scanTokenOf(payload)
        val mode = payload.optString("mode", "strong")

        val scanUnlocked = remember { mutableStateOf(false) }
        val showScanner = remember { mutableStateOf(false) }
        val scanFeedback = remember { mutableStateOf<String?>(null) }

        // 会话切换：复位解锁/取景/反馈
        LaunchedEffect(scanSession.value) {
            scanUnlocked.value = false
            showScanner.value = false
            scanFeedback.value = null
        }

        val locked = requireScan && !scanUnlocked.value

        // 自动关闭倒计时：strong 且未要求扫码时不自动关；进入取景器暂停计数
        val autoCloseSeconds: Int? = when {
            requireScan -> null
            mode == "strong" -> null
            mode == "fullscreen-persistent" -> 60
            else -> 10
        }
        val secondsLeft = remember(scanSession.value, autoCloseSeconds) {
            mutableIntStateOf(autoCloseSeconds ?: -1)
        }
        LaunchedEffect(scanSession.value) {
            if (autoCloseSeconds == null) return@LaunchedEffect
            var left = autoCloseSeconds
            while (true) {
                if (showScanner.value) {
                    delay(200)
                    continue
                }
                delay(1_000)
                left -= 1
                secondsLeft.value = left
                if (left <= 0) {
                    finish()
                    return@LaunchedEffect
                }
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

                val data = payload.optJSONObject("data")
                Spacer(Modifier.height(18.dp))
                if (data != null && "reminder-group" == data.optString("kind")) {
                    GroupBody(data, backdrop, locked)
                } else {
                    LegacyBody(payload, data)
                }

                Spacer(Modifier.height(24.dp))
                FooterActions(
                    payload = payload,
                    backdrop = backdrop,
                    groupPayload = data != null && "reminder-group" == data.optString("kind"),
                    locked = locked,
                    secondsLeft = if (autoCloseSeconds != null) secondsLeft.value else -1,
                    onStartScan = {
                        scanFeedback.value = null
                        if (cameraPermissionGranted.value ||
                            ContextCompat.checkSelfPermission(this@MedicationAlarmActivity, Manifest.permission.CAMERA)
                            == PackageManager.PERMISSION_GRANTED
                        ) {
                            cameraPermissionGranted.value = true
                            showScanner.value = true
                        } else {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    },
                )
                Spacer(Modifier.height(28.dp))
            }

            if (showScanner.value) {
                ScannerOverlay(
                    expectedToken = expectedToken,
                    onClose = {
                        showScanner.value = false
                        scanFeedback.value = null
                    },
                    onMatched = {
                        showScanner.value = false
                        scanUnlocked.value = true
                        scanFeedback.value = "已验证 · 操作已解锁"
                        vibrateUnlock()
                    },
                )
            }
        }
    }

    /** 扫码成功后的短振动反馈 */
    private fun vibrateUnlock() {
        try {
            vibrator?.cancel()
            vibrator?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 60, 80, 60), -1))
            val pattern = longArrayOf(0, 700, 250, 700, 250, 700)
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } catch (ignored: Throwable) {
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

    private fun startAlert() {
        try {
            ringtone = RingtoneManager.getRingtone(this, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
            ringtone?.play()
        } catch (ignored: Throwable) {
        }
        try {
            vibrator = getSystemService(VIBRATOR_SERVICE) as Vibrator
            val pattern = longArrayOf(0, 700, 250, 700, 250, 700)
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } catch (ignored: Throwable) {
        }
    }

    // ------------------------------ 主体内容 ------------------------------

    /** 组载荷（V2）：头部时段+时间，中部每药一行，操作在底部统一。 */
    @Composable
    private fun GroupBody(data: JSONObject, backdrop: Backdrop, locked: Boolean) {
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
                MedicationRow(occurrence, backdrop, locked)
                Spacer(Modifier.height(10.dp))
            }
        }
    }

    @Composable
    private fun MedicationRow(occurrence: JSONObject, backdrop: Backdrop, locked: Boolean) {
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
            if (!locked && occurrenceId.isNotEmpty()) {
                Spacer(Modifier.width(10.dp))
                PillAction(label = "已服", fg = GreenDeep, backdrop = backdrop) {
                    queueOccurrence(MedicationAlarmContract.ACTION_TAKEN, occurrenceId)
                }
                Spacer(Modifier.width(8.dp))
                PillAction(label = "跳过", fg = Red, backdrop = backdrop) {
                    queueOccurrence(MedicationAlarmContract.ACTION_SKIP, occurrenceId)
                }
            } else if (locked) {
                Spacer(Modifier.width(10.dp))
                LockBadge()
            }
        }
    }

    /** 锁定态行内徽标：提示该行需扫码后才能操作 */
    @Composable
    private fun LockBadge() {
        Box(
            Modifier
                .clip(Capsule())
                .background(GreenDeep.copy(alpha = 0.08f))
                .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
            BasicText(
                "待解锁",
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

    // ------------------------------ 底部操作区 ------------------------------

    @Composable
    private fun FooterActions(
        payload: JSONObject,
        backdrop: Backdrop,
        groupPayload: Boolean,
        locked: Boolean,
        secondsLeft: Int,
        onStartScan: () -> Unit,
    ) {
        if (locked) {
            ScanLockedCard(onStartScan)
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
    @Composable
    private fun ScanLockedCard(onStartScan: () -> Unit) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp))
                .background(Color.White.copy(alpha = 0.72f))
                .padding(horizontal = 20.dp, vertical = 22.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            QrGlyph(Modifier.size(56.dp))
            Spacer(Modifier.height(12.dp))
            BasicText(
                "需要扫码解除",
                style = TextStyle(fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Ink),
            )
            Spacer(Modifier.height(6.dp))
            BasicText(
                "起身走到贴有解锁二维码的地方\n扫描配对码后才能完成服药",
                style = TextStyle(fontSize = 14.sp, color = InkSoft, textAlign = TextAlign.Center, lineHeight = 21.sp),
            )
            Spacer(Modifier.height(18.dp))
            PrimaryGradientButton(label = "扫描解锁二维码", onClick = onStartScan)
        }
    }

    // ------------------------------ 扫码取景器 ------------------------------

    @Composable
    private fun ScannerOverlay(
        expectedToken: String,
        onClose: () -> Unit,
        onMatched: () -> Unit,
    ) {
        val cameraPermissionGranted = cameraPermissionGranted.value
        val scanFeedback = remember { mutableStateOf<String?>(null) }

        Box(Modifier.fillMaxSize()) {
            if (cameraPermissionGranted) {
                CameraScanner(
                    expectedToken = expectedToken,
                    onMismatch = {
                        scanFeedback.value = "这不是配对的解锁码"
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
                        "需要使用相机扫描解锁二维码",
                        style = TextStyle(fontSize = 14.sp, color = Color.White.copy(alpha = 0.85f)),
                    )
                    Spacer(Modifier.height(20.dp))
                    Box(
                        Modifier
                            .clip(Capsule())
                            .background(Color.White)
                            .clickable { cameraPermissionLauncher.launch(Manifest.permission.CAMERA) }
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
                    BasicText(
                        scanFeedback.value ?: "请对准贴好的解锁二维码",
                        style = TextStyle(
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (scanFeedback.value != null) Color(0xFFFFB4AB) else Color.White.copy(alpha = 0.92f),
                        ),
                    )
                }
                Spacer(Modifier.weight(1f))
                Box(
                    Modifier
                        .clip(Capsule())
                        .background(Color.White.copy(alpha = 0.16f))
                        .clickable { onClose() }
                        .padding(horizontal = 30.dp, vertical = 13.dp)
                ) {
                    BasicText(
                        "返回提醒页",
                        style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = Color.White),
                    )
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
     * CameraX 取景 + ZXing QR 解码。
     * analyzer 回调在单线程执行器上跑；ImageProxy 在 finally 中 close；
     * KEEP_ONLY_LATEST 策略下解码器忙时自动丢帧，无需额外节流。
     */
    @Composable
    private fun CameraScanner(
        expectedToken: String,
        onMatched: () -> Unit,
        onMismatch: () -> Unit,
        modifier: Modifier = Modifier,
    ) {
        val context = LocalContext.current
        val previewView = remember { PreviewView(context) }

        DisposableEffect(Unit) {
            val executor = Executors.newSingleThreadExecutor()
            var boundProvider: ProcessCameraProvider? = null

            ProcessCameraProvider.getInstance(context).addListener({
                try {
                    val cameraProvider = ProcessCameraProvider.getInstance(context).get()
                    boundProvider = cameraProvider

                    val preview = Preview.Builder().build()
                        .also { it.setSurfaceProvider(previewView.surfaceProvider) }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                        .also {
                            it.setAnalyzer(executor) { proxy ->
                                analyzeBarcodeFrame(proxy, expectedToken, onMatched, onMismatch)
                            }
                        }

                    cameraProvider.unbindAll()
                    cameraProvider.bindToLifecycle(
                        this@MedicationAlarmActivity,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                } catch (ignored: Throwable) {
                }
            }, ContextCompat.getMainExecutor(context))

            onDispose {
                try {
                    boundProvider?.unbindAll()
                } catch (ignored: Throwable) {
                }
                executor.shutdown()
            }
        }

        AndroidView(factory = { previewView }, modifier = modifier)
    }

    /** Y 平面 → ZXing；逐帧在后台线程执行，匹配结果统一抛回主线程。 */
    private fun analyzeBarcodeFrame(
        proxy: ImageProxy,
        expectedToken: String,
        onMatched: () -> Unit,
        onMismatch: () -> Unit,
    ) {
        try {
            val media = proxy.image
            if (media == null) return

            val width = proxy.width
            val height = proxy.height
            val rowStride = proxy.planes[0].rowStride
            val buffer = proxy.planes[0].buffer

            // 处理 rowStride > width 的对齐填充：逐行拷贝有效像素
            val data = ByteArray(width * height)
            if (rowStride == width) {
                buffer.get(data)
            } else {
                var offset = 0
                for (row in 0 until height) {
                    buffer.position(row * rowStride)
                    buffer.get(data, offset, width)
                    offset += width
                }
            }

            var source: com.google.zxing.LuminanceSource =
                PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)
            when (proxy.imageInfo.rotationDegrees) {
                90 -> source = source.rotateCounterClockwise()
                180 -> source = source.rotateCounterClockwise().rotateCounterClockwise()
                270 -> source = source.rotateCounterClockwise().rotateCounterClockwise().rotateCounterClockwise()
            }

            val result = try {
                QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)), mapOf(DecodeHintType.TRY_HARDER to true))
            } catch (ignored: Exception) {
                null // NotFoundException 等：本帧无 QR
            }
            val raw = result?.text?.trim()
            when {
                raw == null -> Unit
                raw == expectedToken.trim() -> runOnUiThread { onMatched() }
                else -> runOnUiThread { onMismatch() }
            }
        } catch (ignored: Throwable) {
            // 单帧异常直接丢弃
        } finally {
            proxy.close()
        }
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
        payloadState.value?.let {
            MedicationAlarmContract.queueOccurrenceAction(this, action, it, occurrenceId)
        }
        finish()
    }

    private fun formatTime(epochMillis: Long): String =
        SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(epochMillis))

    private fun act(action: String) {
        payloadState.value?.let { payload ->
            try {
                MedicationAlarmContract.handleAction(this, action, payload)
            } catch (ignored: JSONException) {
            }
        }
        finish()
    }

    override fun onDestroy() {
        try {
            ringtone?.takeIf { it.isPlaying }?.stop()
        } catch (ignored: Throwable) {
        }
        try {
            vibrator?.cancel()
        } catch (ignored: Throwable) {
        }
        super.onDestroy()
    }

    companion object {
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
