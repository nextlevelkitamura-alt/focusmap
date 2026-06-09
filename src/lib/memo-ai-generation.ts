export const MEMO_HEADING_TARGET_MIN_CHARS = 14
export const MEMO_HEADING_TARGET_MAX_CHARS = 24
export const MEMO_HEADING_HARD_MAX_CHARS = 28
export const MEMO_AI_INGEST_TITLE_MAX_CHARS = 22
export const LONG_NODE_PENDING_HEADING_MAX_CHARS = 22

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

export function buildLongNodeMemoDetail(title: string | null | undefined, memo: string | null | undefined) {
  const titleText = (title ?? "").trim()
  const memoText = (memo ?? "").trim()

  if (!titleText) return memoText
  if (!memoText || memoText === titleText || memoText.startsWith(`${titleText}\n`)) return titleText
  return `${titleText}\n\n${memoText}`
}

export function buildLongNodePendingHeading(title: string | null | undefined) {
  const lines = (title ?? "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const firstLine = lines[0] ?? ""
  const normalized = firstLine || (title ?? "").replace(/\s+/g, " ").trim()
  const normalizedChars = Array.from(normalized)

  if (normalizedChars.length > LONG_NODE_PENDING_HEADING_MAX_CHARS) {
    const shortened = takeCharacters(normalized, LONG_NODE_PENDING_HEADING_MAX_CHARS - 1)
      .replace(/[、。，．,.!！?？:：;；]+$/g, "")
      .trim()
    return shortened ? `${shortened}…` : "見出し生成中"
  }

  return cleanGeneratedMemoHeading(normalized, LONG_NODE_PENDING_HEADING_MAX_CHARS) || "見出し生成中"
}

export function buildLongNodeHeadingPayload(title: string | null | undefined, memo: string | null | undefined) {
  const titleText = (title ?? "").trim()
  const memoText = (memo ?? "").trim()
  const titleLooksLikeExistingHeading =
    !!titleText &&
    !!memoText &&
    !titleText.includes("\n") &&
    Array.from(titleText).length <= MEMO_HEADING_HARD_MAX_CHARS &&
    !memoText.startsWith(`${titleText}\n`)

  const detail = titleLooksLikeExistingHeading
    ? memoText
    : buildLongNodeMemoDetail(titleText, memoText)

  return {
    detail,
    pendingHeading: buildLongNodePendingHeading(titleLooksLikeExistingHeading ? memoText : titleText),
  }
}
