import type { AiTask } from "@/types/ai-task"
import { getCodexTaskUiState } from "@/lib/codex-run-state"
import type { TaskProgressSnapshotTask, TaskProgressStatus } from "@/types/task-progress"

function progressStatusForAiTask(task: AiTask): TaskProgressStatus | null {
  const uiState = getCodexTaskUiState(task)
  if (!uiState) return null

  switch (uiState.state) {
    case "prompt_waiting":
      return "pending"
    case "running":
      return "running"
    case "awaiting_approval":
      return task.status === "needs_input" ? "needs_input" : "awaiting_approval"
    case "connection_failed":
      return "failed"
    case "completed":
      return "completed"
    default:
      return null
  }
}

export function hydrateTaskProgressMindMapSources(
  tasks: TaskProgressSnapshotTask[],
  aiTasksBySourceId: ReadonlyMap<string, AiTask>,
) {
  if (tasks.length === 0 || aiTasksBySourceId.size === 0) return tasks

  const sourceIdByAiTaskId = new Map<string, string>()
  const aiTaskById = new Map<string, AiTask>()
  for (const [sourceId, aiTask] of aiTasksBySourceId.entries()) {
    if (!sourceId || !aiTask?.id) continue
    sourceIdByAiTaskId.set(aiTask.id, sourceId)
    aiTaskById.set(aiTask.id, aiTask)
  }
  if (sourceIdByAiTaskId.size === 0) return tasks

  let changed = false
  const hydrated = tasks.map(task => {
    const sourceId = task.source_id || sourceIdByAiTaskId.get(task.id) || null
    const aiTask = aiTaskById.get(task.id) || (sourceId ? aiTasksBySourceId.get(sourceId) : undefined)
    const status = aiTask ? progressStatusForAiTask(aiTask) : null

    if (
      task.source_type === "mindmap" &&
      task.source_id &&
      (!status || status === task.status)
    ) {
      return task
    }

    if (!sourceId && (!status || status === task.status)) return task
    changed = true
    return {
      ...task,
      source_type: sourceId ? "mindmap" : task.source_type,
      source_id: sourceId ?? task.source_id,
      status: status && status !== task.status ? status : task.status,
    }
  })

  return changed ? hydrated : tasks
}
