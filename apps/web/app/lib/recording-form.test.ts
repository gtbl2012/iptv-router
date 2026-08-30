import assert from "node:assert/strict"
import test from "node:test"

import {
  buildStartRecordingInput,
  RecordingFormError,
} from "./recording-form.js"

void test("循环录制默认值映射为 24 小时保留窗口", () => {
  assert.deepEqual(
    buildStartRecordingInput({
      channelId: "channel-id",
      durationMinutes: 60,
      mode: "rolling",
      programmeId: null,
      retentionHours: 24,
      title: "",
    }),
    {
      mode: "rolling",
      channelId: "channel-id",
      retentionSeconds: 86_400,
    }
  )
})

void test("定长录制把分钟转换为秒并清理标题", () => {
  assert.deepEqual(
    buildStartRecordingInput({
      channelId: "channel-id",
      durationMinutes: 90,
      mode: "fixed",
      programmeId: null,
      retentionHours: 24,
      title: "  晚间新闻  ",
    }),
    {
      mode: "fixed",
      channelId: "channel-id",
      durationSeconds: 5_400,
      title: "晚间新闻",
    }
  )
})

void test("EPG 录制必须包含节目", () => {
  assert.throws(
    () =>
      buildStartRecordingInput({
        channelId: "channel-id",
        durationMinutes: 60,
        mode: "epg",
        programmeId: null,
        retentionHours: 24,
        title: "",
      }),
    RecordingFormError
  )
})

void test("拒绝超过上限的循环保留窗口", () => {
  assert.throws(
    () =>
      buildStartRecordingInput({
        channelId: "channel-id",
        durationMinutes: 60,
        mode: "rolling",
        programmeId: null,
        retentionHours: 721,
        title: "",
      }),
    /最长支持保留 30 天/
  )
})
