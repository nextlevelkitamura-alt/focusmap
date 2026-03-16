export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  }
}

export function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  }
}

export function jsonResult(data: unknown, summary?: string) {
  const parts: { type: "text"; text: string }[] = []
  if (summary) parts.push({ type: "text", text: summary })
  parts.push({ type: "text", text: JSON.stringify(data, null, 2) })
  return { content: parts }
}
