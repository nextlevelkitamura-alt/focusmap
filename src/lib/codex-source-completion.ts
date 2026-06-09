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

export async function setCodexSourceTaskCompletionFromNode(
  task: AiTask | null | undefined,
  done: boolean,
) {
  if (!isCodexTask(task)) return

  const nowIso = new Date().toISOString()
  const currentResult = objectValue(task.result)
  const sourceTaskId =
    task.source_task_id ||
    stringValue(currentResult.codex_source_task_id)

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
