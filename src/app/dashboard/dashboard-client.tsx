"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { LeftSidebar } from "@/components/dashboard/left-sidebar"
import { CenterPane } from "@/components/dashboard/center-pane"
import { RightSidebar, RightSidebarRef } from "@/components/dashboard/right-sidebar"
import { Header } from "@/components/layout/header"
import { Database, Task, Project, Space } from "@/types/database"
import { useMindMapSync } from "@/hooks/useMindMapSync"
import { TimerProvider } from "@/contexts/TimerContext"
import { DragProvider } from "@/contexts/DragContext"
import { CalendarToast } from "@/components/calendar/calendar-toast"
import { ChevronLeft, ChevronRight, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useView } from "@/contexts/ViewContext"
import { TodayView } from "@/components/today/today-view"
import { HabitsView } from "@/components/habits/habits-view"
import { getTodayDateString } from "@/hooks/useHabits"
import { OutlineView } from "@/components/mobile/outline-view"
import { MemoView } from "@/components/memo/memo-view"
import { AiChatPanel } from "@/components/ai/ai-chat-panel"

interface DashboardClientProps {
    initialSpaces: Space[]
    initialProjects: Project[]
    initialTasks: Task[]
    userId: string
}

export function DashboardClient({
    initialSpaces,
    initialProjects,
    initialTasks,
    userId
}: DashboardClientProps) {
    // State
    const [spaces, setSpaces] = useState<Space[]>(initialSpaces)
    const [projects, setProjects] = useState<Project[]>(initialProjects)

    // Selection State — null means "全体" (all spaces)
    // Use consistent defaults for SSR/client to avoid hydration mismatch (#418)
    const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
        initialSpaces.length > 0 ? initialSpaces[0].id : null
    )
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        initialProjects.length > 0 ? initialProjects[0].id : null
    )

    // Restore from localStorage after mount (client-only)
    const selectionRestoredRef = useRef(false)
    useEffect(() => {
        const savedSpace = localStorage.getItem('shikumika:lastSpaceId')
        if (savedSpace && initialSpaces.some(s => s.id === savedSpace)) {
            setSelectedSpaceId(savedSpace)
        }
        const savedProject = localStorage.getItem('shikumika:lastProjectId')
        if (savedProject && initialProjects.some(p => p.id === savedProject)) {
            setSelectedProjectId(savedProject)
        }
        selectionRestoredRef.current = true
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Persist selection to localStorage (only after restore to avoid overwriting saved values)
    useEffect(() => {
        if (!selectionRestoredRef.current) return
        if (selectedSpaceId) localStorage.setItem('shikumika:lastSpaceId', selectedSpaceId)
        else localStorage.removeItem('shikumika:lastSpaceId')
    }, [selectedSpaceId])
    useEffect(() => {
        if (!selectionRestoredRef.current) return
        if (selectedProjectId) localStorage.setItem('shikumika:lastProjectId', selectedProjectId)
        else localStorage.removeItem('shikumika:lastProjectId')
    }, [selectedProjectId])

    // STABLE reference for filtered projects using useMemo
    const filteredProjects = useMemo(() =>
        selectedSpaceId === null
            ? projects  // "全体" shows all projects
            : projects.filter(p => p.space_id === selectedSpaceId),
        [projects, selectedSpaceId]
    )

    // Auto-select first project when space changes (NOTE: deps are primitives only)
    useEffect(() => {
        const projectsInSpace = selectedSpaceId === null
            ? projects
            : projects.filter(p => p.space_id === selectedSpaceId)
        if (projectsInSpace.length > 0 && !projectsInSpace.find(p => p.id === selectedProjectId)) {
            setSelectedProjectId(projectsInSpace[0].id)
        } else if (projectsInSpace.length === 0) {
            setSelectedProjectId(null)
        }
    }, [selectedSpaceId]) // ONLY depends on selectedSpaceId, not objects

    const selectedProject = useMemo(() =>
        projects.find(p => p.id === selectedProjectId),
        [projects, selectedProjectId]
    )

    // --- View State ---
    // isViewReady = localStorage からビュー復元完了（SSRフラッシュ防止）
    const { activeView, isViewReady } = useView()

    // --- MindMap Sync Hook ---
    // STABLE reference for initial groups (root tasks) using useMemo
    const projectRootTasksInitial = useMemo(() => {
        // ルートタスク = parent_task_id === null のタスク
        return initialTasks.filter(t =>
            t.parent_task_id === null &&
            t.project_id === selectedProjectId
        )
    }, [initialTasks, selectedProjectId])

    // STABLE reference for initial child tasks - useMemo
    // 選択プロジェクトに属する子タスク（parent_task_id !== null）
    const projectTasksInitial = useMemo(() => {
        // ルートタスクIDを取得
        const rootTaskIds = new Set(projectRootTasksInitial.map(t => t.id))
        // BFS: ルートタスクの全子孫タスクを取得
        const result: Task[] = []
        const taskIds = new Set<string>()
        const queue = [...rootTaskIds]
        while (queue.length > 0) {
            const parentId = queue.shift()!
            for (const t of initialTasks) {
                if (taskIds.has(t.id)) continue
                // is_group=true のタスクはルートタスクとして処理済み → スキップ
                if (t.is_group === true) continue
                if (t.parent_task_id === parentId) {
                    result.push(t)
                    taskIds.add(t.id)
                    queue.push(t.id) // 子タスクの子も探索
                }
            }
        }
        return result
    }, [initialTasks, projectRootTasksInitial])

    const {
        groups: currentGroups,
        tasks: currentTasks,
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
        refreshFromServer,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useMindMapSync({
        projectId: selectedProjectId,
        userId,
        initialRootTasks: projectRootTasksInitial,
        initialTasks: projectTasksInitial,
        onSyncError: useCallback((message: string) => {
            setSyncErrorToast({ type: 'error', message })
        }, []),
    })

    // ビュー切り替え時にマインドマップのタスクを再取得
    useEffect(() => {
        if (activeView === 'map') {
            refreshFromServer()
        }
    }, [activeView, refreshFromServer])

    // STABLE handlers using useCallback
    const handleCreateGroup = useCallback(async (title: string) => {
        return await createGroup(title)
    }, [createGroup])

    const handleUpdateProjectTitle = useCallback(async (projectId: string, newTitle: string) => {
        // Optimistic update local state
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, title: newTitle } : p))

        // Persist to DB
        if (updateProjectTitle) {
            await updateProjectTitle(projectId, newTitle)
        }
    }, [updateProjectTitle])

    const handleDeleteGroup = useCallback(async (groupId: string) => {
        await deleteGroup(groupId)
    }, [deleteGroup])

    const handleDeleteTask = useCallback(async (taskId: string) => {
        await deleteTask(taskId)
        // Refresh calendar to reflect the deletion
        await rightSidebarRef.current?.refreshCalendar()
    }, [deleteTask])

    // --- Project CRUD ---
    const handleCreateProject = useCallback(async (title: string, status: string = 'active', targetSpaceId?: string) => {
        const spaceId = targetSpaceId || selectedSpaceId || (spaces.length > 0 ? spaces[0].id : null)
        if (!spaceId) return null

        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ space_id: spaceId, title, status }),
        })
        if (!res.ok) return null
        const newProject: Project = await res.json()
        setProjects(prev => [newProject, ...prev])
        setSelectedProjectId(newProject.id)
        return newProject
    }, [selectedSpaceId, spaces])

    const handleUpdateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
        // Optimistic update
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...updates } : p))
        await fetch(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
    }, [])

    const handleDeleteProject = useCallback(async (projectId: string) => {
        // Optimistic update
        setProjects(prev => prev.filter(p => p.id !== projectId))
        if (selectedProjectId === projectId) {
            const remaining = projects.filter(p => p.id !== projectId)
            setSelectedProjectId(remaining.length > 0 ? remaining[0].id : null)
        }
        await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    }, [selectedProjectId, projects])

    // --- Space CRUD ---
    const handleCreateSpace = useCallback(async (title: string) => {
        const res = await fetch('/api/spaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        })
        if (!res.ok) return null
        const newSpace: Space = await res.json()
        setSpaces(prev => [newSpace, ...prev])
        setSelectedSpaceId(newSpace.id)
        return newSpace
    }, [])

    const handleUpdateSpace = useCallback(async (spaceId: string, updates: Partial<Space>) => {
        setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, ...updates } : s))
        await fetch(`/api/spaces/${spaceId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
    }, [])

    const handleDeleteSpace = useCallback(async (spaceId: string) => {
        setSpaces(prev => prev.filter(s => s.id !== spaceId))
        setProjects(prev => prev.filter(p => p.space_id !== spaceId))
        if (selectedSpaceId === spaceId) {
            setSelectedSpaceId(null)
        }
        await fetch(`/api/spaces/${spaceId}`, { method: 'DELETE' })
    }, [selectedSpaceId])

    // --- Quick Task Creation (for TodayView FAB) ---
    const [quickTasks, setQuickTasks] = useState<Task[]>([])
    const [quickTaskToast, setQuickTaskToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
    // タスク更新のローカルオーバーライド（タイマー等の変更を即座に反映）
    const [taskOverrides, setTaskOverrides] = useState<Record<string, Partial<Task>>>({})

    // Debounced calendar refresh (2s after last call) + optimistic event add
    const calendarRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const handleCalendarEventCreated = useCallback((eventData?: {
        id: string; title: string; scheduled_at: string; estimated_time: number; calendar_id?: string | null
    }) => {
        // 楽観的にカレンダーへ即座追加
        if (eventData) {
            const startTime = new Date(eventData.scheduled_at)
            const endTime = new Date(startTime.getTime() + eventData.estimated_time * 60 * 1000)
            rightSidebarRef.current?.addOptimisticEvent({
                id: `optimistic-${eventData.id}`,
                user_id: '',
                google_event_id: '',
                calendar_id: eventData.calendar_id || '',
                title: eventData.title,
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                is_all_day: false,
                timezone: 'Asia/Tokyo',
                synced_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                task_id: eventData.id,
                estimated_time: eventData.estimated_time,
            })
        }
        // デバウンスリフレッシュで実データに置換
        if (calendarRefreshTimerRef.current) clearTimeout(calendarRefreshTimerRef.current)
        calendarRefreshTimerRef.current = setTimeout(async () => {
            await rightSidebarRef.current?.refreshCalendar()
            calendarRefreshTimerRef.current = null
        }, 2000)
    }, [])

    useEffect(() => {
        return () => { if (calendarRefreshTimerRef.current) clearTimeout(calendarRefreshTimerRef.current) }
    }, [])

    const handleCreateQuickTask = useCallback(async (taskData: {
        title: string
        project_id: string | null
        scheduled_at: string | null
        estimated_time: number
        reminders: number[]
        calendar_id: string | null
        priority: number
    }) => {
        const optimisticId = crypto.randomUUID()
        const optimisticTask: Task = {
            id: optimisticId,
            user_id: userId,
            project_id: taskData.project_id,
            parent_task_id: null,
            is_group: false,
            title: taskData.title,
            status: 'todo',
            stage: taskData.scheduled_at ? 'scheduled' : 'plan',
            priority: taskData.priority,
            order_index: 0,
            scheduled_at: taskData.scheduled_at,
            estimated_time: taskData.estimated_time,
            actual_time_minutes: 0,
            google_event_id: null,
            calendar_event_id: null,
            calendar_id: taskData.calendar_id,
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source: 'manual',
            deleted_at: null,
            google_event_fingerprint: null,
            is_habit: false,
            habit_frequency: null,
            habit_icon: null,
            habit_start_date: null,
            habit_end_date: null,
            memo: null,
        }

        // カレンダー選択ありの場合のみ今日ビューに即表示
        const showOnTimeline = !!taskData.calendar_id
        if (showOnTimeline) {
            setQuickTasks(prev => [...prev, optimisticTask])
        }

        // バックグラウンドで API 保存 + カレンダー同期（await しない）
        ;(async () => {
            try {
                const res = await fetch('/api/tasks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: optimisticId,
                        project_id: taskData.project_id,
                        parent_task_id: null,
                        title: taskData.title,
                        scheduled_at: taskData.scheduled_at,
                        estimated_time: taskData.estimated_time,
                        calendar_id: taskData.calendar_id,
                        priority: taskData.priority,
                    }),
                })

                if (!res.ok) {
                    if (showOnTimeline) setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
                    setQuickTaskToast({ type: 'error', message: 'タスクの作成に失敗しました' })
                    return
                }

                // ブラウザ通知（task_start）を作成時に即登録
                if (taskData.scheduled_at && taskData.reminders.length > 0) {
                    const advanceMinutes = taskData.reminders[0]
                    const reminderAt = new Date(new Date(taskData.scheduled_at).getTime() - advanceMinutes * 60000)
                    fetch('/api/notifications/schedule', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            targetType: 'task',
                            targetId: optimisticId,
                            notificationType: 'task_start',
                            scheduledAt: reminderAt.toISOString(),
                            title: `リマインダー: ${taskData.title}`,
                            body: advanceMinutes === 0 ? '開始時刻です' : `${advanceMinutes}分後に開始します`,
                        }),
                    }).catch((err) => {
                        console.warn('[QuickTask] Failed to schedule notification:', err)
                    })
                }

                // Google Calendar 同期
                if (taskData.scheduled_at && taskData.estimated_time > 0 && taskData.calendar_id) {
                    const syncRes = await fetch('/api/calendar/sync-task', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            taskId: optimisticId,
                            scheduled_at: taskData.scheduled_at,
                            estimated_time: taskData.estimated_time,
                            calendar_id: taskData.calendar_id,
                            reminders: taskData.reminders,
                        }),
                    })
                    if (syncRes.ok) {
                        const syncData = await syncRes.json()
                        if (syncData.googleEventId) {
                            setQuickTasks(prev => prev.map(t =>
                                t.id === optimisticId
                                    ? { ...t, google_event_id: syncData.googleEventId }
                                    : t
                            ))
                            handleCalendarEventCreated()
                        }
                        setQuickTaskToast({ type: 'success', message: `Googleカレンダーに登録しました` })
                    } else {
                        setQuickTaskToast({ type: 'info', message: 'タスクは保存しましたが、カレンダー同期に失敗しました' })
                    }
                } else {
                    setQuickTaskToast({ type: 'success', message: `「${taskData.title}」を保存しました` })
                }
            } catch (err) {
                console.error('[QuickTask] Background save failed:', err)
                if (showOnTimeline) setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
                setQuickTaskToast({ type: 'error', message: 'タスクの作成に失敗しました' })
            }
        })()
    }, [userId, handleCalendarEventCreated])

    // タスク更新ラッパー：DB保存 + ローカルstate即時反映（タイマー・編集等）
    const handleUpdateTaskWithQuickSync = useCallback(async (taskId: string, updates: Partial<Task>) => {
        // ローカルオーバーライドを即座に適用（UI即時反映）
        setTaskOverrides(prev => ({
            ...prev,
            [taskId]: { ...(prev[taskId] || {}), ...updates }
        }))
        // quickTasks にもあれば同期
        setQuickTasks(prev => {
            if (!prev.some(t => t.id === taskId)) return prev
            return prev.map(t => t.id === taskId ? { ...t, ...updates } : t)
        })
        // DB保存
        await updateTask(taskId, updates)
    }, [updateTask])

    // Merge all tasks: current project (latest state) + other projects (initial state) + overrides + quick tasks
    const allTasksMerged = useMemo(() => {
        const currentMap = new Map(currentTasks.map(t => [t.id, t]))
        const merged = initialTasks.map(t => {
            const base = currentMap.get(t.id) || t
            const override = taskOverrides[base.id]
            return override ? { ...base, ...override } as Task : base
        })
        const existingIds = new Set(merged.map(t => t.id))
        // Add new tasks from mind map (created during session, not in initialTasks)
        for (const ct of currentTasks) {
            if (!existingIds.has(ct.id)) {
                const override = taskOverrides[ct.id]
                merged.push(override ? { ...ct, ...override } as Task : ct)
                existingIds.add(ct.id)
            }
        }
        // Add groups from mind map (for completeness)
        for (const cg of currentGroups) {
            if (!existingIds.has(cg.id)) {
                merged.push(cg)
                existingIds.add(cg.id)
            }
        }
        // Add quick tasks that aren't already in the list
        for (const qt of quickTasks) {
            if (!existingIds.has(qt.id)) merged.push(qt)
        }
        return merged
    }, [initialTasks, currentTasks, currentGroups, quickTasks, taskOverrides])

    // Save daily timer for habit child tasks
    const handleTimerSessionEnd = useCallback((taskId: string, sessionSeconds: number) => {
        const task = allTasksMerged.find(t => t.id === taskId)
        if (!task?.parent_task_id) return

        const parentTask = allTasksMerged.find(t => t.id === task.parent_task_id)
        if (!parentTask?.is_habit) return

        const todayStr = getTodayDateString()
        fetch('/api/habits/task-completions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                habit_id: parentTask.id,
                task_id: taskId,
                completed_date: todayStr,
                add_seconds: sessionSeconds,
            }),
        }).catch(err => {
            console.error('[DashboardClient] Failed to save daily timer:', err)
        })
    }, [allTasksMerged])

    // サブタスク作成（今日のビュー用）— quickTasks に追加して allTasksMerged に反映
    // ※ allTasksMerged の後に定義しないと TDZ エラーになる
    const handleCreateSubTask = useCallback(async (parentTaskId: string, title: string) => {
        const parentTask = allTasksMerged.find(t => t.id === parentTaskId)
        const optimisticId = crypto.randomUUID()
        const optimisticTask: Task = {
            id: optimisticId,
            user_id: userId,
            project_id: parentTask?.project_id ?? null,
            parent_task_id: parentTaskId,
            is_group: false,
            title,
            status: 'todo',
            stage: 'plan',
            priority: null,
            order_index: 0,
            scheduled_at: null,
            estimated_time: 0,
            actual_time_minutes: 0,
            google_event_id: null,
            calendar_event_id: null,
            calendar_id: null,
            total_elapsed_seconds: 0,
            last_started_at: null,
            is_timer_running: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source: 'manual',
            deleted_at: null,
            google_event_fingerprint: null,
            is_habit: false,
            habit_frequency: null,
            habit_icon: null,
            habit_start_date: null,
            habit_end_date: null,
            memo: null,
        }

        // quickTasks に追加 → allTasksMerged に反映 → TodayView の allTasks prop に伝播
        setQuickTasks(prev => [...prev, optimisticTask])

        try {
            const res = await fetch('/api/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: optimisticId,
                    parent_task_id: parentTaskId,
                    project_id: parentTask?.project_id ?? null,
                    title,
                }),
            })
            if (!res.ok) {
                console.error('[SubTask] Create failed:', await res.text())
                setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
            }
        } catch (err) {
            console.error('[SubTask] Create error:', err)
            setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
        }
    }, [allTasksMerged, userId])

    // タスク削除（今日のビュー用）— quickTasks + taskOverrides からも削除
    const handleDeleteTaskFromToday = useCallback(async (taskId: string) => {
        setQuickTasks(prev => prev.filter(t => t.id !== taskId))
        setTaskOverrides(prev => {
            const next = { ...prev }
            delete next[taskId]
            return next
        })

        try {
            await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
        } catch (err) {
            console.error('[Dashboard] Failed to delete task:', err)
        }
    }, [])

    // --- Sync Error Toast ---
    const [syncErrorToast, setSyncErrorToast] = useState<{ type: 'error'; message: string } | null>(null)

    // --- Undo/Redo Keyboard Listener ---
    const [undoToast, setUndoToast] = useState<{ type: 'success' | 'info'; message: string } | null>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault()
                if (e.shiftKey) {
                    // Cmd+Shift+Z = Redo
                    redo().then(desc => {
                        if (desc) setUndoToast({ type: 'info', message: `やり直し: ${desc}` })
                    })
                } else {
                    // Cmd+Z = Undo
                    undo().then(desc => {
                        if (desc) setUndoToast({ type: 'success', message: `元に戻す: ${desc}` })
                    })
                }
            }
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [undo, redo])

    // Sidebar State
    const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(320)
    const isDraggingRightRef = useRef(false)
    const dragStartXRef = useRef(0)
    const dragStartWidthRightRef = useRef(0)

    // RightSidebar ref for calendar refresh
    const rightSidebarRef = useRef<RightSidebarRef>(null)

    // Calendar refresh handler
    const handleRefreshCalendar = useCallback(async () => {
        await rightSidebarRef.current?.refreshCalendar()
    }, [])

    // Optimistic calendar event handlers (PC: mind-map → right-sidebar)
    const handleAddOptimisticEvent = useCallback((event: import('@/types/calendar').CalendarEvent) => {
        rightSidebarRef.current?.addOptimisticEvent(event)
    }, [])
    const handleRemoveOptimisticEvent = useCallback((eventId: string) => {
        rightSidebarRef.current?.removeOptimisticEvent(eventId)
    }, [])

    // Toggle left sidebar
    const toggleLeftSidebar = useCallback(() => {
        setIsLeftSidebarCollapsed(prev => !prev)
    }, [])

    // Handle right sidebar resize
    const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRightRef.current = true
        dragStartXRef.current = e.clientX
        dragStartWidthRightRef.current = rightSidebarWidth
        e.preventDefault()
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
    }, [rightSidebarWidth])

    // Touch event handler for right sidebar
    const handleRightTouchStart = useCallback((e: React.TouchEvent) => {
        isDraggingRightRef.current = true
        dragStartXRef.current = e.touches[0].clientX
        dragStartWidthRightRef.current = rightSidebarWidth
        e.preventDefault()
    }, [rightSidebarWidth])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingRightRef.current) {
                const delta = dragStartXRef.current - e.clientX
                const newWidth = Math.max(200, Math.min(600, dragStartWidthRightRef.current + delta))
                setRightSidebarWidth(newWidth)
            }
        }

        const handleTouchMove = (e: TouchEvent) => {
            if (isDraggingRightRef.current) {
                const delta = dragStartXRef.current - e.touches[0].clientX
                const newWidth = Math.max(200, Math.min(600, dragStartWidthRightRef.current + delta))
                setRightSidebarWidth(newWidth)
            }
        }

        const handleMouseUp = () => {
            isDraggingRightRef.current = false
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        document.addEventListener('touchmove', handleTouchMove, { passive: false })
        document.addEventListener('touchend', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.removeEventListener('touchmove', handleTouchMove)
            document.removeEventListener('touchend', handleMouseUp)
        }
    }, [])

    return (
        <DragProvider>
            <TimerProvider tasks={allTasksMerged} onUpdateTask={handleUpdateTaskWithQuickSync} onTimerSessionEnd={handleTimerSessionEnd}>
                {/* Header with Space Switcher */}
                <Header
                    spaces={spaces}
                    selectedSpaceId={selectedSpaceId}
                    onSelectSpace={setSelectedSpaceId}
                    onCreateSpace={handleCreateSpace}
                    onUpdateSpace={handleUpdateSpace}
                    onDeleteSpace={handleDeleteSpace}
                />

                {/* Undo/Redo Toast */}
                {undoToast && (
                    <CalendarToast
                        type={undoToast.type}
                        message={undoToast.message}
                        duration={2000}
                        onClose={() => setUndoToast(null)}
                    />
                )}
                {/* Sync Error Toast */}
                {syncErrorToast && (
                    <CalendarToast
                        type={syncErrorToast.type}
                        message={syncErrorToast.message}
                        duration={4000}
                        onClose={() => setSyncErrorToast(null)}
                    />
                )}
                {/* Quick Task Toast */}
                {quickTaskToast && (
                    <CalendarToast
                        type={quickTaskToast.type}
                        message={quickTaskToast.message}
                        duration={3000}
                        onClose={() => setQuickTaskToast(null)}
                    />
                )}
                {/* === Mobile Views (wait for mount to avoid SSR hydration flash) === */}
                {isViewReady && activeView === 'today' && (
                    <div className="flex-1 min-h-0 flex flex-col md:hidden overflow-hidden">
                        <TodayView
                            allTasks={allTasksMerged}
                            onUpdateTask={handleUpdateTaskWithQuickSync}
                            projects={projects}
                            onCreateQuickTask={handleCreateQuickTask}
                            onCreateSubTask={handleCreateSubTask}
                            onDeleteTask={handleDeleteTaskFromToday}
                        />
                    </div>
                )}

                {isViewReady && activeView === 'habits' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <HabitsView onUpdateTask={updateTask} />
                    </div>
                )}

                {isViewReady && activeView === 'map' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <OutlineView
                            project={selectedProject}
                            groups={currentGroups}
                            tasks={currentTasks}
                            spaces={spaces}
                            projects={filteredProjects}
                            selectedProjectId={selectedProjectId}
                            selectedSpaceId={selectedSpaceId}
                            onSelectProject={setSelectedProjectId}
                            onSelectSpace={setSelectedSpaceId}
                            onCreateGroup={handleCreateGroup}
                            onCreateTask={createTask}
                            onUpdateTask={updateTask}
                            onDeleteTask={handleDeleteTask}
                            onDeleteGroup={handleDeleteGroup}
                            onMoveTask={moveTask}
                            onReorderTask={reorderTask}
                            onUpdateGroupTitle={updateGroupTitle}
                            onUpdateGroup={updateGroup}
                            onUpdateProject={handleUpdateProjectTitle}
                            onCreateProject={handleCreateProject}
                        />
                    </div>
                )}

                {isViewReady && activeView === 'memo' && (
                    <div className="flex-1 overflow-hidden md:flex md:justify-center">
                        <div className="w-full max-w-2xl h-full">
                            <MemoView
                                projects={filteredProjects}
                                spaces={spaces}
                                selectedSpaceId={selectedSpaceId}
                                onSelectSpace={setSelectedSpaceId}
                            />
                        </div>
                    </div>
                )}

                {/* === Desktop: Always 3-pane === */}
                <div className={cn(
                    "flex-1 w-full relative gap-0 overflow-hidden",
                    "hidden md:flex",
                    activeView === 'map' ? "md:flex" : ""
                )}>
                {/* Toggle Button (Always visible on left top) */}
                <div className={cn(
                    "absolute top-4 z-50 hidden md:flex transition-all duration-300 ease-in-out",
                    isLeftSidebarCollapsed ? "left-4" : "left-[220px]"
                )}>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleLeftSidebar}
                        className="h-8 w-8 rounded-full bg-background border shadow-sm hover:bg-muted"
                    >
                        {isLeftSidebarCollapsed ? (
                            <ChevronRight className="h-4 w-4" />
                        ) : (
                            <ChevronLeft className="h-4 w-4" />
                        )}
                    </Button>
                </div>

                {/* Pane 1: Left Sidebar */}
                <div
                    className={cn(
                        "hidden md:flex flex-none overflow-hidden h-full transition-all duration-300 ease-in-out",
                        isLeftSidebarCollapsed ? "w-0 opacity-0" : "w-52 opacity-100"
                    )}
                    style={isLeftSidebarCollapsed ? {} : { minWidth: '13rem' }}
                >
                    <LeftSidebar
                        spaces={spaces}
                        selectedSpaceId={selectedSpaceId}
                        projects={filteredProjects}
                        selectedProjectId={selectedProjectId}
                        onSelectProject={setSelectedProjectId}
                        onCreateProject={handleCreateProject}
                        onUpdateProject={handleUpdateProject}
                        onDeleteProject={handleDeleteProject}
                    />
                </div>

                {/* Pane 2: Center (MindMap + Lists / Habits) */}
                <div className="flex-1 min-w-0 overflow-hidden h-full w-full" style={{ minWidth: 0 }}>
                    {activeView === 'habits' ? (
                        <HabitsView onUpdateTask={updateTask} />
                    ) : (
                        <CenterPane
                            project={selectedProject}
                            groups={currentGroups}
                            tasks={currentTasks}
                            onUpdateProject={handleUpdateProjectTitle}
                            onCreateGroup={handleCreateGroup}
                            onDeleteGroup={handleDeleteGroup}
                            onCreateTask={createTask}
                            onUpdateTask={updateTask}
                            onDeleteTask={handleDeleteTask}
                            onBulkDelete={bulkDelete}
                            onReorderTask={reorderTask}
                            onReorderGroup={reorderGroup}
                            onRefreshCalendar={handleRefreshCalendar}
                            onAddOptimisticEvent={handleAddOptimisticEvent}
                            onRemoveOptimisticEvent={handleRemoveOptimisticEvent}
                        />
                    )}
                </div>

                {/* Right Resize Handle */}
                <div
                    className="w-1 h-full bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-none flex items-center justify-center group"
                    onMouseDown={handleRightMouseDown}
                    onTouchStart={handleRightTouchStart}
                >
                    <div className="w-0.5 h-8 bg-muted-foreground/20 group-hover:bg-primary rounded-full" />
                </div>

                {/* Pane 3: Right Sidebar (Calendar) */}
                <div
                    className="flex-none overflow-hidden h-full"
                    style={{ width: rightSidebarWidth }}
                >
                    <RightSidebar ref={rightSidebarRef} onUpdateTask={updateTask} tasks={allTasksMerged} />
                </div>
            </div>
            {/* AI Chat Floating Panel */}
            <AiChatPanel hideFab={activeView === 'today'} onCalendarEventCreated={handleCalendarEventCreated} />
            </TimerProvider>
        </DragProvider>
    )
}
