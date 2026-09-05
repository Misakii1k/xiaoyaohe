package com.medbox.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * 时段分组（V2）载荷与 action 队列的纯 JVM 单测。
 * 只测不依赖 Android 框架的静态逻辑；schedule/queue 等持 Context 的方法由仪器测试覆盖。
 */
public class MedicationAlarmContractTest {

    private static JSONObject groupData() throws Exception {
        JSONObject occurrenceA = new JSONObject()
            .put("occurrenceId", "occurrence:rule-a:2026-07-13")
            .put("legacyLogId", "rule-a_20260713")
            .put("medId", "med-a")
            .put("medName", "二甲双胍")
            .put("dose", "1片");
        JSONObject occurrenceB = new JSONObject()
            .put("occurrenceId", "occurrence:rule-b:2026-07-13")
            .put("legacyLogId", "rule-b_20260713")
            .put("medId", "med-b")
            .put("medName", "阿司匹林")
            .put("dose", "1粒");
        return new JSONObject()
            .put("kind", "reminder-group")
            .put("groupId", "reminder-group:2026-07-13:morning")
            .put("date", "2026-07-13")
            .put("slot", "morning")
            .put("dueAt", 1783900800000L)
            .put("mode", "fullscreen-short")
            .put("reminderCount", 1)
            .put("occurrences", new JSONArray().put(occurrenceA).put(occurrenceB));
    }

    @Test
    public void groupPayloadDetection() throws Exception {
        JSONObject group = new JSONObject().put("data", groupData());
        assertTrue(MedicationAlarmContract.isGroupPayload(group));
        JSONObject legacy = new JSONObject().put("data", new JSONObject()
            .put("medicationName", "测试药")
            .put("reminderMode", "strong"));
        assertFalse(MedicationAlarmContract.isGroupPayload(legacy));
        assertFalse(MedicationAlarmContract.isGroupPayload(new JSONObject()));
    }

    @Test
    public void slotLabelMapsAllFourSlots() {
        assertEquals("早上", MedicationAlarmContract.slotLabel("morning"));
        assertEquals("中午", MedicationAlarmContract.slotLabel("noon"));
        assertEquals("晚上", MedicationAlarmContract.slotLabel("evening"));
        assertEquals("睡前", MedicationAlarmContract.slotLabel("bedtime"));
        assertEquals("服药", MedicationAlarmContract.slotLabel(""));
    }

    @Test
    public void groupBodyListsEachMedicationRow() throws Exception {
        String body = MedicationAlarmContract.buildGroupBody(groupData());
        assertTrue(body.contains("二甲双胍 1片"));
        assertTrue(body.contains("阿司匹林 1粒"));
        assertTrue(body.indexOf("二甲双胍 1片") < body.indexOf("阿司匹林 1粒"));
    }

    @Test
    public void groupTitleAddsReminderCountPrefixFromThirdRepeat() throws Exception {
        JSONObject data = groupData();
        data.put("reminderCount", 1);
        assertEquals("早上服药时间到了", MedicationAlarmContract.buildGroupTitle(data));
        data.put("reminderCount", 2);
        assertEquals("早上服药时间到了", MedicationAlarmContract.buildGroupTitle(data));
        data.put("reminderCount", 3);
        assertEquals("第 3 次提醒 · 早上服药时间到了", MedicationAlarmContract.buildGroupTitle(data));
    }

    @Test
    public void snoozeRebuildsGroupPayloadKeepingTagAndMode() throws Exception {
        JSONObject data = groupData();
        JSONObject snoozed = MedicationAlarmContract.buildSnoozePayload(data, "reminder-group:2026-07-13:morning", 1783901400000L);
        assertEquals("reminder-group:2026-07-13:morning", snoozed.getString("tag"));
        assertEquals("snooze", snoozed.getString("key"));
        assertEquals(1783901400000L, snoozed.getLong("at"));
        assertEquals("fullscreen-short", snoozed.getString("mode"));
        assertEquals("早上服药时间到了", snoozed.getString("title"));
        assertTrue(snoozed.getString("body").contains("二甲双胍 1片"));
        // 原组 data 原样保留
        assertEquals("reminder-group", snoozed.getJSONObject("data").getString("kind"));
    }

    @Test
    public void snoozeKeepsLegacyFormatForOldPayloads() throws Exception {
        JSONObject data = new JSONObject()
            .put("medicationName", "测试药")
            .put("reminderMode", "fullscreen-persistent");
        JSONObject snoozed = MedicationAlarmContract.buildSnoozePayload(data, "occurrence:rule-1:2026-07-13", 1783901400000L);
        assertEquals("fullscreen-persistent", snoozed.getString("mode"));
        assertEquals("⏰ 该吃药了", snoozed.getString("title"));
        assertTrue(snoozed.getString("body").contains("测试药"));
        assertTrue(snoozed.getString("body").contains("稍后提醒"));
    }

    @Test
    public void actionQueueAckRemovesOnlyConfirmedIds() throws Exception {
        JSONArray actions = new JSONArray()
            .put(new JSONObject().put("id", "ack-1").put("actionId", "taken"))
            .put(new JSONObject().put("id", "ack-2").put("actionId", "all-taken"))
            .put(new JSONObject().put("id", "ack-3").put("actionId", "skip"))
            // 遗留无 id 的 action：没有 id 永远无法被 ack，保留待重放（TS 幂等无害）
            .put(new JSONObject().put("actionId", "taken"));

        JSONArray remaining = MedicationAlarmContract.filterActions(actions, new JSONArray().put("ack-2"));

        assertEquals(3, remaining.length());
        assertEquals("ack-1", remaining.getJSONObject(0).getString("id"));
        assertEquals("ack-3", remaining.getJSONObject(1).getString("id"));
        assertFalse(remaining.getJSONObject(2).has("id"));
    }

    @Test
    public void actionQueueAckKeepsUnacknowledgedItemsForReplay() throws Exception {
        JSONArray actions = new JSONArray()
            .put(new JSONObject().put("id", "ack-1").put("actionId", "taken"))
            .put(new JSONObject().put("id", "ack-2").put("actionId", "skip"));
        JSONArray remaining = MedicationAlarmContract.filterActions(actions, new JSONArray().put("ack-9"));
        assertEquals(2, remaining.length());
    }

    @Test
    public void tokenMatchHandlesVariousFormatsAndTolerances() {
        // 精确匹配
        assertTrue(MedicationAlarmContract.isTokenMatch("medbox-unlock:v1:abc", "medbox-unlock:v1:abc"));
        assertTrue(MedicationAlarmContract.isTokenMatch("6901234567890", "6901234567890"));

        // 大小写不敏感
        assertTrue(MedicationAlarmContract.isTokenMatch("HTTPS://EXAMPLE.COM/ABC", "https://example.com/abc"));

        // 结尾斜杠容错
        assertTrue(MedicationAlarmContract.isTokenMatch("https://weixin.qq.com/r/abc/", "https://weixin.qq.com/r/abc"));
        assertTrue(MedicationAlarmContract.isTokenMatch("https://weixin.qq.com/r/abc", "https://weixin.qq.com/r/abc/"));

        // URL 协议容错 (http vs https)
        assertTrue(MedicationAlarmContract.isTokenMatch("http://example.com/foo", "https://example.com/foo/"));

        // 空白、换行与 BOM 过滤
        assertTrue(MedicationAlarmContract.isTokenMatch("  \uFEFF6901234567890\r\n  ", "6901234567890"));

        // 条码 AIM 标识前缀过滤（如 ]Q1 代表 QR Code）
        assertTrue(MedicationAlarmContract.isTokenMatch("]Q1https://example.com", "https://example.com"));
        assertTrue(MedicationAlarmContract.isTokenMatch("]C16901234567890", "6901234567890"));

        // UPC-A (12位) 与 EAN-13 (13位带前导0) 容错
        assertTrue(MedicationAlarmContract.isTokenMatch("0123456789012", "123456789012"));
        assertTrue(MedicationAlarmContract.isTokenMatch("123456789012", "0123456789012"));

        // 不匹配
        assertFalse(MedicationAlarmContract.isTokenMatch("12345", "67890"));
        assertFalse(MedicationAlarmContract.isTokenMatch("", "67890"));
        assertFalse(MedicationAlarmContract.isTokenMatch("12345", ""));
    }
}
