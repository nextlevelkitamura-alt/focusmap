import { describe, expect, test } from "vitest"
import { isSilenceOnlyTranscription, normalizeTranscriptionText } from "./transcription-filter"

describe("transcription-filter", () => {
  test("ignores common silence-only transcription hallucinations", () => {
    expect(isSilenceOnlyTranscription("ありがとうございました。")).toBe(true)
    expect(isSilenceOnlyTranscription(" ご視聴ありがとうございました！ ")).toBe(true)
    expect(isSilenceOnlyTranscription("Thank you for watching.")).toBe(true)
  })

  test("keeps meaningful text that contains a thank-you phrase", () => {
    expect(isSilenceOnlyTranscription("田中さんにありがとうございましたと返信する")).toBe(false)
    expect(isSilenceOnlyTranscription("ありがとうございました。次に請求書を確認する")).toBe(false)
  })

  test("normalizes transcription text safely", () => {
    expect(normalizeTranscriptionText("  メモを追加  ")).toBe("メモを追加")
    expect(normalizeTranscriptionText(null)).toBe("")
  })
})
