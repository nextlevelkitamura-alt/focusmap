export const CODEX_CHAT_IMPORT_DRAG_TYPE = "application/x-focusmap-codex-chat-import"

export type CodexChatImportDragPayload = {
  taskId: string
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
    if (typeof parsed.taskId === "string" && parsed.taskId.trim()) {
      return { taskId: parsed.taskId.trim() }
    }
  } catch {
    return null
  }
  return null
}
