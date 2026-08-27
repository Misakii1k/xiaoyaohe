package com.medbox.app

import android.content.Intent
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kyant.backdrop.Backdrop
import com.kyant.backdrop.backdrops.layerBackdrop
import com.kyant.backdrop.backdrops.rememberLayerBackdrop
import com.kyant.backdrop.drawBackdrop
import com.kyant.backdrop.effects.blur
import com.kyant.backdrop.effects.lens
import com.kyant.backdrop.effects.vibrancy
import com.kyant.shapes.Capsule
import org.json.JSONException
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 全屏用药提醒页（Compose 版）。
 * 行为契约与旧 Java 版一致：载荷解析走 MedicationAlarmContract，铃声/振动/超时自关/
 * singleTop onNewIntent 换载荷全部保留。
 * UI 用 Kyant0/AndroidLiquidGlass（io.github.kyant0:backdrop）渲染液态玻璃按钮：
 * 装饰渐变层挂 Modifier.layerBackdrop 记录为采样源，玻璃按钮 drawBackdrop 采样它，
 * 边缘 lens() 折射 + vibrancy 提纯即库演示（LiquidButton）的同款效果组合。
 * lens 走 AGSL，API < 33 时 library 内部自动跳过该 shader（仅剩 blur+vibrancy），
 * 因此这里无需版本分支。
 */
class MedicationAlarmActivity : ComponentActivity() {

    private val handler = Handler(Looper.getMainLooper())
    private var ringtone: Ringtone? = null
    private var vibrator: Vibrator? = null

    // Compose 可观察载荷：onNewIntent 更新后界面自动重建
    private var payloadState = mutableStateOf<JSONObject?>(null)

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
            renderContent()
        } catch (error: JSONException) {
            finish()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        try {
            // singleTop：同实例被新的闹钟再次拉起时换载荷并重建页面。
            payloadState.value = MedicationAlarmContract.payloadFrom(intent)
            startAlert()
            scheduleTimeout()
        } catch (ignored: JSONException) {
        }
    }

    private fun renderContent() {
        setContent {
            val payload = payloadState.value ?: return@setContent
            AlarmRoot(payload)
        }
        startAlert()
        scheduleTimeout()
    }

    private fun scheduleTimeout() {
        val payload = payloadState.value ?: return
        val timeout = if ("fullscreen-persistent" == payload.optString("mode")) 60_000L else 10_000L
        handler.removeCallbacksAndMessages(null)
        if ("strong" != payload.optString("mode", "strong")) {
            handler.postDelayed({ finish() }, timeout)
        }
    }

    @Composable
    private fun AlarmRoot(payload: JSONObject) {
        val backdrop = rememberLayerBackdrop()

        Box(Modifier.fillMaxSize().background(Background)) {
            // 装饰层：记录进 LayerBackdrop，给玻璃面提供可折射的柔光渐变
            DecorLayer(
                Modifier
                    .matchParentSize()
                    .layerBackdrop(backdrop)
            )

            val data = payload.optJSONObject("data")
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp, vertical = 32.dp)
            ) {
                if (data != null && "reminder-group" == data.optString("kind")) {
                    GroupContent(data, backdrop)
                } else {
                    LegacyContent(payload, backdrop)
                }
            }
        }
    }

    /** 柔光渐变球：静态、零开销，仅在玻璃面边缘处形成可见折射流光。 */
    @Composable
    private fun DecorLayer(modifier: Modifier) {
        Box(modifier) {
            Box(
                Modifier
                    .offset { IntOffset(x = -60.dp.roundToPx(), y = (-80.dp).roundToPx()) }
                    .size(320.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(
                        Brush.radialGradient(listOf(GreenSoftGlow, Color.Transparent), radius = 520f)
                    )
            )
            Box(
                Modifier
                    .align(Alignment.BottomEnd)
                    .offset(y = 120.dp)
                    .size(360.dp)
                    .clip(RoundedCornerShape(percent = 50))
                    .background(
                        Brush.radialGradient(listOf(MintGlow, Color.Transparent), radius = 560f)
                    )
            )
        }
    }

    /** 组载荷（V2）：头部时段+时间，中部每药一行，底部整体操作。 */
    @Composable
    private fun GroupContent(data: JSONObject, backdrop: Backdrop) {
        GlassText("用药时间到了", 17.sp, FontWeight.SemiBold, Green)
        Spacer(Modifier.height(8.dp))
        GlassText(MedicationAlarmContract.buildGroupTitle(data), 26.sp, FontWeight.Bold, Ink)
        Spacer(Modifier.height(4.dp))
        GlassText(
            "${MedicationAlarmContract.slotLabel(data.optString("slot"))} · " +
                formatTime(data.optLong("dueAt", 0L)),
            16.sp, FontWeight.Normal, InkSoft,
        )
        Spacer(Modifier.height(20.dp))

        val occurrences = data.optJSONArray("occurrences")
        val count = occurrences?.length() ?: 0
        for (index in 0 until count) {
            occurrences?.optJSONObject(index)?.let { occurrence ->
                MedicationRow(occurrence, backdrop)
                Spacer(Modifier.height(10.dp))
            }
        }

        Spacer(Modifier.height(22.dp))
        GlassButton(
            label = "全部已服用",
            container = Color.White.copy(alpha = 0.30f),
            contentColor = GreenDeep,
            onClick = { act(MedicationAlarmContract.ACTION_ALL_TAKEN) },
            backdrop = backdrop,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        GlassButton(
            label = "10 分钟后提醒",
            container = Color.Transparent,
            contentColor = GreenDeep,
            onClick = { act(MedicationAlarmContract.ACTION_SNOOZE) },
            backdrop = backdrop,
            modifier = Modifier.fillMaxWidth()
        )
    }

    @Composable
    private fun MedicationRow(occurrence: JSONObject, backdrop: Backdrop) {
        val name = occurrence.optString("medName")
        val dose = occurrence.optString("dose")
        val occurrenceId = occurrence.optString("occurrenceId")
        if (name.isEmpty() && occurrenceId.isEmpty()) return

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(Color.White.copy(alpha = 0.86f))
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                GlassText(name.ifEmpty { "用药" }, 19.sp, FontWeight.SemiBold, Ink)
                if (dose.isNotEmpty()) {
                    GlassText(dose, 15.sp, FontWeight.Normal, InkSoft)
                }
            }
            Spacer(Modifier.width(10.dp))
            PillAction(label = "已服", fg = GreenDeep, backdrop = backdrop) {
                queueOccurrence(MedicationAlarmContract.ACTION_TAKEN, occurrenceId)
            }
            Spacer(Modifier.width(8.dp))
            PillAction(label = "跳过", fg = Red, backdrop = backdrop) {
                queueOccurrence(MedicationAlarmContract.ACTION_SKIP, occurrenceId)
            }
        }
    }

    /** 旧单药载荷布局。 */
    @Composable
    private fun LegacyContent(payload: JSONObject, backdrop: Backdrop) {
        val data = payload.optJSONObject("data")
        val dose = data?.optString("medicationDose").orEmpty()

        Spacer(Modifier.height(56.dp))
        GlassText("用药时间到了", 17.sp, FontWeight.SemiBold, Green, Modifier.fillMaxWidth(), TextAlign.Center)
        Spacer(Modifier.height(16.dp))
        GlassText(
            payload.optString("title", "该吃药了"),
            32.sp, FontWeight.Bold, Ink, Modifier.fillMaxWidth(), TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        GlassText(
            dose.ifEmpty { payload.optString("body") },
            21.sp, FontWeight.Normal, InkSoft, Modifier.fillMaxWidth(), TextAlign.Center,
        )
        Spacer(Modifier.height(64.dp))
        GlassButton(
            label = "已服用",
            container = Color.White.copy(alpha = 0.30f),
            contentColor = GreenDeep,
            onClick = { act(MedicationAlarmContract.ACTION_TAKEN) },
            backdrop = backdrop,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        GlassButton(
            label = "10 分钟后提醒",
            container = Color.Transparent,
            contentColor = GreenDeep,
            onClick = { act(MedicationAlarmContract.ACTION_SNOOZE) },
            backdrop = backdrop,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        GlassButton(
            label = "跳过本次",
            container = Color.Transparent,
            contentColor = Red,
            onClick = { act(MedicationAlarmContract.ACTION_SKIP) },
            backdrop = backdrop,
            modifier = Modifier.fillMaxWidth(),
            useLens = false
        )
    }

    /**
     * 液态玻璃胶囊按钮（官方 LiquidButton 的效果组合）：vibrancy 提纯 + 轻模糊 +
     * 边缘 12dp/24dp 折射透镜；surface 叠容器色与顶部受光高光条，最后画文字。
     */
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

    /** 文字（foundation.BasicText，避免引入无稳定版的 material3）。 */
    @Composable
    private fun GlassText(
        text: String,
        size: androidx.compose.ui.unit.TextUnit,
        weight: FontWeight,
        color: Color,
        modifier: Modifier = Modifier,
        align: TextAlign = TextAlign.Unspecified,
    ) {
        BasicText(
            text = text,
            modifier = modifier,
            style = TextStyle(fontSize = size, fontWeight = weight, color = color, textAlign = align),
        )
    }

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

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
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
        // 与 web 端同一套绿色系色板（#17745B 主绿 / 浅底 / 墨色文字）
        private val Green = Color(0xFF17745B)
        private val GreenDeep = Color(0xFF17603F)
        private val Ink = Color(0xFF182D26)
        private val InkSoft = Color(0xFF3C524A)
        private val Red = Color(0xFFAE2F37)
        private val Background = Color(0xFFF6FAF8)
        private val GreenSoftGlow = Color(0xFF9FD8C3).copy(alpha = 0.55f)
        private val MintGlow = Color(0xFF9ED8E6).copy(alpha = 0.45f)
    }
}
