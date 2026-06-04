export const MEMO_HEADING_TARGET_MIN_CHARS = 14
export const MEMO_HEADING_TARGET_MAX_CHARS = 22
export const MEMO_HEADING_HARD_MAX_CHARS = 24
export const MEMO_AI_INGEST_TITLE_MAX_CHARS = 22

function takeCharacters(value: string, maxChars: number) {
  return Array.from(value).slice(0, maxChars).join("")
}

export function cleanGeneratedMemoHeading(value: string, maxChars = MEMO_HEADING_HARD_MAX_CHARS) {
  const normalized = value
    .replace(/^\s*(見出し|タイトル|heading|title)\s*[:：]\s*/i, "")
    .replace(/^\s*(?:[-*・]\s*|\d+[.)）]\s*)/, "")
    .replace(/^[「『"']+|[」』"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return takeCharacters(normalized, maxChars)
    .replace(/[、。，．,.!！?？:：;；]+$/g, "")
    .trim()
}

export function normalizeAiIngestTitle(title: string | undefined, fallbackText: string) {
  const firstLine = fallbackText.split(/\r?\n/).find(line => line.trim())?.trim() ?? ""
  const candidate = title?.trim() || firstLine || "新しいメモ"
  return cleanGeneratedMemoHeading(candidate, MEMO_AI_INGEST_TITLE_MAX_CHARS) || "新しいメモ"
}

export function preserveMemoInputBody(value: string) {
  return value.trim()
}
