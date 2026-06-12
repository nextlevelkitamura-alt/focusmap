const SECTION_HEADING_RE = /^##\s+(.+?)\s*$/

function compactDisplayText(value: unknown, maxChars = 2_000) {
  if (typeof value !== "string") return null
  const text = value.replace(/\r\n?/g, "\n").trim()
  return text ? text.slice(0, maxChars) : null
}

export function markdownSectionBody(markdown: unknown, heading: string) {
  if (typeof markdown !== "string" || !markdown.trim()) return null
  const target = heading.trim()
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n")
  const body: string[] = []
  let inSection = false

  for (const line of lines) {
    const match = line.match(SECTION_HEADING_RE)
    if (match) {
      if (inSection) break
      inSection = match[1]?.trim() === target
      continue
    }
    if (inSection) body.push(line)
  }

  return compactDisplayText(body.join("\n"))
}

export function codexThreadPromptPreviewFromMemo(memo: unknown, fallback?: unknown) {
  return markdownSectionBody(memo, "初回依頼") ?? compactDisplayText(fallback)
}
