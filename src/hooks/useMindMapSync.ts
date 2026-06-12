"use client"

import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { flushSync } from 'react-dom'
import { createClient } from '@/utils/supabase/client'
import type { Database, Task } from '@/types/database'
import { useNotificationScheduler } from '@/hooks/useNotificationScheduler'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { deriveStageUpdate } from '@/lib/stage-utils'
import { LINKED_TASK_STATUS_EVENT, WISHLIST_REFRESH_EVENT } from '@/lib/calendar-constants'

interface UseMindMapSyncProps {
    projectId: string | null
    userId: string
    initialRootTasks?: Task[]  // ルートタスク（parent_task_id === null）
    initialTasks?: Task[]      // 子タスク（parent_task_id !== null）
    onSyncError?: (message: string) => void
}

interface UseMindMapSyncReturn {
    groups: Task[]              // ルートタスク（parent_task_id === null）
    tasks: Task[]               // 子タスク（parent_task_id !== null）
    createGroup: (title: string) => Promise<Task | null>
    updateGroupTitle: (groupId: string, newTitle: string) => Promise<void>
    updateGroup: (groupId: string, updates: Partial<Task>) => Promise<void>
    deleteGroup: (groupId: string) => Promise<void>
    createTask: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    updateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    deleteTask: (taskId: string) => Promise<void>
    moveTask: (taskId: string, newGroupId: string) => Promise<void>
    updateProjectTitle: (projectId: string, title: string) => Promise<void>
    bulkDelete: (groupIds: string[], taskIds: string[]) => Promise<void>
    reorderTask: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
    reorderGroup: (groupId: string, referenceGroupId: string, position: 'above' | 'below') => Promise<void>
    promoteTaskToGroup: (taskId: string) => Promise<void>
    isLoading: boolean
    getChildTasks: (parentTaskId: string) => Task[]
    getParentTasks: (groupId: string) => Task[]
    refreshFromServer: (options?: { force?: boolean; staleMs?: number; silent?: boolean; notifyOnError?: boolean }) => Promise<void>
    undo: () => Promise<string | null>
    redo: () => Promise<string | null>
    canUndo: () => boolean
    canRedo: () => boolean
}

function dispatchLinkedTaskStatus(taskId: string, status: string) {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(LINKED_TASK_STATUS_EVENT, {
        detail: { taskId, status },
    }))
}

type TaskRealtimePayload = {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE'
    new: Partial<Task>
    old: Partial<Task>
}

type DeletedTaskMemoRepairSnapshot = {
    deleted_task_ids?: string[]
    structured_links?: Array<Record<string, unknown>>
    memo_items?: Array<Record<string, unknown>>
    wishlist_items?: Array<Record<string, unknown> & { id?: unknown }>
}

const REALTIME_FALLBACK_POLL_INTERVAL_MS = 3_000
const REALTIME_FALLBACK_STATUSES = new Set(['CHANNEL_ERROR', 'TIMED_OUT'])
const MINDMAP_CACHE_PREFIX = 'focusmap:mindmap:project:'
const MINDMAP_CACHE_TTL_MS = 12 * 60 * 60 * 1000

type MindmapCachePayload = {
    projectId?: string
    tasks?: Task[]
    cachedAt?: number
}

type PendingMindmapDelete = {
    operationId: string
    projectId: string
    taskIds: string[]
    tasks: Task[]
    deleteRequestIds: string[]
    requestedAt: number
}

type MindmapPendingDeletePayload = {
    projectId?: string
    operations?: PendingMindmapDelete[]
}

type PendingMindmapCollapse = {
    projectId: string
    taskId: string
    collapsed: boolean
    requestedAt: number
}

type MindmapPendingCollapsePayload = {
    projectId?: string
    collapses?: PendingMindmapCollapse[]
}

function isPageVisible() {
    return typeof document === 'undefined' || document.visibilityState === 'visible'
}

function getMindmapCacheKey(projectId: string) {
    return `${MINDMAP_CACHE_PREFIX}${projectId}`
}

function getMindmapPendingDeleteKey(projectId: string) {
    return `${MINDMAP_CACHE_PREFIX}${projectId}:pending-deletes`
}

function getMindmapPendingCollapseKey(projectId: string) {
    return `${MINDMAP_CACHE_PREFIX}${projectId}:pending-collapses`
}

function readMindmapPendingDeletes(projectId: string | null): Map<string, PendingMindmapDelete> {
    const operations = new Map<string, PendingMindmapDelete>()
    if (!projectId || typeof window === 'undefined') return operations

    try {
        const raw = window.localStorage.getItem(getMindmapPendingDeleteKey(projectId))
        if (!raw) return operations

        const parsed = JSON.parse(raw) as MindmapPendingDeletePayload
        if (parsed.projectId !== projectId || !Array.isArray(parsed.operations)) return operations

        for (const operation of parsed.operations) {
            if (
                operation?.projectId === projectId &&
                typeof operation.operationId === 'string' &&
                Array.isArray(operation.taskIds) &&
                Array.isArray(operation.tasks) &&
                Array.isArray(operation.deleteRequestIds)
            ) {
                operations.set(operation.operationId, operation)
            }
        }
    } catch {
        window.localStorage.removeItem(getMindmapPendingDeleteKey(projectId))
    }

    return operations
}

function readMindmapPendingCollapses(projectId: string | null): Map<string, PendingMindmapCollapse> {
    const collapses = new Map<string, PendingMindmapCollapse>()
    if (!projectId || typeof window === 'undefined') return collapses

    try {
        const raw = window.localStorage.getItem(getMindmapPendingCollapseKey(projectId))
        if (!raw) return collapses

        const parsed = JSON.parse(raw) as MindmapPendingCollapsePayload
        if (parsed.projectId !== projectId || !Array.isArray(parsed.collapses)) return collapses

        for (const collapse of parsed.collapses) {
            if (
                collapse?.projectId === projectId &&
                typeof collapse.taskId === 'string' &&
                typeof collapse.collapsed === 'boolean'
            ) {
                collapses.set(collapse.taskId, collapse)
            }
        }
    } catch {
        window.localStorage.removeItem(getMindmapPendingCollapseKey(projectId))
    }

    return collapses
}

function writeMindmapPendingDeletes(projectId: string, operations: Map<string, PendingMindmapDelete>) {
    if (typeof window === 'undefined') return

    try {
        const values = Array.from(operations.values()).filter(operation => operation.projectId === projectId)
        if (values.length === 0) {
            window.localStorage.removeItem(getMindmapPendingDeleteKey(projectId))
            return
        }
        window.localStorage.setItem(getMindmapPendingDeleteKey(projectId), JSON.stringify({
            projectId,
            operations: values,
        }))
    } catch {
        // In-memory pending deletes still protect the current UI session.
    }
}

function writeMindmapPendingCollapses(projectId: string, collapses: Map<string, PendingMindmapCollapse>) {
    if (typeof window === 'undefined') return

    try {
        const values = Array.from(collapses.values()).filter(collapse => collapse.projectId === projectId)
        if (values.length === 0) {
            window.localStorage.removeItem(getMindmapPendingCollapseKey(projectId))
            return
        }
        window.localStorage.setItem(getMindmapPendingCollapseKey(projectId), JSON.stringify({
            projectId,
            collapses: values,
        }))
    } catch {
        // In-memory pending collapse states still protect the current UI session.
    }
}

function getPendingDeleteTaskIds(projectId: string | null): Set<string> {
    const ids = new Set<string>()
    for (const operation of readMindmapPendingDeletes(projectId).values()) {
        for (const taskId of operation.taskIds) ids.add(taskId)
    }
    return ids
}

function filterPendingDeletedTasks(projectId: string | null, tasks: Task[]) {
    const pendingIds = getPendingDeleteTaskIds(projectId)
    if (pendingIds.size === 0) return tasks
    return tasks.filter(task => !pendingIds.has(task.id))
}

function applyPendingMindmapCollapses(projectId: string | null, tasks: Task[]) {
    const pending = readMindmapPendingCollapses(projectId)
    if (pending.size === 0) return tasks

    let changed = false
    const next = tasks.map(task => {
        const collapse = pending.get(task.id)
        if (!collapse || task.mindmap_collapsed === collapse.collapsed) return task
        changed = true
        return { ...task, mindmap_collapsed: collapse.collapsed }
    })
    return changed ? next : tasks
}

function getMindmapCollapseUpdateValue(updates: Partial<Task>) {
    const keys = Object.keys(updates)
    if (keys.length !== 1 || keys[0] !== 'mindmap_collapsed') return null
    return typeof updates.mindmap_collapsed === 'boolean' ? updates.mindmap_collapsed : null
}

function isSameTaskValue(a: Task, b: Task) {
    const keys = new Set<keyof Task>([
        ...(Object.keys(a) as (keyof Task)[]),
        ...(Object.keys(b) as (keyof Task)[]),
    ])
    for (const key of keys) {
        if (!Object.is(a[key], b[key])) return false
    }
    return true
}

function isSameTaskListByValue(a: Task[], b: Task[]) {
    return a.length === b.length && a.every((task, index) => isSameTaskValue(task, b[index]))
}

function readMindmapCache(projectId: string | null): Task[] {
    if (!projectId || typeof window === 'undefined') return []

    try {
        const raw = window.localStorage.getItem(getMindmapCacheKey(projectId))
        if (!raw) return []

        const parsed = JSON.parse(raw) as MindmapCachePayload
        if (parsed.projectId !== projectId || !Array.isArray(parsed.tasks) || typeof parsed.cachedAt !== 'number') {
            return []
        }
        if (Date.now() - parsed.cachedAt > MINDMAP_CACHE_TTL_MS) {
            window.localStorage.removeItem(getMindmapCacheKey(projectId))
            return []
        }

        return applyPendingMindmapCollapses(projectId, filterPendingDeletedTasks(
            projectId,
            parsed.tasks.filter(task => task.project_id === projectId && task.deleted_at === null),
        ))
    } catch {
        return []
    }
}

function writeMindmapCache(projectId: string, tasks: Task[]) {
    if (typeof window === 'undefined' || tasks.length === 0) return

    try {
        window.localStorage.setItem(getMindmapCacheKey(projectId), JSON.stringify({
            projectId,
            tasks: filterPendingDeletedTasks(
                projectId,
                tasks.filter(task => task.project_id === projectId && task.deleted_at === null),
            ),
            cachedAt: Date.now(),
        }))
        window.localStorage.setItem('focusmap:lastMindmapProjectId', projectId)
    } catch {
        // The current in-memory state is still authoritative while the app is open.
    }
}

function withoutGoogleEventId(task: Task) {
    return { ...task, google_event_id: null }
}

function dispatchWishlistRefresh() {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
}

export function useMindMapSync({
    projectId,
    userId,
    initialRootTasks = [],
    initialTasks = [],
    onSyncError,
}: UseMindMapSyncProps): UseMindMapSyncReturn {
    const supabase = useMemo(() => createClient(), [])
    const { cancelNotifications } = useNotificationScheduler()

    // 統合ステート管理（全タスクを1つのリストで管理）
    const [allTasks, setAllTasks] = useState<Task[]>(() => {
        const initial = applyPendingMindmapCollapses(
            projectId,
            filterPendingDeletedTasks(projectId, [...initialRootTasks, ...initialTasks])
        )
        return initial.length > 0 ? initial : readMindmapCache(projectId)
    })
    const [isLoading, setIsLoading] = useState(false)
    const [realtimeFallbackActive, setRealtimeFallbackActive] = useState(false)
    const { pushAction, undo, redo, canUndo, canRedo, clear } = useUndoRedo()

    // INSERT の Promise を追跡（親の INSERT 完了を子が待機するため）
    const pendingInserts = useRef(new Map<string, Promise<void>>())

    // 楽観的に作成されたタスクを保護（INSERT 完了まで state からの削除を防止）
    const pendingOptimisticTasks = useRef(new Map<string, Task>())
    const pendingDeletes = useRef(readMindmapPendingDeletes(projectId))
    const pendingCollapsedStates = useRef(readMindmapPendingCollapses(projectId))

    // タスクごとの保存順序を保証する。
    // UIは先に楽観更新し、DB保存だけをキュー化することで連打時も最後の操作が残る。
    const taskSaveQueues = useRef(new Map<string, Promise<void>>())
    const taskUpdateVersions = useRef(new Map<string, number>())
    const lastServerRefreshAt = useRef(Date.now())
    const refreshInFlight = useRef<Promise<void> | null>(null)
    const realtimeFallbackActiveRef = useRef(false)
    const realtimeFallbackRefreshErrorNotifiedRef = useRef(false)

    // 最新の allTasks を参照するための ref（callback の依存配列から除外するため）
    const allTasksRef = useRef(allTasks)
    allTasksRef.current = allTasks
    const projectIdRef = useRef(projectId)
    projectIdRef.current = projectId

    const persistPendingCollapsedStates = useCallback(() => {
        const currentProjectId = projectIdRef.current
        if (!currentProjectId) return
        writeMindmapPendingCollapses(currentProjectId, pendingCollapsedStates.current)
    }, [])

    const getLocalPendingDeleteIds = useCallback(() => {
        const ids = new Set<string>()
        for (const operation of pendingDeletes.current.values()) {
            for (const taskId of operation.taskIds) ids.add(taskId)
        }
        return ids
    }, [])

    const persistPendingDeletes = useCallback(() => {
        const currentProjectId = projectIdRef.current
        if (!currentProjectId) return
        writeMindmapPendingDeletes(currentProjectId, pendingDeletes.current)
    }, [])

    const removeTasksFromState = useCallback((ids: Set<string>) => {
        allTasksRef.current = allTasksRef.current.filter(task => !ids.has(task.id))
        setAllTasks(prev => prev.filter(task => !ids.has(task.id)))
    }, [])

    const restoreTasksToState = useCallback((capturedTasks: Task[]) => {
        if (capturedTasks.length === 0) return
        const restoreIds = new Set(capturedTasks.map(task => task.id))
        allTasksRef.current = [
            ...allTasksRef.current.filter(task => !restoreIds.has(task.id)),
            ...capturedTasks,
        ]
        setAllTasks(prev => [
            ...prev.filter(task => !restoreIds.has(task.id)),
            ...capturedTasks,
        ])
    }, [])

    const applyCollapsedStateToState = useCallback((taskId: string, collapsed: boolean) => {
        allTasksRef.current = allTasksRef.current.map(task =>
            task.id === taskId ? { ...task, mindmap_collapsed: collapsed } : task
        )
        setAllTasks(prev => prev.map(task =>
            task.id === taskId ? { ...task, mindmap_collapsed: collapsed } : task
        ))
    }, [])

    const queuePendingCollapsedState = useCallback((taskId: string, collapsed: boolean) => {
        const currentProjectId = projectIdRef.current
        if (!currentProjectId) return
        pendingCollapsedStates.current.set(taskId, {
            projectId: currentProjectId,
            taskId,
            collapsed,
            requestedAt: Date.now(),
        })
        persistPendingCollapsedStates()
        applyCollapsedStateToState(taskId, collapsed)
    }, [applyCollapsedStateToState, persistPendingCollapsedStates])

    const clearPendingCollapsedState = useCallback((taskId: string) => {
        if (!pendingCollapsedStates.current.delete(taskId)) return
        persistPendingCollapsedStates()
    }, [persistPendingCollapsedStates])

    const beginPendingDelete = useCallback((operation: PendingMindmapDelete) => {
        pendingDeletes.current.set(operation.operationId, operation)
        persistPendingDeletes()
        const deletedIds = new Set(operation.taskIds)
        for (const id of deletedIds) {
            pendingOptimisticTasks.current.delete(id)
            pendingInserts.current.delete(id)
            taskSaveQueues.current.delete(id)
            taskUpdateVersions.current.delete(id)
        }
        removeTasksFromState(deletedIds)
    }, [persistPendingDeletes, removeTasksFromState])

    const completePendingDelete = useCallback((operationId: string) => {
        if (!pendingDeletes.current.delete(operationId)) return
        persistPendingDeletes()
    }, [persistPendingDeletes])

    const rollbackPendingDelete = useCallback((operationId: string) => {
        const operation = pendingDeletes.current.get(operationId)
        if (!operation) return
        pendingDeletes.current.delete(operationId)
        persistPendingDeletes()
        restoreTasksToState(operation.tasks)
    }, [persistPendingDeletes, restoreTasksToState])

    const retryPendingDeletes = useCallback(async () => {
        const currentProjectId = projectIdRef.current
        if (!currentProjectId) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return

        const operations = Array.from(pendingDeletes.current.values())
            .filter(operation => operation.projectId === currentProjectId)
        for (const operation of operations) {
            let networkFailed = false
            let hardFailed = false
            for (const id of operation.deleteRequestIds) {
                try {
                    const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
                    if (!response.ok && response.status !== 404) {
                        hardFailed = true
                    }
                } catch (error) {
                    console.error('[Sync] pending delete retry failed:', error)
                    networkFailed = true
                    break
                }
            }

            if (!networkFailed && !hardFailed) {
                completePendingDelete(operation.operationId)
                dispatchWishlistRefresh()
            } else if (hardFailed) {
                rollbackPendingDelete(operation.operationId)
                onSyncError?.('保留中の削除を同期できなかったため、ノードを戻しました')
            }
        }
    }, [completePendingDelete, onSyncError, rollbackPendingDelete])

    const addOptimisticTaskToState = useCallback((task: Task) => {
        allTasksRef.current = allTasksRef.current.some(t => t.id === task.id)
            ? allTasksRef.current
            : [...allTasksRef.current, task]

        const commit = () => {
            setAllTasks(prev => prev.some(t => t.id === task.id) ? prev : [...prev, task])
        }

        if (typeof window !== 'undefined') {
            flushSync(commit)
        } else {
            commit()
        }
    }, [])

    const applyTaskUpdatesToState = useCallback((updates: Array<{ id: string } & Partial<Task>>) => {
        if (updates.length === 0) return
        const updatesById = new Map(updates.map(update => [update.id, update]))
        const applyUpdates = (tasks: Task[]) => tasks.map(task => {
            const update = updatesById.get(task.id)
            return update ? { ...task, ...update } : task
        })
        allTasksRef.current = applyUpdates(allTasksRef.current)
        setAllTasks(prev => applyUpdates(prev))
    }, [])

    const restoreMemoRepairSnapshot = useCallback(async (snapshot: DeletedTaskMemoRepairSnapshot | null) => {
        if (!snapshot) return

        const structuredLinks = snapshot.structured_links ?? []
        if (structuredLinks.length > 0) {
            const { error } = await supabase
                .from('memo_node_links')
                .upsert(structuredLinks as Database['public']['Tables']['memo_node_links']['Insert'][])
            if (error) console.error('[UndoRedo] restore memo_node_links failed:', error)
        }

        const memoItems = snapshot.memo_items ?? []
        if (memoItems.length > 0) {
            const { error } = await supabase
                .from('memo_items')
                .upsert(memoItems as Database['public']['Tables']['memo_items']['Insert'][])
            if (error) console.error('[UndoRedo] restore memo_items failed:', error)
        }

        const wishlistItems = snapshot.wishlist_items ?? []
        for (const item of wishlistItems) {
            if (typeof item.id !== 'string') continue
            const { id, ...updates } = item
            const { error } = await supabase
                .from('ideal_goals')
                .update({ ...updates, updated_at: new Date().toISOString() } as Database['public']['Tables']['ideal_goals']['Update'])
                .eq('id', id)
            if (error) console.error('[UndoRedo] restore wishlist memo failed:', error)
        }

        dispatchWishlistRefresh()
    }, [supabase])

    const applyRealtimeTask = useCallback((serverTask: Task) => {
        const pendingCollapse = pendingCollapsedStates.current.get(serverTask.id)
        const effectiveServerTask = pendingCollapse
            ? { ...serverTask, mindmap_collapsed: pendingCollapse.collapsed }
            : serverTask

        if (!effectiveServerTask.id || effectiveServerTask.project_id !== projectId) return
        if (getLocalPendingDeleteIds().has(effectiveServerTask.id)) return
        if (effectiveServerTask.deleted_at !== null) {
            pendingOptimisticTasks.current.delete(effectiveServerTask.id)
            pendingInserts.current.delete(effectiveServerTask.id)
            taskSaveQueues.current.delete(effectiveServerTask.id)
            taskUpdateVersions.current.delete(effectiveServerTask.id)
            pendingCollapsedStates.current.delete(effectiveServerTask.id)
            persistPendingCollapsedStates()
            removeTasksFromState(new Set([effectiveServerTask.id]))
            return
        }

        const hasLocalSaveInFlight =
            pendingInserts.current.has(effectiveServerTask.id) ||
            taskSaveQueues.current.has(effectiveServerTask.id) ||
            pendingOptimisticTasks.current.has(effectiveServerTask.id)

        if (!hasLocalSaveInFlight) {
            pendingOptimisticTasks.current.delete(effectiveServerTask.id)
        }

        const mergeTask = (existing: Task | undefined): Task => {
            if (!existing) return effectiveServerTask
            if (!hasLocalSaveInFlight) return { ...existing, ...effectiveServerTask }

            return {
                ...effectiveServerTask,
                ...existing,
                user_id: effectiveServerTask.user_id ?? existing.user_id,
                project_id: effectiveServerTask.project_id ?? existing.project_id,
                created_at: effectiveServerTask.created_at ?? existing.created_at,
                updated_at: existing.updated_at ?? effectiveServerTask.updated_at,
            }
        }

        const applyServerTask = (tasks: Task[]) => {
            const existing = tasks.find(task => task.id === effectiveServerTask.id)
            if (!existing) return [...tasks, effectiveServerTask]
            return tasks.map(task => task.id === effectiveServerTask.id ? mergeTask(task) : task)
        }

        allTasksRef.current = applyServerTask(allTasksRef.current)
        setAllTasks(prev => applyServerTask(prev))
    }, [getLocalPendingDeleteIds, persistPendingCollapsedStates, projectId, removeTasksFromState])

    const removeRealtimeTask = useCallback((taskId: string) => {
        if (!taskId) return
        pendingOptimisticTasks.current.delete(taskId)
        pendingInserts.current.delete(taskId)
        taskSaveQueues.current.delete(taskId)
        taskUpdateVersions.current.delete(taskId)
        pendingCollapsedStates.current.delete(taskId)
        persistPendingCollapsedStates()
        allTasksRef.current = allTasksRef.current.filter(task => task.id !== taskId)
        setAllTasks(prev => prev.filter(task => task.id !== taskId))
    }, [persistPendingCollapsedStates])

    const handleRealtimeTaskEvent = useCallback((payload: TaskRealtimePayload) => {
        if (payload.eventType === 'DELETE') {
            const taskId = payload.old?.id
            if (typeof taskId === 'string') removeRealtimeTask(taskId)
            return
        }

        const serverTask = payload.new
        if (!serverTask?.id) return
        applyRealtimeTask(serverTask as Task)
    }, [applyRealtimeTask, removeRealtimeTask])

    const retryPendingCollapsedStates = useCallback(async () => {
        const currentProjectId = projectIdRef.current
        if (!currentProjectId) return
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return

        const operations = Array.from(pendingCollapsedStates.current.values())
            .filter(operation => operation.projectId === currentProjectId)

        for (const operation of operations) {
            try {
                const response = await fetch(`/api/tasks/${operation.taskId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mindmap_collapsed: operation.collapsed }),
                })

                if (response.ok) {
                    clearPendingCollapsedState(operation.taskId)
                    const data = await response.json().catch(() => null) as { task?: Task } | null
                    if (data?.task) applyRealtimeTask(data.task)
                    continue
                }

                if (response.status === 404) {
                    clearPendingCollapsedState(operation.taskId)
                }
            } catch (error) {
                console.warn('[Sync] pending collapse retry failed:', error)
                break
            }
        }
    }, [applyRealtimeTask, clearPendingCollapsedState])

    // 計算プロパティ: ルートタスクと子タスクを分離
    const groups = useMemo(() => {
        return allTasks
            .filter(t => !t.parent_task_id)
            .sort((a, b) => a.order_index - b.order_index)
    }, [allTasks])

    const tasks = useMemo(() => {
        return allTasks
            .filter(t => !!t.parent_task_id)
            .sort((a, b) => a.order_index - b.order_index)
    }, [allTasks])

    // 初期データの更新時に統合（楽観的タスクを保護するマージ方式）
    // 楽観的タスクは現在のprojectIdに属するもののみ保持（プロジェクト切替時に前のデータが残るのを防止）
    useEffect(() => {
        setAllTasks(prev => {
            const pendingDeleteIds = getLocalPendingDeleteIds()
            const initial = [...initialRootTasks, ...initialTasks].filter(task => !pendingDeleteIds.has(task.id))
            const cached = initial.length > 0 ? [] : readMindmapCache(projectId)
            const baseTasks = applyPendingMindmapCollapses(projectId, initial.length > 0 ? initial : cached)
            const allInitialIds = new Set([
                ...baseTasks.map(t => t.id),
            ]);
            const optimisticItems = prev.filter(t =>
                !allInitialIds.has(t.id) && t.project_id === projectId && !pendingDeleteIds.has(t.id)
            );
            const nextTasks = [
                ...baseTasks,
                ...optimisticItems
            ];
            return isSameTaskListByValue(prev, nextTasks) ? prev : nextTasks
        });
    }, [getLocalPendingDeleteIds, initialRootTasks, initialTasks, projectId])

    useEffect(() => {
        if (!projectId) return
        const projectTasks = allTasks.filter(task => task.project_id === projectId && task.deleted_at === null)
        writeMindmapCache(projectId, projectTasks)
    }, [allTasks, projectId])

    // Watchdog: 楽観的タスクが state から消えた場合に再追加（現プロジェクトのみ）
    useEffect(() => {
        if (pendingOptimisticTasks.current.size === 0) return
        const currentIds = new Set(allTasks.map(t => t.id))
        const missingTasks: Task[] = []
        for (const [, task] of pendingOptimisticTasks.current) {
            if (!currentIds.has(task.id) && task.project_id === projectId && !getLocalPendingDeleteIds().has(task.id)) {
                missingTasks.push(task)
            }
        }
        if (missingTasks.length > 0) {
            console.warn('[Sync][Watchdog] Re-adding missing pending tasks:', missingTasks.map(t => t.id.slice(0, 8)))
            setAllTasks(prev => {
                const existingIds = new Set(prev.map(t => t.id))
                const toAdd = missingTasks.filter(t => !existingIds.has(t.id))
                if (toAdd.length === 0) return prev
                return [...prev, ...toAdd]
            })
        }
    }, [allTasks, getLocalPendingDeleteIds, projectId])

    // プロジェクト切替時にundo/redoスタックと楽観的タスクをクリア
    useEffect(() => {
        clear()
        pendingOptimisticTasks.current.clear()
        pendingInserts.current.clear()
        taskSaveQueues.current.clear()
        taskUpdateVersions.current.clear()
        pendingDeletes.current = readMindmapPendingDeletes(projectId)
        pendingCollapsedStates.current = readMindmapPendingCollapses(projectId)
        lastServerRefreshAt.current = 0
        refreshInFlight.current = null
        realtimeFallbackActiveRef.current = false
        realtimeFallbackRefreshErrorNotifiedRef.current = false
        setRealtimeFallbackActive(false)
    }, [projectId, clear])

    useEffect(() => {
        pendingDeletes.current = readMindmapPendingDeletes(projectId)
        void retryPendingDeletes()

        if (typeof window === 'undefined') return
        const handleOnline = () => {
            void retryPendingDeletes()
        }
        window.addEventListener('online', handleOnline)
        return () => window.removeEventListener('online', handleOnline)
    }, [projectId, retryPendingDeletes])

    useEffect(() => {
        pendingCollapsedStates.current = readMindmapPendingCollapses(projectId)
        void retryPendingCollapsedStates()

        if (typeof window === 'undefined') return
        const handleOnline = () => {
            void retryPendingCollapsedStates()
        }
        const handleVisibilityChange = () => {
            if (isPageVisible()) void retryPendingCollapsedStates()
        }
        window.addEventListener('online', handleOnline)
        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => {
            window.removeEventListener('online', handleOnline)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [projectId, retryPendingCollapsedStates])

    useEffect(() => {
        if (!projectId) return

        const channel = supabase
            .channel(`mindmap-tasks:${projectId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'tasks',
                    filter: `project_id=eq.${projectId}`,
                },
                payload => handleRealtimeTaskEvent(payload as TaskRealtimePayload)
            )
            .subscribe(status => {
                if (status === 'SUBSCRIBED') {
                    realtimeFallbackActiveRef.current = false
                    realtimeFallbackRefreshErrorNotifiedRef.current = false
                    setRealtimeFallbackActive(false)
                    return
                }
                if (REALTIME_FALLBACK_STATUSES.has(status)) {
                    console.warn('[Sync] realtime channel fallback:', status, projectId)
                    if (!realtimeFallbackActiveRef.current) {
                        realtimeFallbackActiveRef.current = true
                    }
                    setRealtimeFallbackActive(true)
                }
            })

        return () => {
            void supabase.removeChannel(channel)
        }
    }, [handleRealtimeTaskEvent, onSyncError, projectId, supabase])

    const enqueueTaskSave = useCallback((taskId: string, operation: () => Promise<void>) => {
        const previous = taskSaveQueues.current.get(taskId) ?? Promise.resolve()
        const save = previous.catch(() => undefined).then(operation)
        const tracked = save.finally(() => {
            if (taskSaveQueues.current.get(taskId) === tracked) {
                taskSaveQueues.current.delete(taskId)
            }
        })
        taskSaveQueues.current.set(taskId, tracked)
        return tracked
    }, [])

    // --- ルートタスク操作（旧Group操作 - 後方互換ラッパー） ---

    // ルートタスク作成（楽観的UI）
    const createGroup = useCallback(async (title: string): Promise<Task | null> => {
        if (!projectId) return null
        const optimisticId = crypto.randomUUID()
        const now = new Date().toISOString()
        const currentRootTasks = allTasksRef.current.filter(t => !t.parent_task_id)
        const maxOrder = currentRootTasks.length > 0 ? Math.max(...currentRootTasks.map(t => t.order_index)) + 1 : 0

        const optimisticTask: Task = {
            id: optimisticId,
            user_id: userId,
            project_id: projectId,
            is_group: true, // ルートタスク（グループ）なので true
            parent_task_id: null,
            title,
            status: 'todo',
            stage: 'plan',
            priority: null,
            order_index: maxOrder,
            scheduled_at: null,
            estimated_time: 0,
            actual_time_minutes: 0,
            google_event_id: null,
            calendar_event_id: null,
            calendar_id: null,
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            is_habit: false,
            habit_frequency: null,
            habit_icon: null,
            habit_start_date: null,
            habit_end_date: null,
            memo: null,
            memo_images: null,
            created_at: now,
            updated_at: now,
            source: 'manual',
            deleted_at: null,
            google_event_fingerprint: null,
            node_width: null,
            mindmap_collapsed: false,
        }

        pendingOptimisticTasks.current.set(optimisticId, optimisticTask)
        addOptimisticTaskToState(optimisticTask)

        pushAction({
            description: `「${title}」を作成`,
            undo: async () => {
                pendingOptimisticTasks.current.delete(optimisticId)
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId))
                await supabase.from('tasks').delete().eq('id', optimisticId)
            },
            redo: async () => {
                pendingOptimisticTasks.current.set(optimisticId, optimisticTask)
                setAllTasks(prev => [...prev, optimisticTask])
                await supabase.from('tasks').upsert(optimisticTask)
            },
        })

        // Background INSERT（APIルート経由 → 直接INSERT フォールバック）
        const insertPromise = (async () => {
            try {

                // APIルート経由でINSERT（サーバーサイド認証）
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: optimisticId,
                        project_id: projectId,
                        parent_task_id: null,
                        is_group: true,
                        title: title || 'New Task',
                        order_index: maxOrder,
                    }),
                });

                if (response.ok) {
                    pendingOptimisticTasks.current.delete(optimisticId)
                    return;
                }

                const errorText = await response.text();
                console.warn('[Sync] createGroup API INSERT failed:', errorText);

                // フォールバック: 直接Supabase INSERT
                const { error } = await supabase.from('tasks').insert({
                    id: optimisticId,
                    user_id: userId,
                    project_id: projectId,
                    is_group: true,
                    parent_task_id: null,
                    title: title || 'New Task',
                    status: 'todo',
                    order_index: maxOrder,
                    actual_time_minutes: 0,
                    estimated_time: 0,
                    is_habit: false,
                    habit_frequency: null,
                    habit_icon: null,
                })
                if (error) {
                    console.error('[Sync] createGroup direct INSERT also failed:', error);
                    throw error;
                }
                pendingOptimisticTasks.current.delete(optimisticId)
            } catch (e) {
                console.error('[Sync] createGroup ROLLBACK:', e)
                pendingOptimisticTasks.current.delete(optimisticId)
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId))
                onSyncError?.('グループの作成に失敗しました')
            }
        })();

        // CRITICAL: pendingInserts に登録してから INSERT を開始
        // これにより、子タスクが親の INSERT 完了を確実に待つことができる
        pendingInserts.current.set(optimisticId, insertPromise);
        insertPromise.finally(() => {
            pendingInserts.current.delete(optimisticId);
        });

        return optimisticTask
    }, [projectId, userId, supabase, pushAction, addOptimisticTaskToState, onSyncError])

    // updateGroupTitle → APIルート経由で更新
    const updateGroupTitle = useCallback(async (groupId: string, title: string) => {
        const oldTitle = allTasksRef.current.find(t => t.id === groupId)?.title ?? ''

        setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title } : t))

        pushAction({
            description: `「${oldTitle}」の名前変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title: oldTitle } : t))
                try {
                    await fetch(`/api/tasks/${groupId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: oldTitle }),
                    })
                } catch (e) {
                    console.error('[UndoRedo] undo updateGroupTitle failed:', e)
                }
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title } : t))
                try {
                    await fetch(`/api/tasks/${groupId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title }),
                    })
                } catch (e) {
                    console.error('[UndoRedo] redo updateGroupTitle failed:', e)
                }
            },
        })

        // CRITICAL FIX: Ensure any pending POST request for this group finishes before we PATCH
        const pendingInsert = pendingInserts.current.get(groupId)
        if (pendingInsert) {
            try {
                await pendingInsert
            } catch (e) {
                console.error('[Sync] updateGroupTitle: pending insert failed, continuing with PATCH anyway', e)
            }
        }

        try {
            const response = await fetch(`/api/tasks/${groupId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title }),
            })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] updateGroupTitle API failed:', errorData)
                // Rollback
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title: oldTitle } : t))
                return
            }
        } catch (e) {
            console.error('[Sync] updateGroupTitle failed:', e)
            setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title: oldTitle } : t))
        }
    }, [pushAction])

    // updateGroup → APIルート経由で更新
    const updateGroup = useCallback(async (groupId: string, updates: Partial<Task>) => {
        const beforeTask = allTasksRef.current.find(t => t.id === groupId)
        const beforeValues = beforeTask
            ? Object.fromEntries(
                (Object.keys(updates) as (keyof Task)[]).map(key => [key, beforeTask[key]])
            ) as Partial<Task>
            : {}

        setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...updates } : t))

        // CRITICAL FIX: Ensure any pending POST request for this group finishes before we PATCH
        const pendingInsert = pendingInserts.current.get(groupId)
        if (pendingInsert) {
            try {
                await pendingInsert
            } catch (e) {
                console.error('[Sync] updateGroup: pending insert failed, continuing with PATCH anyway', e)
            }
        }

        try {
            const response = await fetch(`/api/tasks/${groupId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] updateGroup API failed:', errorData)
                onSyncError?.(`グループの更新に失敗しました: ${errorData.message || response.statusText}`)
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...beforeValues } : t))
                return
            }
        } catch (e) {
            console.error('[Sync] updateGroup failed:', e)
            onSyncError?.(`グループの更新に失敗しました: ネットワークエラー`)
            setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...beforeValues } : t))
            return
        }

        pushAction({
            description: `設定を変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...beforeValues } : t))
                try {
                    await fetch(`/api/tasks/${groupId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(beforeValues),
                    })
                } catch (e) {
                    console.error('[UndoRedo] undo updateGroup failed:', e)
                }
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...updates } : t))
                try {
                    await fetch(`/api/tasks/${groupId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updates),
                    })
                } catch (e) {
                    console.error('[UndoRedo] redo updateGroup failed:', e)
                }
            },
        })
    }, [pushAction, onSyncError])

    // deleteGroup → APIルート経由で削除（deleteTaskと同じ方式）
    const deleteGroup = useCallback(async (groupId: string) => {
        const currentAll = allTasksRef.current
        const capturedTask = currentAll.find(t => t.id === groupId)
        const getDescendants = (id: string): Task[] => {
            const children = currentAll.filter(t => t.parent_task_id === id)
            return children.flatMap(c => [c, ...getDescendants(c.id)])
        }
        const capturedDescendants = getDescendants(groupId)
        const allCaptured = capturedTask ? [capturedTask, ...capturedDescendants] : capturedDescendants
        const allIds = new Set(allCaptured.map(t => t.id))
        const operation: PendingMindmapDelete = {
            operationId: `delete:${groupId}`,
            projectId: projectIdRef.current ?? capturedTask?.project_id ?? '',
            taskIds: Array.from(allIds),
            tasks: allCaptured,
            deleteRequestIds: [groupId],
            requestedAt: Date.now(),
        }

        beginPendingDelete(operation)

        // CRITICAL FIX: Ensure any pending POST request for this group finishes before we DELETE
        const pendingInsert = pendingInserts.current.get(groupId)
        if (pendingInsert) {
            try {
                await pendingInsert
            } catch (e) {
                console.error('[Sync] deleteGroup: pending insert failed, continuing with DELETE anyway', e)
            }
        }

        try {
            const response = await fetch(`/api/tasks/${groupId}`, { method: 'DELETE' })
            if (!response.ok) {
                if (response.status === 404) {
                    // DB上に存在しないグループ（ゴーストタスク）→ UIからの削除は成功とする
                    console.warn('[Sync] deleteGroup: group not found in DB (ghost task), removing from UI only:', groupId.slice(0, 8))
                    // ロールバックしない（DBにないのでUIから消すだけでOK）
                    completePendingDelete(operation.operationId)
                } else {
                    const errorData = await response.json().catch(() => ({ message: response.statusText }))
                    console.error('[Sync] deleteGroup API failed:', errorData)
                    onSyncError?.(`グループの削除に失敗しました: ${errorData.message || response.statusText}`)
                    rollbackPendingDelete(operation.operationId)
                    return
                }
            } else {
                completePendingDelete(operation.operationId)
            }
        } catch (e) {
            console.error('[Sync] deleteGroup failed:', e)
            onSyncError?.('オフラインのため、オンライン復帰後に削除を同期します')
            return
        }

        if (capturedTask) {
            pushAction({
                description: `「${capturedTask.title}」を削除`,
                undo: async () => {
                    const restored = allCaptured.map(t => ({ ...t, google_event_id: null }))
                    completePendingDelete(operation.operationId)
                    restoreTasksToState(restored)
                    for (const task of allCaptured) {
                        await supabase.from('tasks').upsert(withoutGoogleEventId(task))
                    }
                },
                redo: async () => {
                    beginPendingDelete({ ...operation, requestedAt: Date.now() })
                    try {
                        const redoResponse = await fetch(`/api/tasks/${groupId}`, { method: 'DELETE' })
                        if (redoResponse.ok || redoResponse.status === 404) {
                            completePendingDelete(operation.operationId)
                        } else {
                            rollbackPendingDelete(operation.operationId)
                        }
                    } catch (e) {
                        console.error('[UndoRedo] redo deleteGroup failed:', e)
                    }
                },
            })
        }
    }, [
        beginPendingDelete,
        completePendingDelete,
        pushAction,
        restoreTasksToState,
        rollbackPendingDelete,
        supabase,
        onSyncError,
    ])

    // --- タスク操作 ---
    const createTask = useCallback(async (groupId: string, title: string = "New Task", parentTaskId: string | null = null): Promise<Task | null> => {
        const optimisticId = crypto.randomUUID();
        const now = new Date().toISOString();

        const effectiveParentId = parentTaskId || groupId;
        const currentAll = allTasksRef.current;
        const siblingTasks = currentAll.filter(t => t.parent_task_id === effectiveParentId);
        const maxOrder = siblingTasks.length > 0 ? Math.max(...siblingTasks.map(t => t.order_index ?? 0)) + 1 : 0;

        const optimisticTask: Task = {
            id: optimisticId,
            user_id: userId,
            project_id: projectId,
            is_group: false,
            parent_task_id: effectiveParentId,
            title,
            status: 'todo',
            stage: 'plan',
            priority: null,
            order_index: maxOrder,
            scheduled_at: null,
            estimated_time: 0,
            actual_time_minutes: 0,
            google_event_id: null,
            calendar_event_id: null,
            calendar_id: null,
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            is_habit: false,
            habit_frequency: null,
            habit_icon: null,
            habit_start_date: null,
            habit_end_date: null,
            memo: null,
            memo_images: null,
            created_at: now,
            updated_at: now,
            source: 'manual',
            deleted_at: null,
            google_event_fingerprint: null,
            node_width: null,
            mindmap_collapsed: false,
        };

        pendingOptimisticTasks.current.set(optimisticId, optimisticTask);
        addOptimisticTaskToState(optimisticTask);

        pushAction({
            description: `タスクを作成`,
            undo: async () => {
                pendingOptimisticTasks.current.delete(optimisticId);
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId))
                try {
                    await fetch(`/api/tasks/${optimisticId}`, { method: 'DELETE' })
                } catch (e) {
                    console.error('[UndoRedo] undo createTask failed:', e)
                }
            },
            redo: async () => {
                pendingOptimisticTasks.current.set(optimisticId, optimisticTask);
                setAllTasks(prev => [...prev, optimisticTask])
                await supabase.from('tasks').upsert(optimisticTask)
            },
        })

        // Background sync: 親INSERT待機 → APIルート優先INSERT → 失敗時直接INSERTフォールバック
        const insertPromise = (async () => {
            try {

                // 親タスクの INSERT 完了を待機
                if (effectiveParentId) {
                    const parentPending = pendingInserts.current.get(effectiveParentId);
                    if (parentPending) {
                        await parentPending;
                    }
                }

                // APIルート経由でINSERT（サーバーサイド認証）
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: optimisticId,
                        project_id: projectId,
                        parent_task_id: effectiveParentId,
                        title: title || 'New Task',
                        order_index: maxOrder,
                    }),
                });

                if (response.ok) {
                    pendingOptimisticTasks.current.delete(optimisticId);
                    return;
                }

                const errorText = await response.text();
                console.warn('[Sync] createTask API INSERT failed:', errorText);

                // フォールバック: 直接Supabase INSERT
                const { error: insertError } = await supabase.from('tasks').insert({
                    id: optimisticId,
                    user_id: userId,
                    project_id: projectId,
                    parent_task_id: effectiveParentId,
                    is_group: false,
                    title: title || 'New Task',
                    status: 'todo',
                    order_index: maxOrder,
                    actual_time_minutes: 0,
                    estimated_time: 0,
                    is_habit: false,
                    habit_frequency: null,
                    habit_icon: null,
                });

                if (!insertError) {
                    pendingOptimisticTasks.current.delete(optimisticId);
                    return;
                }

                console.error('[Sync] createTask direct INSERT also failed:', insertError);
                console.error('[Sync] createTask ROLLBACK:', optimisticId.slice(0, 8));
                pendingOptimisticTasks.current.delete(optimisticId);
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId));
                onSyncError?.('タスクの作成に失敗しました')
            } catch (e) {
                console.error('[Sync] createTask unexpected error:', e);
                pendingOptimisticTasks.current.delete(optimisticId);
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId));
                onSyncError?.('タスクの作成に失敗しました')
            }
        })();

        // CRITICAL: pendingInserts に先に登録してから INSERT を開始
        // これにより、子タスクが親の INSERT 完了を確実に待つことができる
        pendingInserts.current.set(optimisticId, insertPromise);
        insertPromise.finally(() => {
            pendingInserts.current.delete(optimisticId);
        });

        return optimisticTask;
    }, [userId, projectId, supabase, pushAction, addOptimisticTaskToState, onSyncError]);

    const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
        const currentAll = allTasksRef.current;
        const beforeTask = currentAll.find(t => t.id === taskId)
        const updateVersion = (taskUpdateVersions.current.get(taskId) ?? 0) + 1
        taskUpdateVersions.current.set(taskId, updateVersion)
        const isLatestUpdate = () => taskUpdateVersions.current.get(taskId) === updateVersion

        // Stage 自動遷移: updates に stage 影響フィールドが含まれていれば stage も更新
        const stageUpdate = beforeTask ? deriveStageUpdate(updates, beforeTask) : {}
        const updatesWithStage = { ...updates, ...stageUpdate }
        const collapsedOnlyValue = getMindmapCollapseUpdateValue(updatesWithStage)

        if (!beforeTask) {
            // Task not in current project state (e.g. habit child from another project)
            await enqueueTaskSave(taskId, async () => {
                const pendingInsert = pendingInserts.current.get(taskId)
                if (pendingInsert) {
                    try {
                        await pendingInsert
                    } catch (e) {
                        console.error('[Sync] updateTask: pending insert failed, continuing with PATCH anyway', e)
                    }
                }

                // Still perform DB update via API route
                try {
                    const response = await fetch(`/api/tasks/${taskId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updatesWithStage),
                    })
                    if (!response.ok) {
                        if (collapsedOnlyValue !== null) {
                            queuePendingCollapsedState(taskId, collapsedOnlyValue)
                            return
                        }
                        console.error('[Sync] updateTask direct API error:', await response.text())
                        return
                    }
                    if (collapsedOnlyValue !== null) {
                        clearPendingCollapsedState(taskId)
                    }
                    const data = await response.json().catch(() => null) as { task?: Task } | null
                    if (data?.task?.project_id === projectIdRef.current) {
                        applyRealtimeTask(data.task)
                    }
                } catch (e) {
                    if (collapsedOnlyValue !== null) {
                        queuePendingCollapsedState(taskId, collapsedOnlyValue)
                        return
                    }
                    console.error('[Sync] updateTask direct API failed:', e)
                }
            })
            return
        }
        const beforeValues = Object.fromEntries(
            (Object.keys(updatesWithStage) as (keyof Task)[]).map(key => [key, beforeTask[key]])
        ) as Partial<Task>
        const preservesLocalDraftOnFailure = Object.prototype.hasOwnProperty.call(updatesWithStage, 'title') ||
            Object.prototype.hasOwnProperty.call(updatesWithStage, 'memo')
        const applyTaskValues = (values: Partial<Task>) => {
            allTasksRef.current = allTasksRef.current.map(t => t.id === taskId ? { ...t, ...values } : t)
            setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...values } : t))
        }
        const rollbackTaskValues = () => {
            applyTaskValues(beforeValues)
            if (typeof beforeValues.status === 'string') {
                dispatchLinkedTaskStatus(taskId, beforeValues.status)
            }
        }
        const notifyTaskSaveFailure = (message: string) => {
            onSyncError?.(preservesLocalDraftOnFailure
                ? '保存に失敗しました。端末の編集内容を保持しています。再度編集すると再同期します。'
                : message)
        }

        let parentAutoCompleteUndo: { parentId: string; beforeStatus: string } | null = null

        applyTaskValues(updatesWithStage)
        if (typeof updatesWithStage.status === 'string') {
            dispatchLinkedTaskStatus(taskId, updatesWithStage.status)
        }

        let didSave = false

        await enqueueTaskSave(taskId, async () => {
            // CRITICAL FIX: Ensure any pending POST request for this task finishes before we PATCH
            const pendingInsert = pendingInserts.current.get(taskId)
            if (pendingInsert) {
                try {
                    await pendingInsert
                } catch (e) {
                    console.error('[Sync] updateTask: pending insert failed, continuing with PATCH anyway', e)
                }
            }

            try {
                const response = await fetch(`/api/tasks/${taskId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updatesWithStage),
                })
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: response.statusText }))
                    console.error('[Sync] updateTask API error:', errorData)
                    if (collapsedOnlyValue !== null) {
                        queuePendingCollapsedState(taskId, collapsedOnlyValue)
                        return
                    }
                    if (isLatestUpdate()) {
                        notifyTaskSaveFailure(`保存に失敗しました: ${errorData.message || response.statusText}`)
                        if (!preservesLocalDraftOnFailure) rollbackTaskValues()
                    }
                    return
                }
                await response.json().catch(() => null)
                if (collapsedOnlyValue !== null) {
                    clearPendingCollapsedState(taskId)
                }
                didSave = true

                if (!isLatestUpdate()) return

                // AUTO-COMPLETE PARENT
                if (updates.status === 'done') {
                    const latestAll = allTasksRef.current.map(t =>
                        t.id === taskId ? { ...t, ...updatesWithStage } : t
                    )
                    const task = latestAll.find(t => t.id === taskId);
                    if (task?.parent_task_id) {
                        const siblings = latestAll.filter(t => t.parent_task_id === task.parent_task_id)
                        const allSiblingsDone = siblings.length > 0 && siblings.every(s => s.status === 'done');

                        if (allSiblingsDone) {
                            const parent = latestAll.find(t => t.id === task.parent_task_id)
                            // 習慣タスクは AUTO-COMPLETE しない（日次完了で親が完了扱いになるのを防止）
                            if (parent && parent.status !== 'done' && !parent.is_habit) {
                                parentAutoCompleteUndo = { parentId: task.parent_task_id, beforeStatus: parent.status }
                                setAllTasks(prev => prev.map(t =>
                                    t.id === task.parent_task_id ? { ...t, status: 'done' } : t
                                ));
                                dispatchLinkedTaskStatus(task.parent_task_id, 'done')
                                try {
                                    const parentRes = await enqueueTaskSave(task.parent_task_id, async () => {
                                        const res = await fetch(`/api/tasks/${task.parent_task_id}`, {
                                            method: 'PATCH',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ status: 'done', stage: 'done' }),
                                        })
                                        if (!res.ok) throw new Error('auto-complete parent API error')
                                    })
                                    await parentRes
                                } catch (parentErr) {
                                    console.error('[Sync] auto-complete parent failed:', parentErr)
                                    setAllTasks(prev => prev.map(t =>
                                        t.id === task.parent_task_id ? { ...t, status: parent.status } : t
                                    ))
                                    dispatchLinkedTaskStatus(task.parent_task_id, parent.status)
                                    parentAutoCompleteUndo = null
                                }
                            }
                        }
                    }
                }

                // AUTO-UNCOMPLETE PARENT
                if (updates.status && updates.status !== 'done') {
                    const latestAll = allTasksRef.current.map(t =>
                        t.id === taskId ? { ...t, ...updatesWithStage } : t
                    )
                    const task = latestAll.find(t => t.id === taskId);
                    if (task?.parent_task_id) {
                        const parent = latestAll.find(t => t.id === task.parent_task_id);
                        // 習慣タスクは AUTO-UNCOMPLETE しない
                        if (parent?.status === 'done' && !parent.is_habit) {
                            parentAutoCompleteUndo = { parentId: task.parent_task_id, beforeStatus: parent.status }
                            const parentStage = deriveStageUpdate({ status: 'todo' } as Partial<Task>, parent).stage
                            const parentUpdates = parentStage ? { status: 'todo', stage: parentStage } : { status: 'todo' }
                            setAllTasks(prev => prev.map(t =>
                                t.id === task.parent_task_id ? { ...t, ...parentUpdates } : t
                            ));
                            dispatchLinkedTaskStatus(task.parent_task_id, parentUpdates.status)
                            try {
                                const parentRes = await enqueueTaskSave(task.parent_task_id, async () => {
                                    const res = await fetch(`/api/tasks/${task.parent_task_id}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify(parentUpdates),
                                    })
                                    if (!res.ok) throw new Error('auto-uncomplete parent API error')
                                })
                                await parentRes
                            } catch (parentErr) {
                                console.error('[Sync] auto-uncomplete parent failed:', parentErr)
                                setAllTasks(prev => prev.map(t =>
                                    t.id === task.parent_task_id ? { ...t, status: parent.status, stage: parent.stage } : t
                                ))
                                dispatchLinkedTaskStatus(task.parent_task_id, parent.status)
                                parentAutoCompleteUndo = null
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('[Sync] updateTask failed:', e)
                if (collapsedOnlyValue !== null) {
                    queuePendingCollapsedState(taskId, collapsedOnlyValue)
                    return
                }
                if (isLatestUpdate()) {
                    notifyTaskSaveFailure('タスクの更新に失敗しました: ネットワークエラー')
                    if (!preservesLocalDraftOnFailure) rollbackTaskValues()
                }
            }
        })

        if (!didSave) return

        const capturedParentUndo = parentAutoCompleteUndo as { parentId: string; beforeStatus: string } | null
        pushAction({
            description: `「${beforeTask?.title || 'タスク'}」を変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
                if (typeof beforeValues.status === 'string') {
                    dispatchLinkedTaskStatus(taskId, beforeValues.status)
                }
                try {
                    await fetch(`/api/tasks/${taskId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(beforeValues),
                    })
                } catch (e) {
                    console.error('[UndoRedo] undo updateTask failed:', e)
                }
                if (capturedParentUndo) {
                    setAllTasks(prev => prev.map(t =>
                        t.id === capturedParentUndo.parentId ? { ...t, status: capturedParentUndo.beforeStatus } : t
                    ))
                    dispatchLinkedTaskStatus(capturedParentUndo.parentId, capturedParentUndo.beforeStatus)
                    try {
                        await fetch(`/api/tasks/${capturedParentUndo.parentId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: capturedParentUndo.beforeStatus }),
                        })
                    } catch (e) {
                        console.error('[UndoRedo] undo parent status failed:', e)
                    }
                }
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
                if (typeof updates.status === 'string') {
                    dispatchLinkedTaskStatus(taskId, updates.status)
                }
                try {
                    await fetch(`/api/tasks/${taskId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updates),
                    })
                } catch (e) {
                    console.error('[UndoRedo] redo updateTask failed:', e)
                }
                if (capturedParentUndo) {
                    const newStatus = updates.status === 'done' ? 'done' : 'todo'
                    setAllTasks(prev => prev.map(t =>
                        t.id === capturedParentUndo.parentId ? { ...t, status: newStatus } : t
                    ))
                    dispatchLinkedTaskStatus(capturedParentUndo.parentId, newStatus)
                    try {
                        await fetch(`/api/tasks/${capturedParentUndo.parentId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ status: newStatus }),
                        })
                    } catch (e) {
                        console.error('[UndoRedo] redo parent status failed:', e)
                    }
                }
            },
        })
    }, [applyRealtimeTask, clearPendingCollapsedState, enqueueTaskSave, onSyncError, pushAction, queuePendingCollapsedState])

    const deleteTask = useCallback(async (taskId: string) => {
        const currentAll = allTasksRef.current;
        const capturedTask = currentAll.find(t => t.id === taskId)
        const getDescendants = (id: string): Task[] => {
            const children = currentAll.filter(t => t.parent_task_id === id)
            return children.flatMap(c => [c, ...getDescendants(c.id)])
        }
        const capturedDescendants = getDescendants(taskId)
        const allCaptured = capturedTask ? [capturedTask, ...capturedDescendants] : capturedDescendants

        const allIds = new Set(allCaptured.map(t => t.id))
        const operation: PendingMindmapDelete = {
            operationId: `delete:${taskId}`,
            projectId: projectIdRef.current ?? capturedTask?.project_id ?? '',
            taskIds: Array.from(allIds),
            tasks: allCaptured,
            deleteRequestIds: [taskId],
            requestedAt: Date.now(),
        }

        beginPendingDelete(operation)

        let memoRepairSnapshot: DeletedTaskMemoRepairSnapshot | null = null
        let undoRequested = false

        const deleteFromServer = async () => {
            try {
                await cancelNotifications('task', taskId);
            } catch (error) {
                console.error('[Notification] Failed to cancel notifications:', error);
            }

            // CRITICAL FIX: Ensure any pending POST request for this task finishes before we DELETE
            const pendingInsert = pendingInserts.current.get(taskId)
            if (pendingInsert) {
                try {
                    await pendingInsert
                } catch (e) {
                    console.error('[Sync] deleteTask: pending insert failed, continuing with DELETE anyway', e)
                }
            }

            try {
                const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                if (!response.ok) {
                    if (response.status === 404) {
                        // DB上に存在しないタスク（ゴーストタスク）→ UIからの削除は成功とする
                        console.warn('[Sync] deleteTask: task not found in DB (ghost task), removing from UI only:', taskId.slice(0, 8))
                        // ロールバックしない（DBにないのでUIから消すだけでOK）
                        completePendingDelete(operation.operationId)
                    } else {
                        const errorData = await response.json().catch(() => ({ message: response.statusText }))
                        console.error('[Sync] deleteTask API failed:', errorData)
                        onSyncError?.(`タスクの削除に失敗しました: ${errorData.message || response.statusText}`)
                        if (!undoRequested) rollbackPendingDelete(operation.operationId)
                    }
                } else {
                    const data = await response.json().catch(() => null) as { memo_repair?: DeletedTaskMemoRepairSnapshot } | null
                    memoRepairSnapshot = data?.memo_repair ?? null
                    completePendingDelete(operation.operationId)
                    dispatchWishlistRefresh()
                }
            } catch (e) {
                console.error('[Sync] deleteTask failed:', e)
                onSyncError?.('オフラインのため、オンライン復帰後に削除を同期します')
            }
        }

        const deleteRequest = deleteFromServer()

        if (capturedTask) {
            pushAction({
                description: `「${capturedTask.title}」を削除`,
                toast: {
                    message: 'マップから外しました。',
                    actionLabel: '元に戻す',
                    duration: 5000,
                },
                undo: async () => {
                    undoRequested = true
                    const restored = allCaptured.map(t => ({ ...t, google_event_id: null }))
                    completePendingDelete(operation.operationId)
                    restoreTasksToState(restored)
                    await deleteRequest
                    for (const task of allCaptured) {
                        await supabase.from('tasks').upsert(withoutGoogleEventId(task))
                    }
                    await restoreMemoRepairSnapshot(memoRepairSnapshot)
                },
                redo: async () => {
                    undoRequested = false
                    beginPendingDelete({ ...operation, requestedAt: Date.now() })
                    try {
                        const redoResponse = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                        if (redoResponse.ok || redoResponse.status === 404) {
                            const redoData = await redoResponse.json().catch(() => null) as { memo_repair?: DeletedTaskMemoRepairSnapshot } | null
                            memoRepairSnapshot = redoData?.memo_repair ?? memoRepairSnapshot
                            completePendingDelete(operation.operationId)
                            dispatchWishlistRefresh()
                        } else {
                            rollbackPendingDelete(operation.operationId)
                        }
                    } catch (e) {
                        console.error('[UndoRedo] redo deleteTask failed:', e)
                    }
                },
            })
        }

        await deleteRequest
    }, [
        beginPendingDelete,
        cancelNotifications,
        completePendingDelete,
        pushAction,
        restoreMemoRepairSnapshot,
        restoreTasksToState,
        rollbackPendingDelete,
        supabase,
        onSyncError,
    ])

    const moveTask = useCallback(async (taskId: string, newGroupId: string) => {
        const currentAll = allTasksRef.current;
        const task = currentAll.find(t => t.id === taskId)
        const oldParentId = task?.parent_task_id ?? null
        const taskTitle = task?.title || 'タスク'

        setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: newGroupId } : t))

        try {
            const response = await fetch(`/api/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_task_id: newGroupId }),
            })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] moveTask API failed:', errorData)
                onSyncError?.(`タスクの移動に失敗しました: ${errorData.message || response.statusText}`)
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: oldParentId } : t))
                return
            }
        } catch (e) {
            console.error('[Sync] moveTask failed:', e)
            onSyncError?.(`タスクの移動に失敗しました: ネットワークエラー`)
            setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: oldParentId } : t))
            return
        }

        if (oldParentId) {
            pushAction({
                description: `「${taskTitle}」を移動`,
                undo: async () => {
                    setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: oldParentId } : t))
                    try {
                        await fetch(`/api/tasks/${taskId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ parent_task_id: oldParentId }),
                        })
                    } catch (e) {
                        console.error('[UndoRedo] undo moveTask failed:', e)
                    }
                },
                redo: async () => {
                    setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: newGroupId } : t))
                    try {
                        await fetch(`/api/tasks/${taskId}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ parent_task_id: newGroupId }),
                        })
                    } catch (e) {
                        console.error('[UndoRedo] redo moveTask failed:', e)
                    }
                },
            })
        }
    }, [pushAction, onSyncError])

    // --- Bulk Delete ---
    const bulkDelete = useCallback(async (groupIds: string[], taskIds: string[]) => {
        const currentAll = allTasksRef.current;
        const allSelectedIds = new Set([...groupIds, ...taskIds])

        // 子孫タスクも含める
        const getDescendants = (id: string): string[] => {
            const children = currentAll.filter(t => t.parent_task_id === id)
            return children.flatMap(c => [c.id, ...getDescendants(c.id)])
        }
        for (const id of allSelectedIds) {
            for (const did of getDescendants(id)) allSelectedIds.add(did)
        }

        const capturedTasks = currentAll.filter(t => allSelectedIds.has(t.id))
        const operation: PendingMindmapDelete = {
            operationId: `bulk-delete:${Date.now()}:${Array.from(allSelectedIds).join(',')}`,
            projectId: projectIdRef.current ?? capturedTasks[0]?.project_id ?? '',
            taskIds: Array.from(allSelectedIds),
            tasks: capturedTasks,
            deleteRequestIds: [...groupIds, ...taskIds],
            requestedAt: Date.now(),
        }

        beginPendingDelete(operation)

        let memoRepairSnapshots: DeletedTaskMemoRepairSnapshot[] = []
        pushAction({
            description: `${capturedTasks.length}個のタスクを削除`,
            toast: {
                message: 'マップから外しました。元メモは未予定に戻しました。',
                actionLabel: '元に戻す',
                duration: 5000,
            },
            undo: async () => {
                const restored = capturedTasks.map(t => ({ ...t, google_event_id: null }))
                completePendingDelete(operation.operationId)
                restoreTasksToState(restored)
                for (const task of capturedTasks) {
                    await supabase.from('tasks').upsert(withoutGoogleEventId(task))
                }
                for (const snapshot of memoRepairSnapshots) {
                    await restoreMemoRepairSnapshot(snapshot)
                }
            },
            redo: async () => {
                beginPendingDelete({ ...operation, requestedAt: Date.now() })
                // ルートタスクを削除すれば CASCADE で子も消える
                const nextSnapshots: DeletedTaskMemoRepairSnapshot[] = []
                let redoFailed = false
                for (const id of [...groupIds, ...taskIds]) {
                    try {
                        const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
                        if (!response.ok && response.status !== 404) {
                            redoFailed = true
                            continue
                        }
                        const data = await response.json().catch(() => null) as { memo_repair?: DeletedTaskMemoRepairSnapshot } | null
                        if (data?.memo_repair) nextSnapshots.push(data.memo_repair)
                    } catch {
                        redoFailed = true
                    }
                }
                if (nextSnapshots.length > 0) memoRepairSnapshots = nextSnapshots
                if (redoFailed) {
                    onSyncError?.('オフラインのため、オンライン復帰後に削除を同期します')
                } else {
                    completePendingDelete(operation.operationId)
                    dispatchWishlistRefresh()
                }
            },
        })

        // DB sync - ルートレベルのIDだけ削除（CASCADE で子孫も削除される）
        let bulkFailed = false
        for (const id of [...groupIds, ...taskIds]) {
            try {
                const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
                if (!response.ok) {
                    if (response.status === 404) {
                        console.warn('[Sync] bulkDelete: task not found in DB (ghost task), removing from UI only:', id.slice(0, 8))
                    } else {
                        console.error('[Sync] bulkDelete API failed for:', id)
                        bulkFailed = true
                    }
                } else {
                    const data = await response.json().catch(() => null) as { memo_repair?: DeletedTaskMemoRepairSnapshot } | null
                    if (data?.memo_repair) memoRepairSnapshots.push(data.memo_repair)
                }
            } catch (e) {
                console.error('[Sync] bulkDelete failed:', e)
                bulkFailed = true
            }
        }
        if (bulkFailed) {
            onSyncError?.('オフラインのため、オンライン復帰後に削除を同期します')
        } else {
            completePendingDelete(operation.operationId)
            dispatchWishlistRefresh()
        }
    }, [
        beginPendingDelete,
        completePendingDelete,
        pushAction,
        restoreMemoRepairSnapshot,
        restoreTasksToState,
        supabase,
        onSyncError,
    ])

    // --- Helper Functions ---
    const getChildTasks = useCallback((parentTaskId: string): Task[] => {
        return tasks.filter(t => t.parent_task_id === parentTaskId).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    const getParentTasks = useCallback((groupId: string): Task[] => {
        return tasks.filter(t => t.parent_task_id === groupId).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    // --- Reorder Operations --- (APIルート経由)
    const reorderTask = useCallback(async (taskId: string, referenceTaskId: string, position: 'above' | 'below') => {
        const currentAll = allTasksRef.current;
        const task = currentAll.find(t => t.id === taskId)
        const referenceTask = currentAll.find(t => t.id === referenceTaskId)
        if (!task || !referenceTask) return

        const beforeParentId = task.parent_task_id
        const beforeOrderIndex = task.order_index

        // 同じ parent_task_id を持つタスクが兄弟（null 同士もOK）
        const siblings = currentAll
            .filter(t =>
                t.parent_task_id === referenceTask.parent_task_id &&
                t.id !== taskId
            )
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

        const refIndex = siblings.findIndex(t => t.id === referenceTaskId)
        const insertAt = position === 'above' ? refIndex : refIndex + 1

        const reordered = [
            ...siblings.slice(0, insertAt),
            task,
            ...siblings.slice(insertAt),
        ]

        const updates: { id: string; order_index: number; parent_task_id?: string | null }[] = []
        reordered.forEach((t, i) => {
            if (t.id === taskId) {
                updates.push({
                    id: t.id,
                    order_index: i,
                    parent_task_id: referenceTask.parent_task_id,
                })
            } else if ((t.order_index ?? 0) !== i) {
                updates.push({ id: t.id, order_index: i })
            }
        })

        applyTaskUpdatesToState(updates)

        pushAction({
            description: `「${task.title}」を並び替え`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => {
                    if (t.id === taskId) {
                        return { ...t, parent_task_id: beforeParentId, order_index: beforeOrderIndex }
                    }
                    const original = currentAll.find(o => o.id === t.id)
                    return original ? { ...t, order_index: original.order_index } : t
                }))
                try {
                    await fetch(`/api/tasks/${taskId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ parent_task_id: beforeParentId, order_index: beforeOrderIndex }),
                    })
                    for (const sib of siblings) {
                        const original = currentAll.find(o => o.id === sib.id)
                        if (original && original.order_index !== sib.order_index) {
                            await fetch(`/api/tasks/${sib.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ order_index: original.order_index }),
                            })
                        }
                    }
                } catch (e) {
                    console.error('[UndoRedo] undo reorderTask failed:', e)
                }
            },
            redo: async () => {
                setAllTasks(prev => {
                    let updated = [...prev]
                    for (const u of updates) {
                        updated = updated.map(t => t.id === u.id ? { ...t, ...u } : t)
                    }
                    return updated
                })
                for (const u of updates) {
                    const { id, ...rest } = u
                    try {
                        await fetch(`/api/tasks/${id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(rest),
                        })
                    } catch (e) {
                        console.error('[UndoRedo] redo reorderTask failed:', e)
                    }
                }
            },
        })

        const taskPendingInsert = pendingInserts.current.get(taskId)
        if (taskPendingInsert) {
            try {
                await taskPendingInsert
            } catch (e) {
                console.error('[Sync] reorderTask: pending task insert failed, skipping reorder', e)
            }
        }
        const referencePendingInsert = pendingInserts.current.get(referenceTaskId)
        if (referencePendingInsert) {
            try {
                await referencePendingInsert
            } catch (e) {
                console.error('[Sync] reorderTask: pending reference insert failed, skipping reorder', e)
            }
        }

        let reorderFailed = false
        for (const u of updates) {
            const { id, ...rest } = u
            try {
                const response = await fetch(`/api/tasks/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(rest),
                })
                if (!response.ok) {
                    console.error('[Sync] reorderTask API error for:', id)
                    reorderFailed = true
                    break
                }
            } catch (e) {
                console.error('[Sync] reorderTask failed:', e)
                reorderFailed = true
                break
            }
        }
        if (reorderFailed) {
            onSyncError?.('並び替えの保存に失敗しました')
            // Rollback to original order
            setAllTasks(prev => prev.map(t => {
                if (t.id === taskId) {
                    return { ...t, parent_task_id: beforeParentId, order_index: beforeOrderIndex }
                }
                const original = currentAll.find(o => o.id === t.id)
                return original ? { ...t, order_index: original.order_index } : t
            }))
        }
    }, [pushAction, onSyncError, applyTaskUpdatesToState])

    // reorderGroup → reorderTask にデリゲート（ルートタスクの並び替え）
    const reorderGroup = useCallback(async (groupId: string, referenceGroupId: string, position: 'above' | 'below') => {
        return reorderTask(groupId, referenceGroupId, position)
    }, [reorderTask])

    // タスクをルートに昇格（parent_task_id を null に変更）APIルート経由
    const promoteTaskToGroup = useCallback(async (taskId: string) => {
        const currentAll = allTasksRef.current;
        const task = currentAll.find(t => t.id === taskId)
        if (!task || !projectId) return

        const beforeParentId = task.parent_task_id
        if (!beforeParentId) return // 既にルートタスクなら何もしない

        const currentRootTasks = currentAll.filter(t => !t.parent_task_id)
        const maxOrder = currentRootTasks.length > 0 ? Math.max(...currentRootTasks.map(t => t.order_index)) + 1 : 0

        // タスクをルートに昇格（子タスクはそのまま付随）
        setAllTasks(prev => prev.map(t =>
            t.id === taskId ? { ...t, parent_task_id: null, project_id: projectId, order_index: maxOrder } : t
        ))

        pushAction({
            description: `「${task.title}」をルートに昇格`,
            undo: async () => {
                setAllTasks(prev => prev.map(t =>
                    t.id === taskId ? { ...t, parent_task_id: beforeParentId, order_index: task.order_index } : t
                ))
                try {
                    await fetch(`/api/tasks/${taskId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ parent_task_id: beforeParentId, order_index: task.order_index }),
                    })
                } catch (e) {
                    console.error('[UndoRedo] undo promoteTaskToGroup failed:', e)
                }
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t =>
                    t.id === taskId ? { ...t, parent_task_id: null, project_id: projectId, order_index: maxOrder } : t
                ))
                try {
                    await fetch(`/api/tasks/${taskId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ parent_task_id: null, project_id: projectId, order_index: maxOrder }),
                    })
                } catch (e) {
                    console.error('[UndoRedo] redo promoteTaskToGroup failed:', e)
                }
            },
        })

        try {
            const response = await fetch(`/api/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parent_task_id: null, project_id: projectId, order_index: maxOrder }),
            })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] promoteTaskToGroup API error:', errorData)
                onSyncError?.('ルート昇格の保存に失敗しました')
                setAllTasks(prev => prev.map(t =>
                    t.id === taskId ? { ...t, parent_task_id: beforeParentId, order_index: task.order_index } : t
                ))
            } else {
            }
        } catch (e) {
            console.error('[Sync] promoteTaskToGroup failed:', e)
            onSyncError?.('ルート昇格の保存に失敗しました')
            setAllTasks(prev => prev.map(t =>
                t.id === taskId ? { ...t, parent_task_id: beforeParentId, order_index: task.order_index } : t
            ))
        }
    }, [projectId, pushAction, onSyncError])

    const updateProjectTitle = useCallback(async (projectId: string, title: string) => {
        try {
            await supabase.from('projects').update({ title }).eq('id', projectId)
        } catch (e) {
            console.error('[Sync] updateProjectTitle failed:', e)
        }
    }, [supabase])

    // サーバーからタスクを再取得（ビュー切り替え時など外部でタスクが追加された場合）
    const refreshFromServer = useCallback(async (options?: { force?: boolean; staleMs?: number; silent?: boolean; notifyOnError?: boolean }) => {
        if (!projectId) return
        const staleMs = options?.staleMs ?? 0
        if (!options?.force && staleMs > 0 && Date.now() - lastServerRefreshAt.current < staleMs) {
            return
        }
        if (refreshInFlight.current) return refreshInFlight.current

        const refreshProjectId = projectId
        const showLoading = options?.silent !== true
        const refresh = (async () => {
            if (showLoading) setIsLoading(true)
            let data: Task[] = []
            try {
                const response = await fetch(`/api/tasks?project_id=${encodeURIComponent(refreshProjectId)}`)
                if (!response.ok) {
                    const message = await response.text().catch(() => response.statusText)
                    throw new Error(message || response.statusText)
                }
                const payload = await response.json()
                if (!payload?.success || !Array.isArray(payload.tasks)) {
                    throw new Error('Invalid task refresh response')
                }
                data = payload.tasks as Task[]
            } catch (apiError) {
                console.warn('[Sync] refreshFromServer API failed, falling back to Supabase client:', apiError)
                const { data: fallbackData, error } = await supabase
                    .from('tasks')
                    .select('*')
                    .eq('project_id', refreshProjectId)
                    .is('deleted_at', null)
                    .order('order_index', { ascending: true })
                if (error) throw error
                data = fallbackData ?? []
            }

            if (projectIdRef.current !== refreshProjectId) return
            realtimeFallbackRefreshErrorNotifiedRef.current = false

            setAllTasks(prev => {
                const pendingDeleteIds = getLocalPendingDeleteIds()
                const visibleServerTasks = data.filter(task => !pendingDeleteIds.has(task.id))
                const serverIds = new Set(visibleServerTasks.map(t => t.id))
                const optimistic = prev.filter(t =>
                    !serverIds.has(t.id) &&
                    pendingOptimisticTasks.current.has(t.id) &&
                    !pendingDeleteIds.has(t.id)
                )
                const nextTasks = [...visibleServerTasks, ...optimistic]
                allTasksRef.current = nextTasks
                writeMindmapCache(refreshProjectId, nextTasks)
                return nextTasks
            })
            lastServerRefreshAt.current = Date.now()
        })()

        refreshInFlight.current = refresh
        try {
            await refresh
        } catch (e) {
            console.error('[Sync] refreshFromServer failed:', e)
            if (options?.notifyOnError && !realtimeFallbackRefreshErrorNotifiedRef.current) {
                realtimeFallbackRefreshErrorNotifiedRef.current = true
                onSyncError?.('更新できませんでした。通信状態を確認してください')
            }
        } finally {
            if (refreshInFlight.current === refresh) refreshInFlight.current = null
            if (showLoading) setIsLoading(false)
        }
    }, [getLocalPendingDeleteIds, onSyncError, projectId, supabase])

    useEffect(() => {
        if (!projectId || !realtimeFallbackActive) return

        void refreshFromServer({ force: true, silent: true, notifyOnError: true })
        const intervalId = window.setInterval(() => {
            if (isPageVisible()) void refreshFromServer({ force: true, silent: true, notifyOnError: true })
        }, REALTIME_FALLBACK_POLL_INTERVAL_MS)
        return () => window.clearInterval(intervalId)
    }, [projectId, realtimeFallbackActive, refreshFromServer])

    return {
        groups,
        tasks,
        createGroup,
        updateGroupTitle,
        updateGroup,
        deleteGroup,
        createTask,
        updateTask,
        deleteTask,
        moveTask,
        updateProjectTitle,
        bulkDelete,
        reorderTask,
        reorderGroup,
        promoteTaskToGroup,
        isLoading,
        getChildTasks,
        getParentTasks,
        refreshFromServer,
        undo,
        redo,
        canUndo,
        canRedo,
    }
}
