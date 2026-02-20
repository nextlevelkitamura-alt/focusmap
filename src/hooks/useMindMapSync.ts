"use client"

import { useCallback, useEffect, useState, useMemo, useRef } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Task, TaskGroup } from '@/types/database'
import { useNotificationScheduler } from '@/hooks/useNotificationScheduler'
import { useUndoRedo } from '@/hooks/useUndoRedo'

interface UseMindMapSyncProps {
    projectId: string | null
    userId: string
    initialGroups: TaskGroup[]  // 旧テーブル互換（page.tsx から渡される）
    initialTasks?: Task[]
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
    undo: () => Promise<string | null>
    redo: () => Promise<string | null>
    canUndo: () => boolean
    canRedo: () => boolean
}

export function useMindMapSync({
    projectId,
    userId,
    initialGroups,
    initialTasks = [],
    onSyncError,
}: UseMindMapSyncProps): UseMindMapSyncReturn {
    const supabase = createClient()
    const { cancelNotifications } = useNotificationScheduler()

    // 統合ステート管理（全タスクを1つのリストで管理）
    const [allTasks, setAllTasks] = useState<Task[]>([
        ...initialGroups.map(g => ({ ...g, is_group: true, group_id: null, project_id: g.project_id } as Task)),
        ...initialTasks
    ])
    const [isLoading, setIsLoading] = useState(false)
    const { pushAction, undo, redo, canUndo, canRedo, clear } = useUndoRedo()

    // INSERT の Promise を追跡（親の INSERT 完了を子が待機するため）
    const pendingInserts = useRef(new Map<string, Promise<void>>())

    // 楽観的に作成されたタスクを保護（INSERT 完了まで state からの削除を防止）
    const pendingOptimisticTasks = useRef(new Map<string, Task>())

    // 最新の allTasks を参照するための ref（callback の依存配列から除外するため）
    const allTasksRef = useRef(allTasks)
    allTasksRef.current = allTasks

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
            const allInitialIds = new Set([
                ...initialGroups.map(g => g.id),
                ...initialTasks.map(t => t.id)
            ]);
            const optimisticItems = prev.filter(t =>
                !allInitialIds.has(t.id) && t.project_id === projectId
            );
            return [
                ...initialGroups.map(g => ({ ...g, is_group: true, group_id: null, project_id: g.project_id } as Task)),
                ...initialTasks,
                ...optimisticItems
            ];
        });
    }, [initialGroups, initialTasks, projectId])

    // Watchdog: 楽観的タスクが state から消えた場合に再追加（現プロジェクトのみ）
    useEffect(() => {
        if (pendingOptimisticTasks.current.size === 0) return
        const currentIds = new Set(allTasks.map(t => t.id))
        const missingTasks: Task[] = []
        for (const [, task] of pendingOptimisticTasks.current) {
            if (!currentIds.has(task.id) && task.project_id === projectId) {
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
    }, [allTasks])

    // プロジェクト切替時にundo/redoスタックと楽観的タスクをクリア
    useEffect(() => {
        clear()
        pendingOptimisticTasks.current.clear()
        pendingInserts.current.clear()
    }, [projectId, clear])

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
            group_id: null,
            project_id: projectId,
            is_group: true, // ルートタスク（グループ）なので true
            parent_task_id: null,
            title,
            status: 'todo',
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
            created_at: now,
        }

        pendingOptimisticTasks.current.set(optimisticId, optimisticTask)
        setAllTasks(prev => [...prev, optimisticTask])

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
                console.log('[Sync] Creating root task (group) via API:', optimisticId.slice(0, 8), title);

                // APIルート経由でINSERT（サーバーサイド認証）
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: optimisticId,
                        project_id: projectId,
                        parent_task_id: null,
                        is_group: true,
                        title,
                        order_index: maxOrder,
                    }),
                });

                if (response.ok) {
                    console.log('[Sync] createGroup API INSERT success:', optimisticId.slice(0, 8));
                    pendingOptimisticTasks.current.delete(optimisticId)
                    return;
                }

                const errorText = await response.text();
                console.warn('[Sync] createGroup API INSERT failed:', errorText);

                // フォールバック: 直接Supabase INSERT
                console.log('[Sync] createGroup fallback to direct INSERT:', optimisticId.slice(0, 8));
                const { error } = await supabase.from('tasks').insert({
                    id: optimisticId,
                    user_id: userId,
                    project_id: projectId,
                    is_group: true,
                    parent_task_id: null,
                    title,
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
                console.log('[Sync] createGroup direct INSERT success:', optimisticId.slice(0, 8));
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
    }, [projectId, userId, supabase, pushAction])

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

        try {
            console.log('[Sync] updateGroupTitle via API:', groupId.slice(0, 8), oldTitle, '->', title);
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
            console.log('[Sync] updateGroupTitle API success:', groupId.slice(0, 8));
        } catch (e) {
            console.error('[Sync] updateGroupTitle failed:', e)
            setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title: oldTitle } : t))
        }
    }, [pushAction])

    // updateGroup → APIルート経由で更新
    const updateGroup = useCallback(async (groupId: string, updates: Partial<Task>) => {
        const beforeTask = allTasksRef.current.find(t => t.id === groupId)
        const beforeValues: Partial<Task> = {}
        for (const key of Object.keys(updates) as (keyof Task)[]) {
            if (beforeTask) (beforeValues as any)[key] = beforeTask[key]
        }

        setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...updates } : t))

        try {
            console.log('[Sync] updateGroup via API:', groupId.slice(0, 8), updates)
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
            console.log('[Sync] updateGroup API success:', groupId.slice(0, 8))
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

        setAllTasks(prev => prev.filter(t => !allIds.has(t.id)))

        try {
            console.log('[Sync] deleteGroup via API:', groupId.slice(0, 8))
            const response = await fetch(`/api/tasks/${groupId}`, { method: 'DELETE' })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] deleteGroup API failed:', errorData)
                onSyncError?.(`グループの削除に失敗しました: ${errorData.message || response.statusText}`)
                setAllTasks(prev => [...prev, ...allCaptured])
                return
            }
            console.log('[Sync] deleteGroup API success:', groupId.slice(0, 8))
        } catch (e) {
            console.error('[Sync] deleteGroup failed:', e)
            onSyncError?.(`グループの削除に失敗しました: ネットワークエラー`)
            setAllTasks(prev => [...prev, ...allCaptured])
            return
        }

        if (capturedTask) {
            pushAction({
                description: `「${capturedTask.title}」を削除`,
                undo: async () => {
                    const restored = allCaptured.map(t => ({ ...t, google_event_id: null }))
                    setAllTasks(prev => [...prev, ...restored])
                    for (const task of allCaptured) {
                        const { google_event_id, ...rest } = task
                        await supabase.from('tasks').upsert({ ...rest, google_event_id: null })
                    }
                },
                redo: async () => {
                    setAllTasks(prev => prev.filter(t => !allIds.has(t.id)))
                    try {
                        await fetch(`/api/tasks/${groupId}`, { method: 'DELETE' })
                    } catch (e) {
                        console.error('[UndoRedo] redo deleteGroup failed:', e)
                    }
                },
            })
        }
    }, [supabase, pushAction, onSyncError])

    // --- タスク操作 ---
    const createTask = useCallback(async (groupId: string, title: string = "New Task", parentTaskId: string | null = null): Promise<Task | null> => {
        console.log('[Sync] createTask called:', { groupId: groupId?.slice(0, 8), title, parentTaskId: parentTaskId?.slice(0, 8) });
        const optimisticId = crypto.randomUUID();
        const now = new Date().toISOString();

        const effectiveParentId = parentTaskId || groupId;
        const currentAll = allTasksRef.current;
        const siblingTasks = currentAll.filter(t => t.parent_task_id === effectiveParentId);
        const maxOrder = siblingTasks.length > 0 ? Math.max(...siblingTasks.map(t => t.order_index ?? 0)) + 1 : 0;

        const optimisticTask: Task = {
            id: optimisticId,
            user_id: userId,
            group_id: null,
            project_id: projectId,
            is_group: false,
            parent_task_id: effectiveParentId,
            title,
            status: 'todo',
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
            created_at: now,
        };

        pendingOptimisticTasks.current.set(optimisticId, optimisticTask);
        setAllTasks(prev => [...prev, optimisticTask]);

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
                console.log('[Sync] createTask starting INSERT:', { optimisticId: optimisticId.slice(0, 8), parentTaskId: effectiveParentId?.slice(0, 8), title, groupId });

                // 親タスクの INSERT 完了を待機
                if (effectiveParentId) {
                    const parentPending = pendingInserts.current.get(effectiveParentId);
                    if (parentPending) {
                        console.log('[Sync] Waiting for parent INSERT:', effectiveParentId.slice(0, 8));
                        await parentPending;
                        console.log('[Sync] Parent INSERT completed:', effectiveParentId.slice(0, 8));
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
                    console.log('[Sync] createTask API INSERT success:', optimisticId.slice(0, 8));
                    pendingOptimisticTasks.current.delete(optimisticId);
                    return;
                }

                const errorText = await response.text();
                console.warn('[Sync] createTask API INSERT failed:', errorText);

                // フォールバック: 直接Supabase INSERT
                console.log('[Sync] createTask fallback to direct INSERT:', optimisticId.slice(0, 8));
                const { error: insertError } = await supabase.from('tasks').insert({
                    id: optimisticId,
                    user_id: userId,
                    project_id: projectId,
                    parent_task_id: effectiveParentId,
                    is_group: false,
                    title: title || '',
                    status: 'todo',
                    order_index: maxOrder,
                    actual_time_minutes: 0,
                    estimated_time: 0,
                    is_habit: false,
                    habit_frequency: null,
                    habit_icon: null,
                });

                if (!insertError) {
                    console.log('[Sync] createTask direct INSERT success:', optimisticId.slice(0, 8));
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
    }, [userId, projectId, supabase, pushAction]);

    const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
        console.log('[Sync] updateTask called:', taskId.slice(0, 8), updates)
        const currentAll = allTasksRef.current;
        const beforeTask = currentAll.find(t => t.id === taskId)
        if (!beforeTask) {
            // Task not in current project state (e.g. habit child from another project)
            // Still perform DB update via API route
            console.log('[Sync] updateTask: task not in local state, updating via API:', taskId.slice(0, 8))
            try {
                const response = await fetch(`/api/tasks/${taskId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates),
                })
                if (!response.ok) console.error('[Sync] updateTask direct API error:', await response.text())
            } catch (e) {
                console.error('[Sync] updateTask direct API failed:', e)
            }
            return
        }
        const beforeValues: Partial<Task> = {}
        for (const key of Object.keys(updates) as (keyof Task)[]) {
            (beforeValues as any)[key] = beforeTask[key]
        }

        let parentAutoCompleteUndo: { parentId: string; beforeStatus: string } | null = null

        setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))

        try {
            console.log('[Sync] updateTask via API:', taskId.slice(0, 8))
            const response = await fetch(`/api/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates),
            })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] updateTask API error:', errorData)
                onSyncError?.(`保存に失敗しました: ${errorData.message || response.statusText}`)
                // Rollback optimistic update
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
                return
            }
            const result = await response.json()
            console.log('[Sync] updateTask API success:', taskId.slice(0, 8), result.task?.id)

            // AUTO-COMPLETE PARENT
            if (updates.status === 'done') {
                const task = currentAll.find(t => t.id === taskId);
                if (task?.parent_task_id) {
                    const siblings = currentAll
                        .filter(t => t.parent_task_id === task.parent_task_id)
                        .map(t => t.id === taskId ? { ...t, status: 'done' } : t);

                    const allSiblingsDone = siblings.every(s => s.status === 'done');

                    if (allSiblingsDone) {
                        const parent = currentAll.find(t => t.id === task.parent_task_id)
                        if (parent && parent.status !== 'done') {
                            parentAutoCompleteUndo = { parentId: task.parent_task_id, beforeStatus: parent.status }
                        }
                        setAllTasks(prev => prev.map(t =>
                            t.id === task.parent_task_id ? { ...t, status: 'done' } : t
                        ));
                        try {
                            const parentRes = await fetch(`/api/tasks/${task.parent_task_id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: 'done' }),
                            })
                            if (!parentRes.ok) {
                                console.error('[Sync] auto-complete parent API error')
                                setAllTasks(prev => prev.map(t =>
                                    t.id === task.parent_task_id ? { ...t, status: parent.status } : t
                                ))
                                parentAutoCompleteUndo = null
                            }
                        } catch (parentErr) {
                            console.error('[Sync] auto-complete parent failed:', parentErr)
                            setAllTasks(prev => prev.map(t =>
                                t.id === task.parent_task_id ? { ...t, status: parent.status } : t
                            ))
                            parentAutoCompleteUndo = null
                        }
                    }
                }
            }

            // AUTO-UNCOMPLETE PARENT
            if (updates.status && updates.status !== 'done') {
                const task = currentAll.find(t => t.id === taskId);
                if (task?.parent_task_id) {
                    const parent = currentAll.find(t => t.id === task.parent_task_id);
                    if (parent?.status === 'done') {
                        parentAutoCompleteUndo = { parentId: task.parent_task_id, beforeStatus: parent.status }
                        setAllTasks(prev => prev.map(t =>
                            t.id === task.parent_task_id ? { ...t, status: 'todo' } : t
                        ));
                        try {
                            const parentRes = await fetch(`/api/tasks/${task.parent_task_id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ status: 'todo' }),
                            })
                            if (!parentRes.ok) {
                                console.error('[Sync] auto-uncomplete parent API error')
                                setAllTasks(prev => prev.map(t =>
                                    t.id === task.parent_task_id ? { ...t, status: parent.status } : t
                                ))
                                parentAutoCompleteUndo = null
                            }
                        } catch (parentErr) {
                            console.error('[Sync] auto-uncomplete parent failed:', parentErr)
                            setAllTasks(prev => prev.map(t =>
                                t.id === task.parent_task_id ? { ...t, status: parent.status } : t
                            ))
                            parentAutoCompleteUndo = null
                        }
                    }
                }
            }
        } catch (e) {
            console.error('[Sync] updateTask failed:', e)
            onSyncError?.('タスクの更新に失敗しました: ネットワークエラー')
            // Rollback optimistic update
            setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
            return
        }

        const capturedParentUndo = parentAutoCompleteUndo
        pushAction({
            description: `「${beforeTask?.title || 'タスク'}」を変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
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
    }, [pushAction, onSyncError])

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
        setAllTasks(prev => prev.filter(t => !allIds.has(t.id)))

        try {
            await cancelNotifications('task', taskId);
        } catch (error) {
            console.error('[Notification] Failed to cancel notifications:', error);
        }

        try {
            const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: response.statusText }))
                console.error('[Sync] deleteTask API failed:', errorData)
                onSyncError?.(`タスクの削除に失敗しました: ${errorData.message || response.statusText}`)
                // Rollback: restore removed tasks
                setAllTasks(prev => [...prev, ...allCaptured])
                return
            }
        } catch (e) {
            console.error('[Sync] deleteTask failed:', e)
            onSyncError?.(`タスクの削除に失敗しました: ネットワークエラー`)
            // Rollback: restore removed tasks
            setAllTasks(prev => [...prev, ...allCaptured])
            return
        }

        if (capturedTask) {
            pushAction({
                description: `「${capturedTask.title}」を削除`,
                undo: async () => {
                    const restored = allCaptured.map(t => ({ ...t, google_event_id: null }))
                    setAllTasks(prev => [...prev, ...restored])
                    for (const task of allCaptured) {
                        const { google_event_id, ...rest } = task
                        await supabase.from('tasks').upsert({ ...rest, google_event_id: null })
                    }
                },
                redo: async () => {
                    setAllTasks(prev => prev.filter(t => !allIds.has(t.id)))
                    try {
                        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                    } catch (e) {
                        console.error('[UndoRedo] redo deleteTask failed:', e)
                    }
                },
            })
        }
    }, [cancelNotifications, supabase, pushAction, onSyncError])

    const moveTask = useCallback(async (taskId: string, newGroupId: string) => {
        const currentAll = allTasksRef.current;
        const task = currentAll.find(t => t.id === taskId)
        const oldParentId = task?.parent_task_id
        const taskTitle = task?.title || 'タスク'

        setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: newGroupId } : t))

        try {
            console.log('[Sync] moveTask via API:', taskId.slice(0, 8), '->', newGroupId.slice(0, 8))
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
            console.log('[Sync] moveTask API success:', taskId.slice(0, 8))
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

        setAllTasks(prev => prev.filter(t => !allSelectedIds.has(t.id)))

        pushAction({
            description: `${capturedTasks.length}個のタスクを削除`,
            undo: async () => {
                const restored = capturedTasks.map(t => ({ ...t, google_event_id: null }))
                setAllTasks(prev => [...prev, ...restored])
                for (const task of capturedTasks) {
                    const { google_event_id, ...rest } = task
                    await supabase.from('tasks').upsert({ ...rest, google_event_id: null })
                }
            },
            redo: async () => {
                setAllTasks(prev => prev.filter(t => !allSelectedIds.has(t.id)))
                // ルートタスクを削除すれば CASCADE で子も消える
                for (const id of [...groupIds, ...taskIds]) {
                    try { await fetch(`/api/tasks/${id}`, { method: 'DELETE' }) } catch {}
                }
            },
        })

        // DB sync - ルートレベルのIDだけ削除（CASCADE で子孫も削除される）
        let bulkFailed = false
        for (const id of [...groupIds, ...taskIds]) {
            try {
                const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
                if (!response.ok) {
                    console.error('[Sync] bulkDelete API failed for:', id)
                    bulkFailed = true
                }
            } catch (e) {
                console.error('[Sync] bulkDelete failed:', e)
                bulkFailed = true
            }
        }
        if (bulkFailed) {
            onSyncError?.('一括削除の一部が失敗しました')
            // Rollback: restore all
            setAllTasks(prev => [...prev, ...capturedTasks])
        }
    }, [supabase, pushAction, onSyncError])

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

        setAllTasks(prev => {
            let updated = [...prev]
            for (const u of updates) {
                updated = updated.map(t => t.id === u.id ? { ...t, ...u } : t)
            }
            return updated
        })

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
    }, [pushAction, onSyncError])

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
            console.log('[Sync] promoteTaskToGroup via API:', taskId.slice(0, 8))
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
                console.log('[Sync] promoteTaskToGroup API success:', taskId.slice(0, 8))
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
        undo,
        redo,
        canUndo,
        canRedo,
    }
}
