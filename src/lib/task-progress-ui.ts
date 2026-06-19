import type { TaskProgressStatus } from "@/types/task-progress"

export type CodexMonitorUiStatus = "unsent" | "running" | "review" | "connection_failed" | "done"

export function getCodexMonitorUiStatus(status: TaskProgressStatus | string | null | undefined): CodexMonitorUiStatus {
  switch (status) {
    case "pending":
    case "prompt_waiting":
      return "unsent"
    case "running":
      return "running"
    case "failed":
    case "connection_failed":
      return "connection_failed"
    case "done":
      return "done"
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
      return "border-emerald-300 bg-emerald-400 text-emerald-950"
    case "connection_failed":
      return "border-red-300 bg-red-500 text-white"
    case "unsent":
      return "border-sky-300 bg-sky-400 text-sky-950"
    case "done":
      return "border-emerald-300 bg-emerald-500 text-white"
    case "review":
    default:
      return "border-amber-300 bg-amber-400 text-amber-950"
  }
}

export function codexMonitorCardClass(status: TaskProgressStatus | string | null | undefined) {
  switch (getCodexMonitorUiStatus(status)) {
    case "running":
      return "border-emerald-400/75 bg-emerald-500/[0.11] shadow-[0_0_22px_rgba(16,185,129,0.2)]"
    case "connection_failed":
      return "border-red-400/70 bg-red-500/[0.08] shadow-[0_0_16px_rgba(248,113,113,0.16)]"
    case "unsent":
      return "border-sky-400/55 bg-sky-500/[0.07] shadow-[0_0_14px_rgba(14,165,233,0.12)]"
    case "done":
      return "border-emerald-400/40 bg-emerald-500/[0.05] shadow-[0_0_10px_rgba(16,185,129,0.1)]"
    case "review":
    default:
      return "border-amber-400/70 bg-amber-500/[0.08] shadow-[0_0_16px_rgba(245,158,11,0.16)]"
  }
}

export function codexMonitorAccentClass(status: TaskProgressStatus | string | null | undefined) {
  switch (getCodexMonitorUiStatus(status)) {
    case "running":
      return "bg-emerald-400"
    case "connection_failed":
      return "bg-red-400"
    case "unsent":
      return "bg-sky-400"
    case "done":
      return "bg-emerald-400/60"
    case "review":
    default:
      return "bg-amber-400"
  }
}

export function codexThreadUrl(threadId: string | null | undefined) {
  const id = threadId?.trim()
  return id ? `codex://threads/${id}` : null
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
