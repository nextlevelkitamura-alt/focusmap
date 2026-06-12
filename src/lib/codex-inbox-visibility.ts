import type { Task } from "@/types/database"

export function isCodexInboxTask(task: Pick<Task, "source" | "title">) {
  return task.source === "codex_inbox" || task.title === "Codex Inbox"
}

export function getHiddenCodexInboxTaskIds(tasks: Array<Pick<Task, "id" | "parent_task_id" | "source" | "title">>) {
  const hiddenIds = new Set<string>()
  const childrenByParentId = new Map<string, string[]>()

  for (const task of tasks) {
    if (isCodexInboxTask(task)) hiddenIds.add(task.id)
    const parentId = task.parent_task_id
    if (!parentId) continue
    const children = childrenByParentId.get(parentId) ?? []
    children.push(task.id)
    childrenByParentId.set(parentId, children)
  }

  const queue = Array.from(hiddenIds)
  for (let index = 0; index < queue.length; index += 1) {
    const parentId = queue[index]
    const children = childrenByParentId.get(parentId) ?? []
    for (const childId of children) {
      if (hiddenIds.has(childId)) continue
      hiddenIds.add(childId)
      queue.push(childId)
    }
  }

  return hiddenIds
}
