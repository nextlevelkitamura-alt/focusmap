import type { AiHistoryListItem, AiHistoryStatus } from "@/types/ai-history"

export function normalizeAiHistoryRepoPath(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\/+$/u, "")
}

export function aiHistoryRepoName(value: string | null | undefined) {
  const normalized = normalizeAiHistoryRepoPath(value)
  if (!normalized) return "未選択"
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

export function formatAiHistoryRelativeTime(value: string | null | undefined) {
  if (!value) return null
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return null
  const diffMs = Date.now() - ms
  if (diffMs < 60_000) return "たった今"
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}日前`
  return new Date(ms).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })
}

export function aiHistoryStatusLabel(status: AiHistoryStatus | string | null | undefined) {
  switch (status) {
    case "running":
      return "実行中"
    case "awaiting_approval":
    case "needs_input":
      return "返信待ち"
    case "completed":
      return "完了済み"
    case "failed":
      return "接続失敗"
    case "idle":
      return "待機中"
    default:
      return "返信待ち"
  }
}

export function aiHistoryPlacementLabel(item: Pick<AiHistoryListItem, "placement">) {
  return item.placement === "mindmap" ? "マインドマップ" : "未配置"
}

export function aiHistoryWorkTiming(item: Pick<AiHistoryListItem, "startedAt" | "endedAt" | "lastActivityAt" | "status" | "workDurationSeconds">) {
  if (item.startedAt) {
    return {
      workStartedAt: item.startedAt,
      workAwaitingApprovalAt: item.status === "awaiting_approval" || item.status === "needs_input"
        ? item.endedAt ?? item.lastActivityAt
        : null,
      workCompletedAt: item.endedAt,
      workLastActivityAt: item.lastActivityAt,
    }
  }

  if (typeof item.workDurationSeconds === "number" && Number.isFinite(item.workDurationSeconds) && item.lastActivityAt) {
    const finishedMs = Date.parse(item.lastActivityAt)
    if (Number.isFinite(finishedMs)) {
      return {
        workStartedAt: new Date(finishedMs - Math.max(0, item.workDurationSeconds) * 1000).toISOString(),
        workAwaitingApprovalAt: item.status === "awaiting_approval" || item.status === "needs_input"
          ? item.lastActivityAt
          : null,
        workCompletedAt: item.status === "completed" ? item.lastActivityAt : null,
        workLastActivityAt: item.lastActivityAt,
      }
    }
  }

  return {
    workStartedAt: null,
    workAwaitingApprovalAt: null,
    workCompletedAt: null,
    workLastActivityAt: item.lastActivityAt,
  }
}
