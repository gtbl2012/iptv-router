import type { RecordingMode, StartRecordingInput } from "@iptv-router/contracts"

export interface RecordingFormDraft {
  channelId: string
  durationMinutes: number
  mode: RecordingMode
  programmeId: string | null
  retentionHours: number
  title: string
}

export class RecordingFormError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RecordingFormError"
  }
}

function optionalTitle(value: string): { title?: string } {
  const title = value.trim()
  return title.length > 0 ? { title } : {}
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RecordingFormError(`${label}必须是正整数。`)
  }
  return value
}

export function buildStartRecordingInput(
  draft: RecordingFormDraft
): StartRecordingInput {
  if (!draft.channelId) throw new RecordingFormError("请选择要录制的频道。")
  const title = optionalTitle(draft.title)

  switch (draft.mode) {
    case "manual":
      return { mode: "manual", channelId: draft.channelId, ...title }
    case "fixed": {
      const durationMinutes = positiveInteger(draft.durationMinutes, "录制时长")
      if (durationMinutes > 10_080) {
        throw new RecordingFormError("定长录制最长支持 7 天。")
      }
      return {
        mode: "fixed",
        channelId: draft.channelId,
        durationSeconds: durationMinutes * 60,
        ...title,
      }
    }
    case "rolling": {
      const retentionHours = positiveInteger(
        draft.retentionHours,
        "回看保留时长"
      )
      if (retentionHours > 720) {
        throw new RecordingFormError("循环回看最长支持保留 30 天。")
      }
      return {
        mode: "rolling",
        channelId: draft.channelId,
        retentionSeconds: retentionHours * 3_600,
        ...title,
      }
    }
    case "epg":
      if (!draft.programmeId) {
        throw new RecordingFormError("请选择要预约录制的 EPG 节目。")
      }
      return {
        mode: "epg",
        channelId: draft.channelId,
        programmeId: draft.programmeId,
        ...title,
      }
  }
}
