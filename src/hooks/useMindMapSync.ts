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
    initialTasks = []
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

        // Background INSERT（createTask と同じパターン）
        const insertPromise = (async () => {
            try {
                console.log('[Sync] Creating root task (group):', optimisticId, title);
                const { error } = await supabase.from('tasks').insert({
                    id: optimisticId,
                    user_id: userId,
                    project_id: projectId,
                    is_group: true, // ルートタスク（グループ）なので true
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
                    console.error('[Sync] createGroup INSERT failed:', error);
                    throw error;
                }
                console.log('[Sync] createGroup INSERT success:', optimisticId);
                pendingOptimisticTasks.current.delete(optimisticId)
            } catch (e) {
                console.error('[Sync] createGroup failed:', e)
                pendingOptimisticTasks.current.delete(optimisticId)
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId))
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

    // updateGroupTitle → updateTask にデリゲート
    const updateGroupTitle = useCallback(async (groupId: string, title: string) => {
        const oldTitle = allTasksRef.current.find(t => t.id === groupId)?.title ?? ''

        setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title } : t))

        pushAction({
            description: `「${oldTitle}」の名前変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title: oldTitle } : t))
                await supabase.from('tasks').update({ title: oldTitle }).eq('id', groupId)
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, title } : t))
                await supabase.from('tasks').update({ title }).eq('id', groupId)
            },
        })

        try {
            console.log('[Sync] Updating group title:', groupId, oldTitle, '->', title);
            const { error } = await supabase.from('tasks').update({ title }).eq('id', groupId)
            if (error) {
                console.error('[Sync] updateGroupTitle UPDATE failed:', error);
                throw error;
            }
            console.log('[Sync] updateGroupTitle UPDATE success:', groupId);
        } catch (e) {
            console.error('[Sync] updateGroupTitle failed:', e)
        }
    }, [supabase, pushAction])

    // updateGroup → updateTask にデリゲート
    const updateGroup = useCallback(async (groupId: string, updates: Partial<Task>) => {
        const beforeTask = allTasksRef.current.find(t => t.id === groupId)
        const beforeValues: Partial<Task> = {}
        for (const key of Object.keys(updates) as (keyof Task)[]) {
            if (beforeTask) (beforeValues as any)[key] = beforeTask[key]
        }

        setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...updates } : t))

        pushAction({
            description: `設定を変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...beforeValues } : t))
                await supabase.from('tasks').update(beforeValues).eq('id', groupId)
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t => t.id === groupId ? { ...t, ...updates } : t))
                await supabase.from('tasks').update(updates).eq('id', groupId)
            },
        })

        try {
            await supabase.from('tasks').update(updates).eq('id', groupId)
        } catch (e) {
            console.error('[Sync] updateGroup failed:', e)
        }
    }, [supabase, pushAction])

    // deleteGroup → deleteTask と同じロジック
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
                    await supabase.from('tasks').delete().eq('id', groupId)
                },
            })
        }

        try {
            await supabase.from('tasks').delete().eq('id', groupId)
        } catch (e) {
            console.error('[Sync] deleteGroup failed:', e)
        }
    }, [supabase, pushAction])

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

        // Background sync: 親INSERT待機 → 直接INSERT → 失敗時APIルートフォールバック（リトライあり）
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

                    // 親タスクが DB に存在することを確認（最大 3 回試行、500ms 間隔）
                    let parentExists = false;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        const { data: parentTask, error: parentError } = await supabase
                            .from('tasks')
                            .select('id')
                            .eq('id', effectiveParentId)
                            .single();

                        if (parentTask) {
                            parentExists = true;
                            console.log('[Sync] Parent task exists in DB:', effectiveParentId.slice(0, 8));
                            break;
                        }

                        console.log(`[Sync] Parent task not found (attempt ${attempt + 1}/3):`, parentError?.message);
                        if (attempt < 2) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }

                    if (!parentExists) {
                        console.error('[Sync] Parent task does not exist in DB after 3 attempts:', effectiveParentId);
                        throw new Error('Parent task not found in database');
                    }
                }

                // 全フィールドを含むINSERT（createGroupと同等の完全性）
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
                    console.log('[Sync] INSERT success:', optimisticId.slice(0, 8));
                    pendingOptimisticTasks.current.delete(optimisticId);
                    return;
                }

                console.warn('[Sync] Direct INSERT failed:', { code: insertError.code, message: insertError.message, details: insertError.details, hint: insertError.hint });

                // API route を呼ぶ前に、親タスクの INSERT 完了を再度確認
                if (effectiveParentId) {
                    const parentPending = pendingInserts.current.get(effectiveParentId);
                    if (parentPending) {
                        console.log('[Sync] Waiting for parent INSERT before API call:', effectiveParentId.slice(0, 8));
                        await parentPending;
                    }
                }

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
                    console.log('[Sync] API INSERT success:', optimisticId.slice(0, 8));
                    pendingOptimisticTasks.current.delete(optimisticId);
                    return;
                }

                const errorText = await response.text();
                console.error('[Sync] API INSERT failed:', errorText);
                console.error('[Sync] createTask ROLLBACK:', optimisticId.slice(0, 8));
                pendingOptimisticTasks.current.delete(optimisticId);
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId));
            } catch (e) {
                console.error('[Sync] createTask unexpected error:', e);
                pendingOptimisticTasks.current.delete(optimisticId);
                setAllTasks(prev => prev.filter(t => t.id !== optimisticId));
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
            // Still perform DB update directly
            console.log('[Sync] updateTask: task not in local state, updating DB directly:', taskId.slice(0, 8))
            try {
                const { error } = await supabase.from('tasks').update(updates).eq('id', taskId)
                if (error) console.error('[Sync] updateTask direct DB error:', error)
            } catch (e) {
                console.error('[Sync] updateTask direct DB failed:', e)
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
            const { error: updateError, data: updateData } = await supabase.from('tasks').update(updates).eq('id', taskId).select()
            if (updateError) {
                console.error('[Sync] updateTask DB error:', updateError)
                // Rollback optimistic update
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
                return
            }
            console.log('[Sync] updateTask DB success:', taskId.slice(0, 8), updateData)

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
                        const { error: parentDoneError } = await supabase.from('tasks').update({ status: 'done' }).eq('id', task.parent_task_id);
                        if (parentDoneError) {
                            console.error('[Sync] auto-complete parent DB error:', parentDoneError)
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
                        const { error: parentUndoneError } = await supabase.from('tasks').update({ status: 'todo' }).eq('id', task.parent_task_id);
                        if (parentUndoneError) {
                            console.error('[Sync] auto-uncomplete parent DB error:', parentUndoneError)
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
        }

        const capturedParentUndo = parentAutoCompleteUndo
        pushAction({
            description: `「${beforeTask?.title || 'タスク'}」を変更`,
            undo: async () => {
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
                await supabase.from('tasks').update(beforeValues).eq('id', taskId)
                if (capturedParentUndo) {
                    setAllTasks(prev => prev.map(t =>
                        t.id === capturedParentUndo.parentId ? { ...t, status: capturedParentUndo.beforeStatus } : t
                    ))
                    await supabase.from('tasks').update({ status: capturedParentUndo.beforeStatus }).eq('id', capturedParentUndo.parentId)
                }
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
                await supabase.from('tasks').update(updates).eq('id', taskId)
                if (capturedParentUndo) {
                    const newStatus = updates.status === 'done' ? 'done' : 'todo'
                    setAllTasks(prev => prev.map(t =>
                        t.id === capturedParentUndo.parentId ? { ...t, status: newStatus } : t
                    ))
                    await supabase.from('tasks').update({ status: newStatus }).eq('id', capturedParentUndo.parentId)
                }
            },
        })
    }, [supabase, pushAction])

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

        try {
            await cancelNotifications('task', taskId);
        } catch (error) {
            console.error('[Notification] Failed to cancel notifications:', error);
        }

        try {
            const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            if (!response.ok) {
                const error = await response.json()
                console.error('[Sync] deleteTask API failed:', error)
            }
        } catch (e) {
            console.error('[Sync] deleteTask failed:', e)
        }
    }, [cancelNotifications, supabase, pushAction])

    const moveTask = useCallback(async (taskId: string, newGroupId: string) => {
        const currentAll = allTasksRef.current;
        const task = currentAll.find(t => t.id === taskId)
        const oldParentId = task?.parent_task_id
        const taskTitle = task?.title || 'タスク'

        setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: newGroupId } : t))

        if (oldParentId) {
            pushAction({
                description: `「${taskTitle}」を移動`,
                undo: async () => {
                    setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: oldParentId } : t))
                    await supabase.from('tasks').update({ parent_task_id: oldParentId }).eq('id', taskId)
                },
                redo: async () => {
                    setAllTasks(prev => prev.map(t => t.id === taskId ? { ...t, parent_task_id: newGroupId } : t))
                    await supabase.from('tasks').update({ parent_task_id: newGroupId }).eq('id', taskId)
                },
            })
        }

        try {
            await supabase.from('tasks').update({ parent_task_id: newGroupId }).eq('id', taskId)
        } catch (e) {
            console.error('[Sync] moveTask failed:', e)
        }
    }, [supabase, pushAction])

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
        try {
            for (const id of [...groupIds, ...taskIds]) {
                await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
            }
        } catch (e) {
            console.error('[Sync] bulkDelete failed:', e)
        }
    }, [supabase, pushAction])

    // --- Helper Functions ---
    const getChildTasks = useCallback((parentTaskId: string): Task[] => {
        return tasks.filter(t => t.parent_task_id === parentTaskId).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    const getParentTasks = useCallback((groupId: string): Task[] => {
        return tasks.filter(t => t.parent_task_id === groupId).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    // --- Reorder Operations ---
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
                await supabase.from('tasks').update({
                    parent_task_id: beforeParentId,
                    order_index: beforeOrderIndex,
                }).eq('id', taskId)
                for (const sib of siblings) {
                    const original = currentAll.find(o => o.id === sib.id)
                    if (original && original.order_index !== sib.order_index) {
                        await supabase.from('tasks').update({ order_index: original.order_index }).eq('id', sib.id)
                    }
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
                    await supabase.from('tasks').update(rest).eq('id', id)
                }
            },
        })

        try {
            for (const u of updates) {
                const { id, ...rest } = u
                await supabase.from('tasks').update(rest).eq('id', id)
            }
        } catch (e) {
            console.error('[Sync] reorderTask failed:', e)
        }
    }, [supabase, pushAction])

    // reorderGroup → reorderTask にデリゲート（ルートタスクの並び替え）
    const reorderGroup = useCallback(async (groupId: string, referenceGroupId: string, position: 'above' | 'below') => {
        return reorderTask(groupId, referenceGroupId, position)
    }, [reorderTask])

    // タスクをルートに昇格（parent_task_id を null に変更）
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
                await supabase.from('tasks').update({
                    parent_task_id: beforeParentId,
                    order_index: task.order_index,
                }).eq('id', taskId)
            },
            redo: async () => {
                setAllTasks(prev => prev.map(t =>
                    t.id === taskId ? { ...t, parent_task_id: null, project_id: projectId, order_index: maxOrder } : t
                ))
                await supabase.from('tasks').update({
                    parent_task_id: null,
                    project_id: projectId,
                    order_index: maxOrder,
                }).eq('id', taskId)
            },
        })

        try {
            await supabase.from('tasks').update({
                parent_task_id: null,
                project_id: projectId,
                order_index: maxOrder,
            }).eq('id', taskId)
        } catch (e) {
            console.error('[Sync] promoteTaskToGroup failed:', e)
        }
    }, [projectId, supabase, pushAction])

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
