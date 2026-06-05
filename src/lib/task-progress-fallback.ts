import { getCodexTaskUiState } from "@/lib/codex-run-state"
import type { AiTask } from "@/types/ai-task"
import type { TaskProgressSnapshotTask, TaskProgressStatus } from "@/types/task-progress"

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function fallbackStatusForAiTask(task: AiTask): TaskProgressStatus {
  const uiState = getCodexTaskUiState(task)
  if (uiState?.state === "prompt_waiting") return "pending"
  if (uiState?.state === "running") return "running"
  if (uiState?.state === "connection_failed") return "failed"
  if (task.status === "completed") return "completed"
  if (task.status === "needs_input") return "needs_input"
  return "awaiting_approval"
}

export function aiTaskToTaskProgressFallback(
  task: AiTask,
  source: { id: string; title?: string | null },
): TaskProgressSnapshotTask | null {
  if (task.executor !== "codex" && task.executor !== "codex_app") return null
  const result = objectValue(task.result)
  const progressSummary = objectValue(result.progress_summary)
  const snapshot = objectValue(result.codex_thread_snapshot)
  const currentStep =
    stringValue(result.current_step) ||
    stringValue(progressSummary.current_step) ||
    stringValue(result.message) ||
    stringValue(snapshot.preview) ||
    null
  const summary =
    stringValue(progressSummary.summary) ||
    stringValue(result.summary) ||
    stringValue(result.message) ||
    stringValue(snapshot.preview) ||
    null
  const rawProgressPercent = typeof progressSummary.progress_percent === "number"
    ? progressSummary.progress_percent
    : typeof result.progress_percent === "number"
      ? result.progress_percent
      : null

  return {
    id: task.id,
    title: source.title || task.prompt?.split("\n").find(line => line.trim())?.trim() || "Codexタスク",
    status: fallbackStatusForAiTask(task),
    executor: task.executor,
    codex_thread_id: task.codex_thread_id || stringValue(result.codex_thread_id) || null,
    current_step: currentStep,
    progress_percent: rawProgressPercent,
    summary,
    updated_at: stringValue(result.last_activity_at) || task.completed_at || task.started_at || task.created_at,
    source_type: "mindmap",
    source_id: source.id,
  }
}
