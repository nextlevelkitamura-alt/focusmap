export type CodexDisplaySanitizeResult = {
  text: string
  omitted: string[]
  truncated: boolean
}

type RawBlockRule = {
  label: string
  start: RegExp
  end: RegExp
}

type AttachmentSummaryItem = {
  label: string
  count: number
}

const DEFAULT_MAX_CHARS = 1_200

const FILES_MENTIONED_HEADING = /^\s*#{1,6}\s*Files mentioned by the user:\s*$/i
const APPLICATIONS_MENTIONED_HEADING = /^\s*#{1,6}\s*Applications mentioned by the user:\s*$/i
const MY_REQUEST_HEADING = /^\s*#{1,6}\s*My request for Codex:\s*$/i

const RAW_BLOCK_RULES: RawBlockRule[] = [
  {
    label: "画面情報",
    start: /#\s*Applications mentioned by the user|<appshot\b|&lt;appshot\b/i,
    end: /<\/appshot>|&lt;\/appshot&gt;/i,
  },
  {
    label: "skill定義",
    start: /<skill\b|&lt;skill\b|<SKILL\.md>/i,
    end: /<\/skill>|&lt;\/skill&gt;|<\/SKILL\.md>/i,
  },
  {
    label: "エージェント指示",
    start: /#\s*AGENTS\.md instructions|<INSTRUCTIONS>|&lt;INSTRUCTIONS&gt;/i,
    end: /<\/INSTRUCTIONS>|&lt;\/INSTRUCTIONS&gt;/i,
  },
  {
    label: "環境情報",
    start: /<environment_context>|&lt;environment_context&gt;|<system>|&lt;system&gt;|<developer>|&lt;developer&gt;/i,
    end: /<\/environment_context>|&lt;\/environment_context&gt;|<\/system>|&lt;\/system&gt;|<\/developer>|&lt;\/developer&gt;/i,
  },
  {
    label: "画像情報",
    start: /<image\b|&lt;image\b/i,
    end: /<\/image>|&lt;\/image&gt;/i,
  },
]

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, "\n")
}

function addAttachmentCount(counts: Map<string, number>, label: string, increment = 1) {
  if (increment <= 0) return
  counts.set(label, (counts.get(label) ?? 0) + increment)
}

function attachmentLabelFromFileName(value: string) {
  const fileName = value.trim().split(/[?#]/, 1)[0] ?? ""
  const extension = fileName.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase()
  if (!extension) return "ファイル"
  if (extension === "pdf") return "PDF"
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg"].includes(extension)) return "画像"
  if (["mp4", "mov", "webm", "m4v"].includes(extension)) return "動画"
  if (["mp3", "wav", "m4a", "aac"].includes(extension)) return "音声"
  if (["doc", "docx"].includes(extension)) return "Word"
  if (["xls", "xlsx", "csv", "tsv"].includes(extension)) return "表計算"
  if (["ppt", "pptx"].includes(extension)) return "スライド"
  if (["txt", "md", "json", "yaml", "yml"].includes(extension)) return extension.toUpperCase()
  return extension.toUpperCase()
}

function attachmentSummaryItems(value: string): AttachmentSummaryItem[] {
  const normalized = normalizeNewlines(value)
  const lines = normalized.split("\n")
  const counts = new Map<string, number>()
  let inFilesSection = false
  let sawFilesSection = false

  for (const line of lines) {
    if (FILES_MENTIONED_HEADING.test(line)) {
      inFilesSection = true
      sawFilesSection = true
      continue
    }

    if (!inFilesSection) continue

    if (MY_REQUEST_HEADING.test(line) || APPLICATIONS_MENTIONED_HEADING.test(line)) {
      inFilesSection = false
      continue
    }

    const headingMatch = line.match(/^\s*#{2,6}\s+(.+)$/)
    if (!headingMatch) continue
    const heading = headingMatch[1].trim()
    const fileName = heading.includes(":") ? heading.slice(0, heading.indexOf(":")).trim() : heading
    addAttachmentCount(counts, attachmentLabelFromFileName(fileName))
  }

  addAttachmentCount(counts, "Appshot", (normalized.match(/<appshot\b|&lt;appshot\b/gi) ?? []).length)

  if (!sawFilesSection) {
    addAttachmentCount(counts, "画像", (normalized.match(/<image\b|&lt;image\b/gi) ?? []).length)
  }

  return Array.from(counts.entries()).map(([label, count]) => ({ label, count }))
}

function formatAttachmentSummary(items: AttachmentSummaryItem[]) {
  if (items.length === 0) return ""
  return [
    "添付ファイル",
    ...items.map(item => `${item.label}: ${item.count}件`),
  ].join("\n")
}

function stripRawBlocks(value: string) {
  const lines = normalizeNewlines(value).split("\n")
  const output: string[] = []
  const omitted: string[] = []
  let activeRule: RawBlockRule | null = null

  for (const line of lines) {
    if (activeRule) {
      if (activeRule.end.test(line)) activeRule = null
      continue
    }

    const matchedRule = RAW_BLOCK_RULES.find(rule => rule.start.test(line))
    if (!matchedRule) {
      output.push(line)
      continue
    }

    omitted.push(matchedRule.label)
    if (!matchedRule.end.test(line)) activeRule = matchedRule
  }

  return {
    text: output.join("\n"),
    omitted: unique(omitted),
  }
}

function stripFilesMentionedSection(value: string) {
  const lines = normalizeNewlines(value).split("\n")
  const output: string[] = []
  const omitted: string[] = []
  let inFilesSection = false

  for (const line of lines) {
    if (inFilesSection) {
      if (MY_REQUEST_HEADING.test(line) || APPLICATIONS_MENTIONED_HEADING.test(line)) {
        inFilesSection = false
        output.push(line)
      }
      continue
    }

    if (FILES_MENTIONED_HEADING.test(line)) {
      inFilesSection = true
      omitted.push("添付ファイル詳細")
      continue
    }

    output.push(line)
  }

  return {
    text: output.join("\n"),
    omitted: unique(omitted),
  }
}

function extractCodexUserRequest(value: string) {
  const lines = normalizeNewlines(value).split("\n")
  let requestStart = -1

  lines.forEach((line, index) => {
    if (MY_REQUEST_HEADING.test(line)) requestStart = index + 1
  })

  return requestStart >= 0 ? lines.slice(requestStart).join("\n") : null
}

function compactDisplayText(value: string) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function stripFocusmapSyncId(value: string) {
  return normalizeNewlines(value)
    .replace(/\n?---\nFocusmap同期ID:\s+FM-[^\n]+\nこの同期IDはFocusmap連携用です。返信では触れないでください。\s*$/u, "")
    .replace(/\n{0,2}Focusmap同期ID:\s*FM-[^\n]+\s*$/u, "")
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`,
    truncated: true,
  }
}

export function sanitizeCodexDisplayText(
  value: unknown,
  options: {
    maxChars?: number
    fallback?: string
    appendOmissionNotice?: boolean
  } = {},
): CodexDisplaySanitizeResult {
  const raw = typeof value === "string" ? value : ""
  const maxChars = Math.max(80, options.maxChars ?? DEFAULT_MAX_CHARS)
  const fallback = options.fallback ?? ""
  const attachments = attachmentSummaryItems(raw)
  const { text: withoutBlocks, omitted } = stripRawBlocks(raw)
  const { text: withoutFiles, omitted: omittedFiles } = stripFilesMentionedSection(withoutBlocks)
  const requestText = extractCodexUserRequest(withoutFiles)
  const structuredCodexInput = requestText !== null || omittedFiles.length > 0 || attachments.length > 0
  const compacted = compactDisplayText(stripFocusmapSyncId(requestText ?? withoutFiles))
  const attachmentSummary = formatAttachmentSummary(attachments)
  const notice = !structuredCodexInput && omitted.length > 0 && options.appendOmissionNotice !== false
    ? `（${omitted.join("・")}は省略）`
    : ""
  const defaultDisplay = omitted.length > 0
    ? "画面情報や実行環境情報を受け取っています。"
    : fallback
  const display = compacted || (structuredCodexInput && attachmentSummary ? "" : defaultDisplay)
  const withAttachments = structuredCodexInput
    ? [display, attachmentSummary].filter(Boolean).join("\n\n")
    : display
  const withNotice = [withAttachments, notice].filter(Boolean).join("\n")
  const truncated = truncateText(withNotice, maxChars)

  return {
    ...truncated,
    omitted: unique([...omitted, ...omittedFiles]),
    truncated: truncated.truncated,
  }
}

export function codexDisplayExcerpt(value: unknown, fallback?: unknown, maxChars = 600) {
  const primary = sanitizeCodexDisplayText(value, { maxChars, fallback: "" })
  if (primary.text) return primary.text
  return sanitizeCodexDisplayText(fallback, { maxChars, fallback: "" }).text
}
