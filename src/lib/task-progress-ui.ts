import type { TaskProgressStatus } from "@/types/task-progress"

export type CodexMonitorUiStatus = "unsent" | "running" | "review" | "connection_failed" | "done"

export function getCodexMonitorUiStatus(status: TaskProgressStatus | string | null | undefined): CodexMonitorUiStatus {
  switch (status) {
    case "pending":
      return "unsent"
    case "running":
      return "running"
    case "failed":
      return "connection_failed"
    case "awaiting_approval":
    case "needs_input":
    case "completed":
    default:
      return "review"
  }
}

export function codexMonitorUiLabel(status: TaskProgressStatus | string | null | undefined) {
  switch (getCodexMonitorUiStatus(status)) {
    case "unsent":
      return "未送信"
    case "running":
      return "実行中"
    case "connection_failed":
      return "接続失敗"
    case "done":
      return "完了済み"
    case "review":
    default:
      return "確認待ち"
  }
}

export function codexMonitorToneClass(status: TaskProgressStatus | string | null | undefined) {
  switch (getCodexMonitorUiStatus(status)) {
    case "running":
      return "border-emerald-400/45 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200/85"
    case "connection_failed":
      return "border-red-400/70 bg-red-500/10 text-red-700 dark:text-red-200"
    case "unsent":
      return "border-sky-400/70 bg-sky-500/10 text-sky-800 dark:text-sky-200"
    case "done":
      return "border-emerald-400/45 bg-emerald-500/[0.07] text-emerald-800 dark:text-emerald-200/85"
    case "review":
    default:
      return "border-amber-400/70 bg-amber-500/10 text-amber-800 dark:text-amber-200"
  }
}

export function formatTaskProgressDateTime(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function isSameLocalDate(value: string | null | undefined, now = new Date()) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
}

export function compactCodexMonitorText(value: string | null | undefined, maxLength: number) {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text
}
