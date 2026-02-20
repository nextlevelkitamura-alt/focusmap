import { Task } from "@/types/database"

export type TaskIndex = {
    byId: Map<string, Task>
    childrenByParentId: Map<string, Task[]>
    roots: Task[]
}

export function buildTaskIndex(groupTasks: Task[]): TaskIndex {
    const byId = new Map<string, Task>()
    const childrenByParentId = new Map<string, Task[]>()
    const roots: Task[] = []

    for (const t of groupTasks) {
        if (!t?.id) continue
        byId.set(t.id, t)
        if (t.parent_task_id) {
            const arr = childrenByParentId.get(t.parent_task_id) ?? []
            arr.push(t)
            childrenByParentId.set(t.parent_task_id, arr)
        } else {
            roots.push(t)
        }
    }

    for (const [k, arr] of childrenByParentId.entries()) {
        arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        childrenByParentId.set(k, arr)
    }
    roots.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

    return { byId, childrenByParentId, roots }
}

export function getChildren(taskId: string, index: TaskIndex): Task[] {
    return index.childrenByParentId.get(taskId) ?? []
}

// Effective minutes for a task subtree:
// - leaf => own estimated_time
// - parent with override (estimated_time > 0) => override value (descendants ignored)
// - parent auto => sum of children's effective minutes
export function getTaskEffectiveMinutes(taskId: string, index: TaskIndex): number {
    const self = index.byId.get(taskId)
    if (!self) return 0
    const children = getChildren(taskId, index)
    if (children.length === 0) return self.estimated_time ?? 0

    if ((self.estimated_time ?? 0) > 0) return self.estimated_time

    return children.reduce((acc, child) => acc + getTaskEffectiveMinutes(child.id, index), 0)
}

// Auto minutes for a parent task (ignores the parent's own override)
export function getTaskAutoMinutes(taskId: string, index: TaskIndex): number {
    const children = getChildren(taskId, index)
    if (children.length === 0) return index.byId.get(taskId)?.estimated_time ?? 0
    return children.reduce((acc, child) => acc + getTaskEffectiveMinutes(child.id, index), 0)
}

export function getGroupAutoMinutes(index: TaskIndex): number {
    return index.roots.reduce((acc, root) => acc + getTaskEffectiveMinutes(root.id, index), 0)
}
