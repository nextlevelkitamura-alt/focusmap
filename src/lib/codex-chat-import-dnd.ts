export const CODEX_CHAT_IMPORT_DRAG_TYPE = "application/x-focusmap-codex-chat-import"

export type CodexChatImportDragPayload = {
  taskId?: string
  historyItemId?: string
  title?: string
  snippet?: string | null
}

export function encodeCodexChatImportDragPayload(payload: CodexChatImportDragPayload) {
  return JSON.stringify(payload)
}

export function hasCodexChatImportDragPayload(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) return false
  return Array.from(dataTransfer.types ?? []).includes(CODEX_CHAT_IMPORT_DRAG_TYPE)
}

export function readCodexChatImportDragPayload(dataTransfer: DataTransfer | null | undefined): CodexChatImportDragPayload | null {
  if (!dataTransfer) return null
  const raw = dataTransfer.getData(CODEX_CHAT_IMPORT_DRAG_TYPE)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CodexChatImportDragPayload>
    const taskId = typeof parsed.taskId === "string" ? parsed.taskId.trim() : ""
    const historyItemId = typeof parsed.historyItemId === "string" ? parsed.historyItemId.trim() : ""
    if (taskId || historyItemId) {
      return {
        ...(taskId ? { taskId } : {}),
        ...(historyItemId ? { historyItemId } : {}),
        title: typeof parsed.title === "string" ? parsed.title.trim() : undefined,
        snippet: typeof parsed.snippet === "string" ? parsed.snippet.trim() : null,
      }
    }
  } catch {
    return null
  }
  return null
}
