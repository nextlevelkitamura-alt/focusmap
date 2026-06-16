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

const DEFAULT_MAX_CHARS = 1_200

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
]

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, "\n")
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

function compactDisplayText(value: string) {
  return value
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
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
  const { text: withoutBlocks, omitted } = stripRawBlocks(raw)
  const compacted = compactDisplayText(withoutBlocks)
  const notice = omitted.length > 0 && options.appendOmissionNotice !== false
    ? `（${omitted.join("・")}は省略）`
    : ""
  const display = compacted || (omitted.length > 0 ? "画面情報や実行環境情報を受け取っています。" : fallback)
  const withNotice = [display, notice].filter(Boolean).join("\n")
  const truncated = truncateText(withNotice, maxChars)

  return {
    ...truncated,
    omitted,
    truncated: truncated.truncated,
  }
}

export function codexDisplayExcerpt(value: unknown, fallback?: unknown, maxChars = 600) {
  const primary = sanitizeCodexDisplayText(value, { maxChars, fallback: "" })
  if (primary.text) return primary.text
  return sanitizeCodexDisplayText(fallback, { maxChars, fallback: "" }).text
}
