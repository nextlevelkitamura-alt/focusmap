import type { AiTask } from "@/types/ai-task"
import type { TaskProgressSnapshotTask } from "@/types/task-progress"

export function hydrateTaskProgressMindMapSources(
  tasks: TaskProgressSnapshotTask[],
  aiTasksBySourceId: ReadonlyMap<string, AiTask>,
) {
  if (tasks.length === 0 || aiTasksBySourceId.size === 0) return tasks

  const sourceIdByAiTaskId = new Map<string, string>()
  for (const [sourceId, aiTask] of aiTasksBySourceId.entries()) {
    if (!sourceId || !aiTask?.id) continue
    sourceIdByAiTaskId.set(aiTask.id, sourceId)
  }
  if (sourceIdByAiTaskId.size === 0) return tasks

  let changed = false
  const hydrated = tasks.map(task => {
    if (task.source_type === "mindmap" && task.source_id) return task
    const sourceId = sourceIdByAiTaskId.get(task.id)
    if (!sourceId) return task
    changed = true
    return {
      ...task,
      source_type: "mindmap",
      source_id: sourceId,
    }
  })

  return changed ? hydrated : tasks
}
