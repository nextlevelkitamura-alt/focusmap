/**
 * タスクとグループの統合ヘルパー関数
 * グループとタスクを is_group フラグで区別し、階層構造を扱う
 */

import { Task } from '@/types/database'

/**
 * タスクがグループかどうかを判定
 */
export function isGroup(task: Task): boolean {
  return task.is_group === true
}

/**
 * プロジェクト直下のグループを取得（is_group = true）
 */
export function getGroups(tasks: Task[], projectId: string): Task[] {
  return tasks
    .filter(t => t.project_id === projectId && isGroup(t))
    .sort((a, b) => a.order_index - b.order_index)
}

/**
 * グループ下のタスクを取得（parent_task_id = groupId, is_group = false）
 */
export function getTasksInGroup(tasks: Task[], groupId: string): Task[] {
  return tasks
    .filter(t => t.parent_task_id === groupId && !isGroup(t))
    .sort((a, b) => a.order_index - b.order_index)
}

/**
 * プロジェクト直下のタスクを取得（is_group = false）
 * ※グループを含まないルートレベルのタスク
 */
export function getRootTasks(tasks: Task[], projectId: string): Task[] {
  return tasks
    .filter(t => t.project_id === projectId && !isGroup(t))
    .sort((a, b) => a.order_index - b.order_index)
}

/**
 * 特定のタスクの子タスクを取得（親子階層）
 */
export function getChildTasks(tasks: Task[], parentTaskId: string): Task[] {
  return tasks
    .filter(t => t.parent_task_id === parentTaskId)
    .sort((a, b) => a.order_index - b.order_index)
}

/**
 * タスクが子を持つかどうかを判定
 */
export function hasChildren(tasks: Task[], taskId: string): boolean {
  return tasks.some(t => t.parent_task_id === taskId)
}

/**
 * グループが子タスクを持つかどうかを判定
 */
export function hasGroupChildren(tasks: Task[], groupId: string): boolean {
  return tasks.some(t => t.parent_task_id === groupId || (t.project_id === groupId && !isGroup(t)))
}

/**
 * タスクが別のタスクの子孫かどうかを判定（循環参照チェック用）
 */
export function isDescendant(tasks: Task[], ancestorId: string, childId: string): boolean {
  const taskById = new Map(tasks.map(t => [t.id, t]))
  let current = taskById.get(childId)
  const visited = new Set<string>()

  while (current?.parent_task_id) {
    if (current.parent_task_id === ancestorId) return true
    if (visited.has(current.parent_task_id)) break // 循環参照を防ぐ
    visited.add(current.parent_task_id)
    current = taskById.get(current.parent_task_id)
  }

  return false
}

/**
 * タスクの完全な階層パスを取得（例: ["Group 1", "Task 1", "Subtask 1"]）
 */
export function getTaskPath(tasks: Task[], taskId: string): string[] {
  const taskById = new Map(tasks.map(t => [t.id, t]))
  const path: string[] = []
  let current = taskById.get(taskId)

  while (current) {
    path.unshift(current.title)
    if (current.parent_task_id) {
      current = taskById.get(current.parent_task_id)
    } else {
      break
    }
  }

  return path
}

/**
 * グループの統計情報を取得
 */
export function getGroupStats(tasks: Task[], groupId: string) {
  const groupTasks = tasks.filter(t => t.parent_task_id === groupId && !isGroup(t))

  const total = groupTasks.length
  const completed = groupTasks.filter(t => t.status === 'done').length
  const inProgress = groupTasks.filter(t => t.status === 'in_progress').length
  const todo = groupTasks.filter(t => t.status === 'todo').length

  return {
    total,
    completed,
    inProgress,
    todo,
    completionRate: total > 0 ? (completed / total) * 100 : 0,
  }
}
