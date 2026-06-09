import type { AiTask } from "@/types/ai-task"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function isCodexTask(task: AiTask | null | undefined): task is AiTask {
  return task?.executor === "codex" || task?.executor === "codex_app"
}

export const CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS = 10_000

export function isPendingCodexArchiveRequest(result: unknown) {
  const current = objectValue(result)
  return current.codex_archive_request_state === "pending" &&
    typeof current.codex_archive_requested_at === "string" &&
    current.codex_archive_requested_at.trim().length > 0 &&
    current.codex_archive_request_cancelled_at == null &&
    current.codex_archive_completed_at == null &&
    current.codex_source_task_completed === true &&
    current.codex_source_task_completion_suppressed !== true
}

function codexSourceTaskId(task: AiTask, currentResult: Record<string, unknown>) {
  return task.source_task_id || stringValue(currentResult.codex_source_task_id)
}

export async function setCodexSourceTaskCompletionFromNode(
  task: AiTask | null | undefined,
  done: boolean,
) {
  if (!isCodexTask(task)) return

  const nowIso = new Date().toISOString()
  const currentResult = objectValue(task.result)
  const sourceTaskId = codexSourceTaskId(task, currentResult)

  const status = done ? "completed" : "awaiting_approval"
  const currentStep = done
    ? "Focusmapノードを完了済みにしました"
    : "Codexが実行完了し確認待ちです"
  const summary = done
    ? "ノードのチェックに合わせてCodex実行を完了済みにしました。"
    : "ノードのチェックが外れたため、Codex実行を確認待ちに戻しました。"
  const result = {
    ...currentResult,
    codex_run_state: "awaiting_approval",
    codex_review_reason: stringValue(currentResult.codex_review_reason) ?? "completed",
    codex_source_task_completed: done,
    codex_source_task_id: sourceTaskId,
    codex_source_task_completion_reason: done
      ? stringValue(currentResult.codex_source_task_completion_reason) ?? "node_checked"
      : null,
    codex_source_task_completion_suppressed: done ? false : true,
    codex_archive_request_state: done ? "waiting_for_grace" : "cancelled",
    codex_archive_requested_at: done ? null : currentResult.codex_archive_requested_at ?? null,
    codex_archive_request_reason: done ? null : currentResult.codex_archive_request_reason ?? null,
    codex_archive_request_cancelled_at: done ? null : nowIso,
    codex_last_checked_at: nowIso,
    last_activity_at: nowIso,
    current_step: currentStep,
    message: summary,
    session_health: "stopped",
    awaiting_approval_at: done
      ? stringValue(currentResult.awaiting_approval_at) ?? nowIso
      : nowIso,
  }

  const response = await fetchWithSupabaseAuth(`/api/ai-tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      completed_at: done ? nowIso : null,
      result,
    }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || "Codex task completion update failed")
  }

  await fetchWithSupabaseAuth("/api/task-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: task.id,
      status,
      current_step: currentStep,
      summary,
      progress_percent: done ? 100 : null,
      executor: task.executor,
      codex_thread_id: task.codex_thread_id || stringValue(currentResult.codex_thread_id),
      last_activity_at: nowIso,
      event_type: `status:${status}`,
      event_payload: {
        source: "focusmap_node_checkbox",
        source_task_id: sourceTaskId,
        checked: done,
      },
      snapshot_only: true,
      force_event: true,
    }),
  }).catch(() => undefined)
}

export async function requestCodexThreadArchiveFromNode(task: AiTask | null | undefined) {
  if (!isCodexTask(task)) return false

  const currentResult = objectValue(task.result)
  const sourceTaskId = codexSourceTaskId(task, currentResult)
  const threadId = task.codex_thread_id || stringValue(currentResult.codex_thread_id)
  if (!sourceTaskId || !threadId) return false

  const nowIso = new Date().toISOString()
  const currentStep = "Codex threadのアーカイブをMacへ依頼しました"
  const summary = "ノードのチェックが10秒維持されたため、Mac agentへCodex threadアーカイブを依頼しました。"
  const result = {
    ...currentResult,
    codex_run_state: "awaiting_approval",
    codex_review_reason: stringValue(currentResult.codex_review_reason) ?? "completed",
    codex_thread_id: threadId,
    codex_source_task_completed: true,
    codex_source_task_id: sourceTaskId,
    codex_source_task_completion_reason:
      stringValue(currentResult.codex_source_task_completion_reason) ?? "node_checked",
    codex_source_task_completion_suppressed: false,
    codex_archive_request_state: "pending",
    codex_archive_requested_at: nowIso,
    codex_archive_request_reason: "node_checked_after_grace",
    codex_archive_request_cancelled_at: null,
    codex_archive_completed_at: null,
    codex_last_checked_at: nowIso,
    last_activity_at: nowIso,
    current_step: currentStep,
    message: summary,
    session_health: "stopped",
    awaiting_approval_at: stringValue(currentResult.awaiting_approval_at) ?? nowIso,
  }

  const response = await fetchWithSupabaseAuth(`/api/ai-tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "completed",
      completed_at: task.completed_at ?? nowIso,
      result,
    }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || "Codex thread archive request update failed")
  }

  await fetchWithSupabaseAuth("/api/task-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task_id: task.id,
      status: "completed",
      current_step: currentStep,
      summary,
      progress_percent: 100,
      executor: task.executor,
      codex_thread_id: threadId,
      last_activity_at: nowIso,
      event_type: "codex_archive_requested",
      event_payload: {
        source: "focusmap_node_checkbox",
        source_task_id: sourceTaskId,
        archive_request_state: "pending",
      },
      snapshot_only: true,
      force_event: true,
    }),
  }).catch(() => undefined)

  return true
}
