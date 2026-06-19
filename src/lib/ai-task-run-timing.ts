export function normalizeAiTaskStartedAt(value: string | null | undefined) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  return Number.isNaN(Date.parse(text)) ? null : text
}

export function resolveRunningStartedAt(
  existingStartedAt: string | null | undefined,
  nowIso = new Date().toISOString(),
) {
  return normalizeAiTaskStartedAt(existingStartedAt) ?? nowIso
}

export function shouldInitializeRunningStartedAt(existingStartedAt: string | null | undefined) {
  return normalizeAiTaskStartedAt(existingStartedAt) === null
}
