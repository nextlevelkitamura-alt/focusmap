"use client"

import { useCallback, useMemo } from 'react'
import { Task } from '@/types/database'

interface FlatItem {
    task: Task
    depth: number
    hasChildren: boolean
}

interface UseOutlineNavigationProps {
    groups: Task[]
    tasks: Task[]
    collapsedIds: Set<string>
    focusedTaskId: string | null
    onCreateGroup: (title: string) => Promise<Task | null>
    onCreateTask: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask: (taskId: string) => Promise<void>
    onDeleteGroup: (groupId: string) => Promise<void>
    onMoveTask: (taskId: string, newGroupId: string) => Promise<void>
    onReorderTask: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
}

interface UseOutlineNavigationReturn {
    flatItems: FlatItem[]
    handleEnter: () => Promise<string | null>
    handleIndent: () => Promise<void>
    handleOutdent: () => Promise<void>
    handleDelete: () => Promise<void>
    handleAddChild: () => Promise<string | null>
    canIndent: boolean
    canOutdent: boolean
}

export function useOutlineNavigation({
    groups,
    tasks,
    collapsedIds,
    focusedTaskId,
    onCreateGroup,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
    onDeleteGroup,
    onMoveTask,
    onReorderTask,
}: UseOutlineNavigationProps): UseOutlineNavigationReturn {

    // ツリーをDFS順でフラット化
    const flatItems = useMemo(() => {
        const allTasks = [...groups, ...tasks]
        const childrenMap = new Map<string, Task[]>()

        for (const t of tasks) {
            if (!t.parent_task_id) continue
            const arr = childrenMap.get(t.parent_task_id) ?? []
            arr.push(t)
            childrenMap.set(t.parent_task_id, arr)
        }

        // 子をorder_indexでソート
        for (const [, arr] of childrenMap) {
            arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        }

        const result: FlatItem[] = []

        const dfs = (task: Task, depth: number) => {
            const children = childrenMap.get(task.id) ?? []
            result.push({
                task,
                depth,
                hasChildren: children.length > 0,
            })
            if (!collapsedIds.has(task.id)) {
                for (const child of children) {
                    dfs(child, depth + 1)
                }
            }
        }

        // ルートグループをorder_indexでソートしてDFS
        const sortedGroups = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        for (const group of sortedGroups) {
            dfs(group, 0)
        }

        return result
    }, [groups, tasks, collapsedIds])

    // フォーカス中のアイテム情報
    const focusedItem = useMemo(() => {
        if (!focusedTaskId) return null
        return flatItems.find(item => item.task.id === focusedTaskId) ?? null
    }, [flatItems, focusedTaskId])

    const focusedIndex = useMemo(() => {
        if (!focusedTaskId) return -1
        return flatItems.findIndex(item => item.task.id === focusedTaskId)
    }, [flatItems, focusedTaskId])

    // 同じ親の兄弟を取得
    const getSiblings = useCallback((parentId: string | null) => {
        if (!parentId) {
            return [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        }
        return tasks
            .filter(t => t.parent_task_id === parentId)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [groups, tasks])

    // インデント可能: 直前の兄弟がいる場合（その子になれる）
    const canIndent = useMemo(() => {
        if (!focusedItem) return false
        const task = focusedItem.task
        // ルートグループはインデント不可
        if (!task.parent_task_id) return false
        const siblings = getSiblings(task.parent_task_id)
        const idx = siblings.findIndex(s => s.id === task.id)
        return idx > 0 // 直前の兄弟が存在
    }, [focusedItem, getSiblings])

    // アウトデント可能: depth > 1（ルートグループの直下より深い場合）
    const canOutdent = useMemo(() => {
        if (!focusedItem) return false
        return focusedItem.depth > 1
    }, [focusedItem])

    // Enter: 兄弟タスク追加
    const handleEnter = useCallback(async (): Promise<string | null> => {
        if (!focusedItem) {
            // フォーカスなし → 新規ルートグループ追加
            const newGroup = await onCreateGroup('')
            return newGroup?.id ?? null
        }

        const task = focusedItem.task

        if (!task.parent_task_id) {
            // ルートグループ → 新しいルートグループを追加
            const newGroup = await onCreateGroup('')
            return newGroup?.id ?? null
        }

        // 子タスク → 同じ親の下に兄弟を追加
        // groupId を特定（ルートグループまで遡る）
        const findRootGroupId = (taskId: string): string => {
            const t = [...groups, ...tasks].find(item => item.id === taskId)
            if (!t) return taskId
            if (!t.parent_task_id) return t.id
            return findRootGroupId(t.parent_task_id)
        }

        const rootGroupId = findRootGroupId(task.id)
        const newTask = await onCreateTask(rootGroupId, '', task.parent_task_id)
        return newTask?.id ?? null
    }, [focusedItem, groups, tasks, onCreateGroup, onCreateTask])

    // インデント: 直前の兄弟の子にする
    const handleIndent = useCallback(async () => {
        if (!focusedItem || !canIndent) return
        const task = focusedItem.task
        const siblings = getSiblings(task.parent_task_id)
        const idx = siblings.findIndex(s => s.id === task.id)
        if (idx <= 0) return

        const prevSibling = siblings[idx - 1]
        // parent_task_id を直前の兄弟に変更
        await onUpdateTask(task.id, { parent_task_id: prevSibling.id })
    }, [focusedItem, canIndent, getSiblings, onUpdateTask])

    // アウトデント: 親の兄弟レベルに移動
    const handleOutdent = useCallback(async () => {
        if (!focusedItem || !canOutdent) return
        const task = focusedItem.task
        if (!task.parent_task_id) return

        // 親タスクを取得
        const parent = [...groups, ...tasks].find(t => t.id === task.parent_task_id)
        if (!parent || !parent.parent_task_id) return

        // 親の親の子に移動
        await onUpdateTask(task.id, { parent_task_id: parent.parent_task_id })
    }, [focusedItem, canOutdent, groups, tasks, onUpdateTask])

    // 削除
    const handleDelete = useCallback(async () => {
        if (!focusedItem) return
        const task = focusedItem.task

        if (!task.parent_task_id) {
            // ルートグループ
            await onDeleteGroup(task.id)
        } else {
            await onDeleteTask(task.id)
        }
    }, [focusedItem, onDeleteGroup, onDeleteTask])

    // 子タスク追加
    const handleAddChild = useCallback(async (): Promise<string | null> => {
        if (!focusedItem) return null
        const task = focusedItem.task

        const findRootGroupId = (taskId: string): string => {
            const t = [...groups, ...tasks].find(item => item.id === taskId)
            if (!t) return taskId
            if (!t.parent_task_id) return t.id
            return findRootGroupId(t.parent_task_id)
        }

        const rootGroupId = findRootGroupId(task.id)
        const newTask = await onCreateTask(rootGroupId, '', task.id)
        return newTask?.id ?? null
    }, [focusedItem, groups, tasks, onCreateTask])

    return {
        flatItems,
        handleEnter,
        handleIndent,
        handleOutdent,
        handleDelete,
        handleAddChild,
        canIndent,
        canOutdent,
    }
}
