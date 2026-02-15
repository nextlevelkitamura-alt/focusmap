"use client"

import { useCallback, useEffect, useState, useMemo } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Task, TaskGroup } from '@/types/database'
import { useNotificationScheduler } from '@/hooks/useNotificationScheduler'
import { useUndoRedo } from '@/hooks/useUndoRedo'
import { getGroups, isGroup } from '@/lib/task-helpers'

interface UseMindMapSyncProps {
    projectId: string | null
    userId: string
    initialGroups: TaskGroup[]  // 🔄 Phase 2では互換性のため残す
    initialTasks?: Task[]
}

interface UseMindMapSyncReturn {
    groups: TaskGroup[]
    tasks: Task[]
    createGroup: (title: string) => Promise<TaskGroup | null>
    updateGroupTitle: (groupId: string, newTitle: string) => Promise<void>
    updateGroup: (groupId: string, updates: Partial<TaskGroup>) => Promise<void>
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

    // 🆕 統合されたステート管理（グループとタスクを1つのリストに）
    const [allTasks, setAllTasks] = useState<Task[]>([
        ...initialGroups.map(g => ({ ...g, is_group: true, group_id: null, project_id: g.project_id } as Task)),
        ...initialTasks
    ])
    const [isLoading, setIsLoading] = useState(false)
    const { pushAction, undo, redo, canUndo, canRedo, clear } = useUndoRedo()

    // 🆕 計算プロパティ: グループとタスクを分離（早期に宣言して依存関係を解決）
    const groups = useMemo(() => {
        return allTasks
            .filter(t => t.is_group === true)
            .sort((a, b) => a.order_index - b.order_index) as TaskGroup[]
    }, [allTasks])

    const tasks = useMemo(() => {
        return allTasks
            .filter(t => t.is_group !== true)
            .sort((a, b) => a.order_index - b.order_index)
    }, [allTasks])

    // setGroups と setTasks のエイリアス（後方互換性のため）
    const setGroups = useCallback((updater: TaskGroup[] | ((prev: TaskGroup[]) => TaskGroup[])) => {
        setAllTasks(prev => {
            const currentGroups = prev.filter(t => t.is_group === true) as TaskGroup[]
            const currentTasks = prev.filter(t => t.is_group !== true)
            const newGroups = typeof updater === 'function' ? updater(currentGroups) : updater
            return [...(newGroups as Task[]), ...currentTasks]
        })
    }, [])

    const setTasks = useCallback((updater: Task[] | ((prev: Task[]) => Task[])) => {
        setAllTasks(prev => {
            const currentGroups = prev.filter(t => t.is_group === true)
            const currentTasks = prev.filter(t => t.is_group !== true)
            const newTasks = typeof updater === 'function' ? updater(currentTasks) : updater
            return [...currentGroups, ...newTasks]
        })
    }, [])

    // 🆕 初期データの更新時に統合
    useEffect(() => {
        setAllTasks([
            ...initialGroups.map(g => ({ ...g, is_group: true, group_id: null, project_id: g.project_id } as Task)),
            ...initialTasks
        ])
    }, [initialGroups, initialTasks])

    // プロジェクト切替時にundo/redoスタックをクリア
    useEffect(() => { clear() }, [projectId, clear])

    // カレンダー同期は useTaskCalendarSync フック（center-pane.tsx）に一元化
    // updateTask では DB 更新のみ行い、props 変更で useTaskCalendarSync が検知して同期する

    // --- Group Operations ---
    const createGroup = useCallback(async (title: string) => {
        if (!projectId) return null
        setIsLoading(true)
        try {
            const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.order_index)) + 1 : 0
            const { data, error } = await supabase.from('task_groups').insert({
                user_id: userId,
                project_id: projectId,
                title,
                order_index: maxOrder
            }).select().single()

            if (error) throw error
            if (data) {
                setGroups(prev => [...prev, data].sort((a, b) => a.order_index - b.order_index))
                pushAction({
                    description: `「${title}」グループを作成`,
                    undo: async () => {
                        setGroups(prev => prev.filter(g => g.id !== data.id))
                        await supabase.from('task_groups').delete().eq('id', data.id)
                    },
                    redo: async () => {
                        setGroups(prev => [...prev, data].sort((a, b) => a.order_index - b.order_index))
                        await supabase.from('task_groups').upsert(data)
                    },
                })
            }
            return data
        } catch (e) {
            console.error('[Sync] createGroup failed:', e)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [projectId, userId, groups, supabase, pushAction])

    const updateGroupTitle = useCallback(async (groupId: string, title: string) => {
        const oldTitle = groups.find(g => g.id === groupId)?.title ?? ''
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, title } : g))

        pushAction({
            description: `「${oldTitle}」の名前変更`,
            undo: async () => {
                setGroups(prev => prev.map(g => g.id === groupId ? { ...g, title: oldTitle } : g))
                await supabase.from('task_groups').update({ title: oldTitle }).eq('id', groupId)
            },
            redo: async () => {
                setGroups(prev => prev.map(g => g.id === groupId ? { ...g, title } : g))
                await supabase.from('task_groups').update({ title }).eq('id', groupId)
            },
        })

        try {
            await supabase.from('task_groups').update({ title }).eq('id', groupId)
        } catch (e) {
            console.error('[Sync] updateGroupTitle failed:', e)
        }
    }, [supabase, groups, pushAction])

    const updateGroup = useCallback(async (groupId: string, updates: Partial<TaskGroup>) => {
        const beforeGroup = groups.find(g => g.id === groupId)
        const beforeValues: Partial<TaskGroup> = {}
        for (const key of Object.keys(updates) as (keyof TaskGroup)[]) {
            if (beforeGroup) (beforeValues as any)[key] = beforeGroup[key]
        }

        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g))

        pushAction({
            description: `グループ設定を変更`,
            undo: async () => {
                setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...beforeValues } : g))
                await supabase.from('task_groups').update(beforeValues).eq('id', groupId)
            },
            redo: async () => {
                setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g))
                await supabase.from('task_groups').update(updates).eq('id', groupId)
            },
        })

        try {
            await supabase.from('task_groups').update(updates).eq('id', groupId)
        } catch (e) {
            console.error('[Sync] updateGroup failed:', e)
        }
    }, [supabase, groups, pushAction])

    const deleteGroup = useCallback(async (groupId: string) => {
        const capturedGroup = groups.find(g => g.id === groupId)
        const capturedTasks = tasks.filter(t => t.group_id === groupId)

        setGroups(prev => prev.filter(g => g.id !== groupId))
        setTasks(prev => prev.filter(t => t.group_id !== groupId))

        if (capturedGroup) {
            pushAction({
                description: `「${capturedGroup.title}」グループを削除`,
                undo: async () => {
                    setGroups(prev => [...prev, capturedGroup].sort((a, b) => a.order_index - b.order_index))
                    setTasks(prev => [...prev, ...capturedTasks.map(t => ({ ...t, google_event_id: null }))])
                    await supabase.from('task_groups').upsert(capturedGroup)
                    for (const task of capturedTasks) {
                        const { google_event_id, ...rest } = task
                        await supabase.from('tasks').upsert({ ...rest, google_event_id: null })
                    }
                },
                redo: async () => {
                    setGroups(prev => prev.filter(g => g.id !== groupId))
                    setTasks(prev => prev.filter(t => t.group_id !== groupId))
                    await supabase.from('task_groups').delete().eq('id', groupId)
                },
            })
        }

        try {
            await supabase.from('task_groups').delete().eq('id', groupId)
        } catch (e) {
            console.error('[Sync] deleteGroup failed:', e)
        }
    }, [supabase, groups, tasks, pushAction])

    // --- Task Operations ---
    const createTask = useCallback(async (groupId: string, title: string = "New Task", parentTaskId: string | null = null): Promise<Task | null> => {
        const optimisticId = crypto.randomUUID();
        const now = new Date().toISOString();

        const groupTasks = tasks.filter(t => t.group_id === groupId);
        const maxOrder = groupTasks.length > 0 ? Math.max(...groupTasks.map(t => t.order_index ?? 0)) + 1 : 0;

        const optimisticTask: Task = {
            id: optimisticId,
            user_id: userId,
            group_id: groupId,
            parent_task_id: parentTaskId,
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
            created_at: now,
        };

        setTasks(prev => [...prev, optimisticTask]);

        pushAction({
            description: `タスクを作成`,
            undo: async () => {
                setTasks(prev => prev.filter(t => t.id !== optimisticId))
                try {
                    await fetch(`/api/tasks/${optimisticId}`, { method: 'DELETE' })
                } catch (e) {
                    console.error('[UndoRedo] undo createTask failed:', e)
                }
            },
            redo: async () => {
                setTasks(prev => [...prev, optimisticTask])
                await supabase.from('tasks').upsert(optimisticTask)
            },
        })

        // Background sync via API route
        ;(async () => {
            try {
                const response = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: optimisticId,
                        group_id: groupId,
                        parent_task_id: parentTaskId,
                        title,
                        order_index: maxOrder,
                    }),
                });

                const result = await response.json();

                if (!result.success) {
                    console.error('[Sync] createTask API failed:', result.error);
                    throw new Error(result.error?.message || 'タスクの作成に失敗しました');
                }

                if (result.task) {
                    setTasks(prev => prev.map(t => t.id === optimisticId ? result.task : t));
                }
            } catch (e: any) {
                console.error('[Sync] createTask failed, rolling back:', e);
                setTasks(prev => prev.filter(t => t.id !== optimisticId));
                alert(`タスクの作成に失敗しました: ${e?.message || '不明なエラー'}`);
            }
        })();

        return optimisticTask;
    }, [userId, tasks, supabase, pushAction]);

    const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
        // Capture before state for undo
        const beforeTask = tasks.find(t => t.id === taskId)
        const beforeValues: Partial<Task> = {}
        for (const key of Object.keys(updates) as (keyof Task)[]) {
            if (beforeTask) (beforeValues as any)[key] = beforeTask[key]
        }

        // Capture parent status for auto-complete undo
        let parentAutoCompleteUndo: { parentId: string; beforeStatus: string } | null = null

        // Optimistic update
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))

        try {
            await supabase.from('tasks').update(updates).eq('id', taskId)

            // AUTO-COMPLETE PARENT
            if (updates.status === 'done') {
                const task = tasks.find(t => t.id === taskId);
                if (task?.parent_task_id) {
                    const siblings = tasks
                        .filter(t => t.parent_task_id === task.parent_task_id)
                        .map(t => t.id === taskId ? { ...t, status: 'done' } : t);

                    const allSiblingsDone = siblings.every(s => s.status === 'done');

                    if (allSiblingsDone) {
                        const parent = tasks.find(t => t.id === task.parent_task_id)
                        if (parent && parent.status !== 'done') {
                            parentAutoCompleteUndo = { parentId: task.parent_task_id, beforeStatus: parent.status }
                        }
                        setTasks(prev => prev.map(t =>
                            t.id === task.parent_task_id ? { ...t, status: 'done' } : t
                        ));
                        await supabase.from('tasks').update({ status: 'done' }).eq('id', task.parent_task_id);
                    }
                }
            }

            // AUTO-UNCOMPLETE PARENT
            if (updates.status && updates.status !== 'done') {
                const task = tasks.find(t => t.id === taskId);
                if (task?.parent_task_id) {
                    const parent = tasks.find(t => t.id === task.parent_task_id);
                    if (parent?.status === 'done') {
                        parentAutoCompleteUndo = { parentId: task.parent_task_id, beforeStatus: parent.status }
                        setTasks(prev => prev.map(t =>
                            t.id === task.parent_task_id ? { ...t, status: 'todo' } : t
                        ));
                        await supabase.from('tasks').update({ status: 'todo' }).eq('id', task.parent_task_id);
                    }
                }
            }
        } catch (e) {
            console.error('[Sync] updateTask failed:', e)
        }

        // Record undo action (after auto-complete so we capture parent changes)
        const capturedParentUndo = parentAutoCompleteUndo
        pushAction({
            description: `「${beforeTask?.title || 'タスク'}」を変更`,
            undo: async () => {
                setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...beforeValues } : t))
                await supabase.from('tasks').update(beforeValues).eq('id', taskId)
                // Restore parent auto-complete if it was triggered
                if (capturedParentUndo) {
                    setTasks(prev => prev.map(t =>
                        t.id === capturedParentUndo.parentId ? { ...t, status: capturedParentUndo.beforeStatus } : t
                    ))
                    await supabase.from('tasks').update({ status: capturedParentUndo.beforeStatus }).eq('id', capturedParentUndo.parentId)
                }
            },
            redo: async () => {
                setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))
                await supabase.from('tasks').update(updates).eq('id', taskId)
                // Re-apply auto-complete
                if (capturedParentUndo) {
                    const newStatus = updates.status === 'done' ? 'done' : 'todo'
                    setTasks(prev => prev.map(t =>
                        t.id === capturedParentUndo.parentId ? { ...t, status: newStatus } : t
                    ))
                    await supabase.from('tasks').update({ status: newStatus }).eq('id', capturedParentUndo.parentId)
                }
            },
        })
    }, [supabase, tasks, pushAction])

    const deleteTask = useCallback(async (taskId: string) => {
        // Capture task + all descendants before deletion
        const capturedTask = tasks.find(t => t.id === taskId)
        const getDescendants = (id: string): Task[] => {
            const children = tasks.filter(t => t.parent_task_id === id)
            return children.flatMap(c => [c, ...getDescendants(c.id)])
        }
        const capturedDescendants = getDescendants(taskId)
        const allCaptured = capturedTask ? [capturedTask, ...capturedDescendants] : capturedDescendants

        // Optimistic UI update (remove task + descendants)
        const allIds = new Set(allCaptured.map(t => t.id))
        setTasks(prev => prev.filter(t => !allIds.has(t.id)))

        if (capturedTask) {
            pushAction({
                description: `「${capturedTask.title}」を削除`,
                undo: async () => {
                    // Restore all captured tasks (with google_event_id reset for re-sync)
                    const restored = allCaptured.map(t => ({ ...t, google_event_id: null }))
                    setTasks(prev => [...prev, ...restored])
                    for (const task of allCaptured) {
                        const { google_event_id, ...rest } = task
                        await supabase.from('tasks').upsert({ ...rest, google_event_id: null })
                    }
                },
                redo: async () => {
                    setTasks(prev => prev.filter(t => !allIds.has(t.id)))
                    try {
                        await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
                    } catch (e) {
                        console.error('[UndoRedo] redo deleteTask failed:', e)
                    }
                },
            })
        }

        // Cancel notifications
        try {
            await cancelNotifications('task', taskId);
        } catch (error) {
            console.error('[Notification] Failed to cancel notifications:', error);
        }

        // Call API endpoint which handles both calendar event and task deletion
        try {
            const response = await fetch(`/api/tasks/${taskId}`, {
                method: 'DELETE',
            })

            if (!response.ok) {
                const error = await response.json()
                console.error('[Sync] deleteTask API failed:', error)
                throw new Error(error.error?.message || 'Failed to delete task')
            }
        } catch (e) {
            console.error('[Sync] deleteTask failed:', e)
        }
    }, [cancelNotifications, tasks, supabase, pushAction])

    const moveTask = useCallback(async (taskId: string, newGroupId: string) => {
        const oldGroupId = tasks.find(t => t.id === taskId)?.group_id
        const taskTitle = tasks.find(t => t.id === taskId)?.title || 'タスク'

        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, group_id: newGroupId } : t))

        if (oldGroupId) {
            pushAction({
                description: `「${taskTitle}」を移動`,
                undo: async () => {
                    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, group_id: oldGroupId } : t))
                    await supabase.from('tasks').update({ group_id: oldGroupId }).eq('id', taskId)
                },
                redo: async () => {
                    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, group_id: newGroupId } : t))
                    await supabase.from('tasks').update({ group_id: newGroupId }).eq('id', taskId)
                },
            })
        }

        try {
            await supabase.from('tasks').update({ group_id: newGroupId }).eq('id', taskId)
        } catch (e) {
            console.error('[Sync] moveTask failed:', e)
        }
    }, [supabase, tasks, pushAction])

    // --- Bulk Delete (with single undo action) ---
    const bulkDelete = useCallback(async (groupIds: string[], taskIds: string[]) => {
        const capturedGroups = groups.filter(g => groupIds.includes(g.id))
        // Capture tasks from deleted groups + individually selected tasks
        const groupTaskIds = new Set(tasks.filter(t => groupIds.includes(t.group_id)).map(t => t.id))
        const allTaskIds = new Set([...taskIds, ...groupTaskIds])
        // Also capture descendants of explicitly selected tasks
        const getDescendants = (id: string): string[] => {
            const children = tasks.filter(t => t.parent_task_id === id)
            return children.flatMap(c => [c.id, ...getDescendants(c.id)])
        }
        for (const tid of taskIds) {
            for (const did of getDescendants(tid)) allTaskIds.add(did)
        }
        const capturedTasks = tasks.filter(t => allTaskIds.has(t.id))

        // Optimistic UI update
        setGroups(prev => prev.filter(g => !groupIds.includes(g.id)))
        setTasks(prev => prev.filter(t => !allTaskIds.has(t.id)))

        pushAction({
            description: `${capturedGroups.length > 0 ? capturedGroups.length + '個のグループ' : ''}${capturedGroups.length > 0 && capturedTasks.length > 0 ? 'と' : ''}${capturedTasks.length > 0 ? capturedTasks.length + '個のタスク' : ''}を削除`,
            undo: async () => {
                if (capturedGroups.length > 0) {
                    setGroups(prev => [...prev, ...capturedGroups].sort((a, b) => a.order_index - b.order_index))
                    for (const group of capturedGroups) {
                        await supabase.from('task_groups').upsert(group)
                    }
                }
                if (capturedTasks.length > 0) {
                    const restored = capturedTasks.map(t => ({ ...t, google_event_id: null }))
                    setTasks(prev => [...prev, ...restored])
                    for (const task of capturedTasks) {
                        const { google_event_id, ...rest } = task
                        await supabase.from('tasks').upsert({ ...rest, google_event_id: null })
                    }
                }
            },
            redo: async () => {
                setGroups(prev => prev.filter(g => !groupIds.includes(g.id)))
                setTasks(prev => prev.filter(t => !allTaskIds.has(t.id)))
                for (const gid of groupIds) {
                    await supabase.from('task_groups').delete().eq('id', gid)
                }
                for (const tid of taskIds) {
                    try { await fetch(`/api/tasks/${tid}`, { method: 'DELETE' }) } catch {}
                }
            },
        })

        // DB sync
        try {
            for (const gid of groupIds) {
                await supabase.from('task_groups').delete().eq('id', gid)
            }
            // Delete only explicitly selected tasks (group tasks are cascade deleted)
            for (const tid of taskIds) {
                if (!groupTaskIds.has(tid)) {
                    await fetch(`/api/tasks/${tid}`, { method: 'DELETE' })
                }
            }
        } catch (e) {
            console.error('[Sync] bulkDelete failed:', e)
        }
    }, [supabase, groups, tasks, pushAction])

    // --- Helper Functions ---
    const getChildTasks = useCallback((parentTaskId: string): Task[] => {
        return tasks.filter(t => t.parent_task_id === parentTaskId).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    const getParentTasks = useCallback((groupId: string): Task[] => {
        return tasks.filter(t => t.group_id === groupId && !t.parent_task_id).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    // --- Reorder Operations ---
    const reorderTask = useCallback(async (taskId: string, referenceTaskId: string, position: 'above' | 'below') => {
        const task = tasks.find(t => t.id === taskId)
        const referenceTask = tasks.find(t => t.id === referenceTaskId)
        if (!task || !referenceTask) return

        // Before state for undo
        const beforeGroupId = task.group_id
        const beforeParentId = task.parent_task_id
        const beforeOrderIndex = task.order_index

        // Siblings at drop target (excluding the dragged task)
        const siblings = tasks
            .filter(t =>
                t.group_id === referenceTask.group_id &&
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

        // Build updates
        const updates: { id: string; order_index: number; group_id?: string; parent_task_id?: string | null }[] = []
        reordered.forEach((t, i) => {
            if (t.id === taskId) {
                updates.push({
                    id: t.id,
                    order_index: i,
                    group_id: referenceTask.group_id,
                    parent_task_id: referenceTask.parent_task_id,
                })
            } else if ((t.order_index ?? 0) !== i) {
                updates.push({ id: t.id, order_index: i })
            }
        })

        // Optimistic update
        setTasks(prev => {
            let updated = [...prev]
            for (const u of updates) {
                updated = updated.map(t => t.id === u.id ? { ...t, ...u } : t)
            }
            return updated
        })

        pushAction({
            description: `「${task.title}」を並び替え`,
            undo: async () => {
                // Restore original position
                setTasks(prev => prev.map(t => {
                    if (t.id === taskId) {
                        return { ...t, group_id: beforeGroupId, parent_task_id: beforeParentId, order_index: beforeOrderIndex }
                    }
                    const original = tasks.find(o => o.id === t.id)
                    return original ? { ...t, order_index: original.order_index } : t
                }))
                await supabase.from('tasks').update({
                    group_id: beforeGroupId,
                    parent_task_id: beforeParentId,
                    order_index: beforeOrderIndex,
                }).eq('id', taskId)
                // Restore sibling order_index
                for (const sib of siblings) {
                    const original = tasks.find(o => o.id === sib.id)
                    if (original && original.order_index !== sib.order_index) {
                        await supabase.from('tasks').update({ order_index: original.order_index }).eq('id', sib.id)
                    }
                }
            },
            redo: async () => {
                setTasks(prev => {
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

        // DB sync
        try {
            for (const u of updates) {
                const { id, ...rest } = u
                await supabase.from('tasks').update(rest).eq('id', id)
            }
        } catch (e) {
            console.error('[Sync] reorderTask failed:', e)
        }
    }, [supabase, tasks, pushAction])

    const reorderGroup = useCallback(async (groupId: string, referenceGroupId: string, position: 'above' | 'below') => {
        const movingGroup = groups.find(g => g.id === groupId)
        if (!movingGroup) return

        const siblings = groups
            .filter(g => g.id !== groupId)
            .sort((a, b) => a.order_index - b.order_index)

        const refIndex = siblings.findIndex(g => g.id === referenceGroupId)
        const insertAt = position === 'above' ? refIndex : refIndex + 1

        const reordered = [
            ...siblings.slice(0, insertAt),
            movingGroup,
            ...siblings.slice(insertAt),
        ]

        // Build updates
        const updates: { id: string; order_index: number }[] = []
        reordered.forEach((g, i) => {
            if (g.order_index !== i) {
                updates.push({ id: g.id, order_index: i })
            }
        })

        // Before state for undo
        const beforeOrders = groups.map(g => ({ id: g.id, order_index: g.order_index }))

        // Optimistic update
        setGroups(prev => {
            let updated = [...prev]
            for (const u of updates) {
                updated = updated.map(g => g.id === u.id ? { ...g, order_index: u.order_index } : g)
            }
            return updated.sort((a, b) => a.order_index - b.order_index)
        })

        pushAction({
            description: `「${movingGroup.title}」グループを並び替え`,
            undo: async () => {
                setGroups(prev => {
                    let updated = [...prev]
                    for (const bo of beforeOrders) {
                        updated = updated.map(g => g.id === bo.id ? { ...g, order_index: bo.order_index } : g)
                    }
                    return updated.sort((a, b) => a.order_index - b.order_index)
                })
                for (const bo of beforeOrders) {
                    await supabase.from('task_groups').update({ order_index: bo.order_index }).eq('id', bo.id)
                }
            },
            redo: async () => {
                setGroups(prev => {
                    let updated = [...prev]
                    for (const u of updates) {
                        updated = updated.map(g => g.id === u.id ? { ...g, order_index: u.order_index } : g)
                    }
                    return updated.sort((a, b) => a.order_index - b.order_index)
                })
                for (const u of updates) {
                    await supabase.from('task_groups').update({ order_index: u.order_index }).eq('id', u.id)
                }
            },
        })

        // DB sync
        try {
            for (const u of updates) {
                await supabase.from('task_groups').update({ order_index: u.order_index }).eq('id', u.id)
            }
        } catch (e) {
            console.error('[Sync] reorderGroup failed:', e)
        }
    }, [supabase, groups, pushAction])

    // タスクをプロジェクトノードにドロップ → 新グループ作成 + タスク移動（1 undo で戻る）
    const promoteTaskToGroup = useCallback(async (taskId: string) => {
        const task = tasks.find(t => t.id === taskId)
        if (!task || !projectId) return

        const beforeGroupId = task.group_id
        const beforeParentId = task.parent_task_id
        const childTasks = tasks.filter(t => t.group_id === task.group_id && t.parent_task_id === taskId)
        const childBefore = childTasks.map(c => ({ id: c.id, group_id: c.group_id }))

        try {
            const maxOrder = groups.length > 0 ? Math.max(...groups.map(g => g.order_index)) + 1 : 0
            const { data: newGroup, error } = await supabase.from('task_groups').insert({
                user_id: userId,
                project_id: projectId,
                title: task.title,
                order_index: maxOrder,
            }).select().single()

            if (error || !newGroup) throw error || new Error('Group creation failed')

            // Optimistic update
            setGroups(prev => [...prev, newGroup].sort((a, b) => a.order_index - b.order_index))
            setTasks(prev => prev.map(t => {
                if (t.id === taskId) return { ...t, group_id: newGroup.id, parent_task_id: null }
                if (childTasks.some(c => c.id === t.id)) return { ...t, group_id: newGroup.id }
                return t
            }))

            // DB sync
            await supabase.from('tasks').update({ group_id: newGroup.id, parent_task_id: null }).eq('id', taskId)
            for (const child of childTasks) {
                await supabase.from('tasks').update({ group_id: newGroup.id }).eq('id', child.id)
            }

            pushAction({
                description: `「${task.title}」をグループに昇格`,
                undo: async () => {
                    // タスクを元に戻す
                    setTasks(prev => prev.map(t => {
                        if (t.id === taskId) return { ...t, group_id: beforeGroupId, parent_task_id: beforeParentId }
                        const cb = childBefore.find(c => c.id === t.id)
                        if (cb) return { ...t, group_id: cb.group_id }
                        return t
                    }))
                    setGroups(prev => prev.filter(g => g.id !== newGroup.id))
                    await supabase.from('tasks').update({ group_id: beforeGroupId, parent_task_id: beforeParentId }).eq('id', taskId)
                    for (const cb of childBefore) {
                        await supabase.from('tasks').update({ group_id: cb.group_id }).eq('id', cb.id)
                    }
                    await supabase.from('task_groups').delete().eq('id', newGroup.id)
                },
                redo: async () => {
                    setGroups(prev => [...prev, newGroup].sort((a, b) => a.order_index - b.order_index))
                    setTasks(prev => prev.map(t => {
                        if (t.id === taskId) return { ...t, group_id: newGroup.id, parent_task_id: null }
                        if (childTasks.some(c => c.id === t.id)) return { ...t, group_id: newGroup.id }
                        return t
                    }))
                    await supabase.from('task_groups').upsert(newGroup)
                    await supabase.from('tasks').update({ group_id: newGroup.id, parent_task_id: null }).eq('id', taskId)
                    for (const child of childTasks) {
                        await supabase.from('tasks').update({ group_id: newGroup.id }).eq('id', child.id)
                    }
                },
            })
        } catch (e) {
            console.error('[Sync] promoteTaskToGroup failed:', e)
        }
    }, [projectId, userId, groups, tasks, supabase, pushAction])

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
