"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Task, TaskGroup } from '@/types/database'
import { useNotificationScheduler } from '@/hooks/useNotificationScheduler'

interface UseMindMapSyncProps {
    projectId: string | null
    userId: string
    initialGroups: TaskGroup[]
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
    isLoading: boolean
    // Helper functions for parent-child relationships
    getChildTasks: (parentTaskId: string) => Task[]
    getParentTasks: (groupId: string) => Task[]
}

export function useMindMapSync({
    projectId,
    userId,
    initialGroups,
    initialTasks = []
}: UseMindMapSyncProps): UseMindMapSyncReturn {
    const supabase = createClient()
    const { scheduleNotification, cancelNotifications } = useNotificationScheduler()
    const [groups, setGroups] = useState<TaskGroup[]>(initialGroups)
    const [tasks, setTasks] = useState<Task[]>(initialTasks)
    const [isLoading, setIsLoading] = useState(false)

    // Keep local state in sync with server-provided initial data
    // (These inputs are stable in DashboardClient via useMemo, so this won't loop.)
    useEffect(() => { setGroups(initialGroups) }, [initialGroups])
    useEffect(() => { setTasks(initialTasks) }, [initialTasks])

    // TEMPORARILY DISABLED REALTIME TO PREVENT CRASH
    // TODO: Re-enable with proper error handling once the root cause is identified
    /*
    useEffect(() => {
        if (!projectId || !userId) return
        // ... realtime subscription code ...
    }, [projectId, userId, supabase])
    */

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
            if (data) setGroups(prev => [...prev, data].sort((a, b) => a.order_index - b.order_index))
            return data
        } catch (e) {
            console.error('[Sync] createGroup failed:', e)
            return null
        } finally {
            setIsLoading(false)
        }
    }, [projectId, userId, groups, supabase])

    const updateGroupTitle = useCallback(async (groupId: string, title: string) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, title } : g))
        try {
            await supabase.from('task_groups').update({ title }).eq('id', groupId)
        } catch (e) {
            console.error('[Sync] updateGroupTitle failed:', e)
        }
    }, [supabase])

    const updateGroup = useCallback(async (groupId: string, updates: Partial<TaskGroup>) => {
        setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...updates } : g))
        try {
            await supabase.from('task_groups').update(updates).eq('id', groupId)
        } catch (e) {
            console.error('[Sync] updateGroup failed:', e)
        }
    }, [supabase])

    const deleteGroup = useCallback(async (groupId: string) => {
        setGroups(prev => prev.filter(g => g.id !== groupId))
        setTasks(prev => prev.filter(t => t.group_id !== groupId))
        try {
            await supabase.from('task_groups').delete().eq('id', groupId)
        } catch (e) {
            console.error('[Sync] deleteGroup failed:', e)
        }
    }, [supabase])

    // --- Task Operations ---
    // OPTIMISTIC UI: Generate client-side UUID and update local state immediately
    const createTask = useCallback(async (groupId: string, title: string = "New Task", parentTaskId: string | null = null): Promise<Task | null> => {
        // Generate client-side UUID for instant feedback
        const optimisticId = crypto.randomUUID();
        const now = new Date().toISOString();

        const groupTasks = tasks.filter(t => t.group_id === groupId);
        const maxOrder = groupTasks.length > 0 ? Math.max(...groupTasks.map(t => t.order_index ?? 0)) + 1 : 0;

        // Create optimistic task object
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
            // Timer fields
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            created_at: now,
        };

        // IMMEDIATELY update local state (Optimistic Update)
        setTasks(prev => [...prev, optimisticTask]);

        // Return optimistic task immediately for instant focus
        // Background sync to Supabase
        (async () => {
            try {
                const { data, error } = await supabase.from('tasks').insert({
                    id: optimisticId, // Use the same ID we generated
                    user_id: userId,
                    group_id: groupId,
                    parent_task_id: parentTaskId,
                    title,
                    status: 'todo',
                    // priority: null で作成（明示的に設定されるまで未設定）
                    order_index: maxOrder,
                    actual_time_minutes: 0,
                    estimated_time: 0
                }).select().single();

                if (error) {
                    throw error;
                }

                // Update with server response (in case of any server-side modifications)
                if (data) {
                    setTasks(prev => prev.map(t => t.id === optimisticId ? data : t));
                }
            } catch (e) {
                console.error('[Sync] createTask failed, rolling back:', e);
                // ROLLBACK: Remove the optimistic task
                setTasks(prev => prev.filter(t => t.id !== optimisticId));
                alert('タスクの作成に失敗しました。もう一度お試しください。');
            }
        })();

        return optimisticTask;
    }, [userId, tasks, supabase]);

    const updateTask = useCallback(async (taskId: string, updates: Partial<Task>) => {
        // Optimistic update
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t))

        try {
            await supabase.from('tasks').update(updates).eq('id', taskId)

            // GOOGLE CALENDAR SYNC: If scheduled_at or estimated_time is updated
            if (updates.scheduled_at !== undefined || updates.estimated_time !== undefined) {
                const task = tasks.find(t => t.id === taskId);
                const updatedTask = { ...task, ...updates };

                // Cancel existing notifications for this task
                if (updatedTask?.scheduled_at) {
                    try {
                        await cancelNotifications('task', taskId);
                    } catch (error) {
                        console.error('[Notification] Failed to cancel notifications:', error);
                    }
                }

                // Only sync if both scheduled_at and estimated_time are present
                if (updatedTask.scheduled_at && updatedTask.estimated_time) {
                    try {
                        await fetch('/api/calendar/sync-task', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ taskId })
                        });
                    } catch (error) {
                        console.error('[Calendar Sync] Failed to sync task:', error);
                        // Don't block the task update if calendar sync fails
                    }

                    // Schedule notification for task start
                    try {
                        const scheduledTime = new Date(updatedTask.scheduled_at);
                        const notificationTime = new Date(scheduledTime.getTime() - 15 * 60 * 1000); // 15 minutes before

                        if (notificationTime > new Date()) {
                            await scheduleNotification({
                                targetType: 'task',
                                targetId: taskId,
                                notificationType: 'task_start',
                                scheduledAt: notificationTime,
                                title: 'タスク開始',
                                body: updatedTask.title || 'タスクがまもなく開始されます',
                                actionUrl: `/dashboard?task=${taskId}`,
                            });
                        }
                    } catch (error) {
                        console.error('[Notification] Failed to schedule notification:', error);
                        // Don't block the task update if notification fails
                    }
                }
            }

            // AUTO-COMPLETE PARENT: If status changed to 'done', check if all siblings are also done
            if (updates.status === 'done') {
                const task = tasks.find(t => t.id === taskId);
                if (task?.parent_task_id) {
                    // Get all siblings (including this task with updated status)
                    const siblings = tasks
                        .filter(t => t.parent_task_id === task.parent_task_id)
                        .map(t => t.id === taskId ? { ...t, status: 'done' } : t);

                    // Check if ALL siblings are done
                    const allSiblingsDone = siblings.every(s => s.status === 'done');

                    if (allSiblingsDone) {
                        console.log('[AutoComplete] All children done, completing parent:', task.parent_task_id);
                        // Auto-complete parent (optimistic + DB)
                        setTasks(prev => prev.map(t =>
                            t.id === task.parent_task_id ? { ...t, status: 'done' } : t
                        ));
                        await supabase.from('tasks').update({ status: 'done' }).eq('id', task.parent_task_id);
                    }
                }
            }

            // AUTO-UNCOMPLETE PARENT: If status changed to 'todo'/'pending', uncomplete parent if it was done
            if (updates.status && updates.status !== 'done') {
                const task = tasks.find(t => t.id === taskId);
                if (task?.parent_task_id) {
                    const parent = tasks.find(t => t.id === task.parent_task_id);
                    if (parent?.status === 'done') {
                        console.log('[AutoComplete] Child incomplete, uncompleting parent:', task.parent_task_id);
                        // Auto-uncomplete parent (optimistic + DB)
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
    }, [supabase, tasks])

    const deleteTask = useCallback(async (taskId: string) => {
        setTasks(prev => prev.filter(t => t.id !== taskId))

        // Cancel notifications for this task
        try {
            await cancelNotifications('task', taskId);
        } catch (error) {
            console.error('[Notification] Failed to cancel notifications:', error);
            // Don't block the task deletion if notification cancellation fails
        }

        try {
            await supabase.from('tasks').delete().eq('id', taskId)
        } catch (e) {
            console.error('[Sync] deleteTask failed:', e)
        }
    }, [supabase, cancelNotifications])

    const moveTask = useCallback(async (taskId: string, newGroupId: string) => {
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, group_id: newGroupId } : t))
        try {
            await supabase.from('tasks').update({ group_id: newGroupId }).eq('id', taskId)
        } catch (e) {
            console.error('[Sync] moveTask failed:', e)
        }
    }, [supabase])

    // --- Helper Functions for Parent-Child Relationships ---
    const getChildTasks = useCallback((parentTaskId: string): Task[] => {
        return tasks.filter(t => t.parent_task_id === parentTaskId).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

    const getParentTasks = useCallback((groupId: string): Task[] => {
        return tasks.filter(t => t.group_id === groupId && !t.parent_task_id).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
    }, [tasks])

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
        isLoading,
        getChildTasks,
        getParentTasks
    }
}
