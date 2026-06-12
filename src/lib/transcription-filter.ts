const SILENCE_ONLY_TRANSCRIPTS = new Set([
  "ありがとうございました",
  "ご視聴ありがとうございました",
  "ご清聴ありがとうございました",
  "ご覧いただきありがとうございました",
  "ご覧いただきありがとうございます",
  "字幕視聴ありがとうございました",
  "チャンネル登録よろしくお願いします",
  "thankyou",
  "thankyouforwatching",
  "thanksforwatching",
])

function normalizeForSilenceCheck(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000、。．，,.!?！？・…:：;；'"“”‘’`「」『』（）()[\]{}【】<>＜＞-]/g, "")
}

export function isSilenceOnlyTranscription(text: string | null | undefined): boolean {
  if (!text) return false
  const normalized = normalizeForSilenceCheck(text)
  if (!normalized) return false
  return SILENCE_ONLY_TRANSCRIPTS.has(normalized)
}

export function normalizeTranscriptionText(text: unknown): string {
  return typeof text === "string" ? text.trim() : ""
}
