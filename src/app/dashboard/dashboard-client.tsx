"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { LeftSidebar } from "@/components/dashboard/left-sidebar"
import { RightSidebar, RightSidebarRef } from "@/components/dashboard/right-sidebar"
import { Header } from "@/components/layout/header"
import { Database, Task, Project, Space } from "@/types/database"
import { useMindMapSync } from "@/hooks/useMindMapSync"
import { UNDOABLE_ACTION_EVENT, useUndoRedo } from "@/hooks/useUndoRedo"
import { TimerProvider } from "@/contexts/TimerContext"
import { DragProvider } from "@/contexts/DragContext"
import { CalendarToast } from "@/components/calendar/calendar-toast"
import { CalendarConnectedToast } from "@/components/dashboard/calendar-connected-toast"
import {
    broadcastCalendarOptimisticEvent,
    broadcastCalendarOptimisticEventRemoval,
} from "@/hooks/useCalendarEvents"
import { ChevronLeft, ChevronRight, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useView } from "@/contexts/ViewContext"
import { getTodayDateString } from "@/hooks/useHabits"
import { TodayDateProvider } from "@/contexts/TodayDateContext"
import { dedupeGoogleEventTasks } from "@/lib/google-event-task-dedupe"
import { preloadDashboardPanels, preloadDashboardView } from "@/lib/dashboard-preload"
import { fetchWishlistItems } from "@/lib/wishlist-cache"
import { useIsNarrowViewport } from "@/hooks/useIsNarrowViewport"
import { useForceDesktopDashboard } from "@/hooks/useForceDesktopDashboard"
import { MindmapLinkedMemosDialog } from "@/components/mindmap/mindmap-linked-memos-dialog"
import { ProjectContextDialog } from "@/components/projects/project-context-dialog"

function DashboardPaneFallback() {
    return (
        <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
            <div className="h-9 w-40 animate-pulse rounded-md bg-muted/70" />
            <div className="grid flex-1 min-h-0 gap-3">
                <div className="rounded-md border bg-muted/30" />
                <div className="rounded-md border bg-muted/20" />
            </div>
        </div>
    )
}

const CenterPane = dynamic(
    () => import("@/components/dashboard/center-pane").then(mod => ({ default: mod.CenterPane })),
    { loading: DashboardPaneFallback, ssr: false },
)
const TodayView = dynamic(
    () => import("@/components/today/today-view").then(mod => ({ default: mod.TodayView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const HabitsView = dynamic(
    () => import("@/components/habits/habits-view").then(mod => ({ default: mod.HabitsView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const MobileAiMapView = dynamic(
    () => import("@/components/ai/mobile-ai-map-view").then(mod => ({ default: mod.MobileAiMapView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const MobileAiExecutionView = dynamic(
    () => import("@/components/ai/mobile-ai-execution-view").then(mod => ({ default: mod.MobileAiExecutionView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const AiView = dynamic(
    () => import("@/components/ai/ai-view").then(mod => ({ default: mod.AiView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const AutoChatView = dynamic(
    () => import("@/components/chat/auto-chat-view").then(mod => ({ default: mod.AutoChatView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const IdealView = dynamic(
    () => import("@/components/ideal/ideal-view").then(mod => ({ default: mod.IdealView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const WishlistView = dynamic(
    () => import("@/components/wishlist/wishlist-view").then(mod => ({ default: mod.WishlistView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const AiTodosView = dynamic(
    () => import("@/components/ai-todos/ai-todos-view").then(mod => ({ default: mod.AiTodosView })),
    { loading: DashboardPaneFallback, ssr: false },
)
const TodayTaskBoard = dynamic(
    () => import("@/components/today/today-task-board").then(mod => ({ default: mod.TodayTaskBoard })),
    { loading: DashboardPaneFallback, ssr: false },
)
const AiExecutionTimeline = dynamic(
    () => import("@/components/today/ai-execution-timeline").then(mod => ({ default: mod.AiExecutionTimeline })),
    { loading: DashboardPaneFallback, ssr: false },
)
const SettingsOverview = dynamic(
    () => import("@/components/settings/settings-overview").then(mod => ({ default: mod.SettingsOverview })),
    { loading: DashboardPaneFallback, ssr: false },
)
const TodayMemoBoard = dynamic(
    () => import("@/components/dashboard/today-memo-board").then(mod => ({ default: mod.TodayMemoBoard })),
    { loading: DashboardPaneFallback, ssr: false },
)
const AiChatPanel = dynamic(
    () => import("@/components/ai/ai-chat-panel").then(mod => ({ default: mod.AiChatPanel })),
    { ssr: false },
)
const SchedulingPanel = dynamic(
    () => import("@/components/ai/scheduling-panel").then(mod => ({ default: mod.SchedulingPanel })),
    { ssr: false },
)

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
    const [contextDialogProject, setContextDialogProject] = useState<Project | null>(null)

    // Selection State — null means "全体" (all spaces)
    // Use consistent defaults for SSR/client to avoid hydration mismatch (#418)
    const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(() => {
        if (typeof window !== "undefined") {
            try {
                const savedProject = window.localStorage.getItem('focusmap:lastProjectId')
                if (savedProject && initialProjects.some(p => p.id === savedProject)) {
                    return savedProject
                }
            } catch {
                // localStorage が使えない環境では通常の初期値へフォールバック
            }
        }
        return initialProjects.length > 0 ? initialProjects[0].id : null
    })

    // Restore from localStorage after mount (client-only)
    const selectionRestoredRef = useRef(false)
    useEffect(() => {
        queueMicrotask(() => {
            const savedProject = localStorage.getItem('focusmap:lastProjectId')
            if (savedProject && initialProjects.some(p => p.id === savedProject)) {
                setSelectedProjectId(savedProject)
            }
            selectionRestoredRef.current = true
        })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Persist selection to localStorage (only after restore to avoid overwriting saved values)
    useEffect(() => {
        if (!selectionRestoredRef.current) return
        if (selectedProjectId) localStorage.setItem('focusmap:lastProjectId', selectedProjectId)
        else localStorage.removeItem('focusmap:lastProjectId')
    }, [selectedProjectId])

    // --- View State ---
    // isViewReady = localStorage からビュー復元完了（SSRフラッシュ防止）
    const { activeView, setActiveView, isViewReady } = useView()
    const isNarrowViewport = useIsNarrowViewport()
    const forceDesktopDashboard = useForceDesktopDashboard()
    const isMobileViewport = isNarrowViewport && !forceDesktopDashboard
    const desktopFlexClass = forceDesktopDashboard ? "flex" : "hidden md:flex"
    const desktopDashboardWidthClass = forceDesktopDashboard ? "min-w-[1120px]" : ""

    useEffect(() => {
        if (!isViewReady || typeof window === "undefined") return

        preloadDashboardView(activeView)

        if (activeView === "settings") return

        const warmup = () => {
            preloadDashboardPanels()
            preloadDashboardView("today")
            preloadDashboardView("long-term")
            preloadDashboardView("ai")
            preloadDashboardView("map")
            void fetchWishlistItems({ spaceId: selectedSpaceId, projectId: selectedProjectId }).catch(() => undefined)
        }

        if ("requestIdleCallback" in window && "cancelIdleCallback" in window) {
            const handle = window.requestIdleCallback(warmup, { timeout: 3500 })
            return () => window.cancelIdleCallback(handle)
        }

        const handle = setTimeout(warmup, 1200)
        return () => clearTimeout(handle)
    }, [activeView, isViewReady, selectedProjectId, selectedSpaceId])

    // Auto-select first project when space changes (NOTE: deps are primitives only)
    const allowsAllProjects = activeView === 'today' || activeView === 'long-term'

    useEffect(() => {
        queueMicrotask(() => {
            if (allowsAllProjects && selectedProjectId === null) return
            const projectsInSpace = selectedSpaceId === null
                ? projects
                : projects.filter(p => p.space_id === selectedSpaceId)
            if (projectsInSpace.length > 0 && !projectsInSpace.find(p => p.id === selectedProjectId)) {
                setSelectedProjectId(projectsInSpace[0].id)
            } else if (projectsInSpace.length === 0) {
                setSelectedProjectId(null)
            }
        })
    }, [allowsAllProjects, projects, selectedProjectId, selectedSpaceId])

    const selectedProject = useMemo(() =>
        projects.find(p => p.id === selectedProjectId),
        [projects, selectedProjectId]
    )

    // AI Chat open state (controlled from desktop panel FAB + mobile BottomNav)
    const [isAiChatOpen, setIsAiChatOpen] = useState(false)
    // Scheduling panel open state
    const [isSchedulingOpen, setIsSchedulingOpen] = useState(false)

    // Today タブのサブビュー: 'memo' = 今日するメモ + D&D / 'timeline' = 従来のタスクボード / 'ai' = AI実行
    const [todaySubView, setTodaySubView] = useState<'memo' | 'timeline' | 'ai'>('memo')
    const [todaySelectedDate, setTodaySelectedDate] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const [todayMemoScheduleFocus, setTodayMemoScheduleFocus] = useState<{
        memoId: string
        requestKey: number
    } | null>(null)
    const todayMemoScheduleRequestRef = useRef(0)
    useEffect(() => {
        const saved = typeof window !== "undefined" ? window.localStorage.getItem('focusmap:today-sub-view') : null
        if (saved === 'memo' || saved === 'timeline' || saved === 'ai') {
            queueMicrotask(() => setTodaySubView(saved))
        }
    }, [])
    const updateTodaySubView = useCallback((v: 'memo' | 'timeline' | 'ai') => {
        setTodaySubView(v)
        if (typeof window !== "undefined") window.localStorage.setItem('focusmap:today-sub-view', v)
    }, [])
    const openTodayMemoSchedule = useCallback((payload: { memoId: string; date: Date }) => {
        const normalizedDate = new Date(payload.date)
        normalizedDate.setHours(0, 0, 0, 0)
        todayMemoScheduleRequestRef.current += 1
        setTodaySelectedDate(normalizedDate)
        setTodayMemoScheduleFocus({
            memoId: payload.memoId,
            requestKey: todayMemoScheduleRequestRef.current,
        })
        updateTodaySubView('memo')
        setActiveView('today')
    }, [setActiveView, updateTodaySubView])
    const openTodayBoard = useCallback(() => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        setTodaySelectedDate(today)
        setTodayMemoScheduleFocus(null)
        updateTodaySubView('memo')
        setActiveView('today')
    }, [setActiveView, updateTodaySubView])
    const [isCalendarSplitOpen, setIsCalendarSplitOpen] = useState(false)
    const [isMemoSplitOpen, setIsMemoSplitOpen] = useState(false)
    const [isMapSplitOpen, setIsMapSplitOpen] = useState(false)
    const [mindmapLinkedMemoTarget, setMindmapLinkedMemoTarget] = useState<{ taskId: string; requestKey: number } | null>(null)
    const isOptionalCalendarView = activeView === 'map' || activeView === 'long-term'
    const isCalendarPanelVisible = activeView === 'today' || (isOptionalCalendarView && isCalendarSplitOpen)
    const isMemoSplitVisible = activeView === 'map' && isMemoSplitOpen
    const isMapSplitVisible = activeView === 'long-term' && isMapSplitOpen
    const isRightSidePanelVisible = isCalendarPanelVisible
    const toggleCalendarSplit = useCallback(() => {
        setIsCalendarSplitOpen(prev => {
            const next = !prev
            if (next) {
                setIsMemoSplitOpen(false)
                setIsMapSplitOpen(false)
            }
            return next
        })
    }, [])
    const toggleMemoSplit = useCallback(() => {
        setIsMemoSplitOpen(prev => {
            const next = !prev
            if (next) {
                setIsCalendarSplitOpen(false)
                setIsMapSplitOpen(false)
            }
            return next
        })
    }, [])
    const toggleMapSplit = useCallback(() => {
        setIsMapSplitOpen(prev => {
            const next = !prev
            if (next) {
                setIsCalendarSplitOpen(false)
                setIsMemoSplitOpen(false)
            }
            return next
        })
    }, [])
    const openMindmapLinkedMemos = useCallback((taskId: string) => {
        setIsCalendarSplitOpen(false)
        setMindmapLinkedMemoTarget({ taskId, requestKey: Date.now() })
    }, [])
    // --- Sync Error Toast ---
    const [syncErrorToast, setSyncErrorToast] = useState<{ type: 'error'; message: string } | null>(null)

    // BottomNav の AI タブは setActiveView('ai') を使うので、イベントリスナーは不要

    // --- MindMap Sync Hook ---
    const initialTasksByParentId = useMemo(() => {
        const byParentId = new Map<string | null, Task[]>()
        for (const task of initialTasks) {
            const parentId = task.parent_task_id ?? null
            const list = byParentId.get(parentId)
            if (list) list.push(task)
            else byParentId.set(parentId, [task])
        }
        return byParentId
    }, [initialTasks])

    // STABLE reference for initial groups (root tasks) using useMemo
    const projectRootTasksInitial = useMemo(() => {
        // ルートタスク = parent_task_id === null のタスク
        return (initialTasksByParentId.get(null) ?? []).filter(t =>
            t.project_id === selectedProjectId
        )
    }, [initialTasksByParentId, selectedProjectId])

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
            for (const t of initialTasksByParentId.get(parentId) ?? []) {
                if (taskIds.has(t.id)) continue
                // is_group=true のタスクはルートタスクとして処理済み → スキップ
                if (t.is_group === true) continue
                result.push(t)
                taskIds.add(t.id)
                queue.push(t.id) // 子タスクの子も探索
            }
        }
        return result
    }, [initialTasksByParentId, projectRootTasksInitial])

    const {
        groups: currentGroups,
        tasks: currentTasks,
        createGroup,
        deleteGroup,
        createTask,
        updateTask,
        deleteTask,
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
    const { pushAction } = useUndoRedo()

    // プロジェクト復元・切替直後は、表示中ビューに関係なくDBから最新のマップを読む。
    useEffect(() => {
        if (!selectedProjectId) return
        refreshFromServer({ force: true })
    }, [refreshFromServer, selectedProjectId])

    // ビュー切り替え時にも、外部追加分を軽く再確認する。
    useEffect(() => {
        if (activeView === 'map' || activeView === 'ai') {
            refreshFromServer({ staleMs: 30_000 })
        }
    }, [activeView, refreshFromServer])

    // iOSネイティブアプリ復帰時は、表示済みUIを残したまま裏で最新タスクを読む。
    useEffect(() => {
        const handleNativeAppResume = () => {
            refreshFromServer({ force: true, silent: true })
        }

        window.addEventListener('focusmap:native-app-resume', handleNativeAppResume)
        return () => window.removeEventListener('focusmap:native-app-resume', handleNativeAppResume)
    }, [refreshFromServer])

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
    const handleCreateProject = useCallback(async (title: string, status: string = 'active', targetSpaceId?: string, colorTheme?: string) => {
        const spaceId = targetSpaceId || selectedSpaceId || (spaces.length > 0 ? spaces[0].id : null)
        if (!spaceId) return null

        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ space_id: spaceId, title, status, ...(colorTheme ? { color_theme: colorTheme } : {}) }),
        })
        if (!res.ok) return null
        const newProject: Project = await res.json()
        setProjects(prev => [newProject, ...prev])
        setSelectedProjectId(newProject.id)
        setContextDialogProject(newProject)
        return newProject
    }, [selectedSpaceId, spaces])

    const handleUpdateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
        const previousProjects = projects
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...updates } : p))
        const res = await fetch(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
        if (!res.ok) {
            setProjects(previousProjects)
            const data = await res.json().catch(() => ({}))
            throw new Error(typeof data.error === 'string' ? data.error : 'Project update failed')
        }
        const savedProject = await res.json().catch(() => null) as Project | null
        if (savedProject?.id) {
            setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...savedProject } : p))
        }
    }, [projects])

    const handleDeleteProject = useCallback(async (projectId: string) => {
        const previousProjects = projects
        const previousSelectedProjectId = selectedProjectId
        setProjects(prev => prev.filter(p => p.id !== projectId))
        if (selectedProjectId === projectId) {
            const remaining = projects.filter(p => p.id !== projectId)
            setSelectedProjectId(remaining.length > 0 ? remaining[0].id : null)
        }
        const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            setProjects(previousProjects)
            setSelectedProjectId(previousSelectedProjectId)
            throw new Error(data?.error || 'プロジェクトの削除に失敗しました')
        }
    }, [selectedProjectId, projects])

    const handleProjectSavedFromSwitcher = useCallback((project: Project) => {
        setProjects(prev => (
            prev.some(p => p.id === project.id)
                ? prev.map(p => p.id === project.id ? project : p)
                : [project, ...prev]
        ))
    }, [])

    const handleProjectCreatedFromSwitcher = useCallback((project: Project) => {
        handleProjectSavedFromSwitcher(project)
        setSelectedProjectId(project.id)
        setContextDialogProject(project)
    }, [handleProjectSavedFromSwitcher])

    // --- Space CRUD ---
    const handleCreateSpace = useCallback(async (title: string, color?: string) => {
        const res = await fetch('/api/spaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, ...(color ? { color } : {}) }),
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

    const handleSpaceSavedFromSwitcher = useCallback((space: Space) => {
        setSpaces(prev => (
            prev.some(s => s.id === space.id)
                ? prev.map(s => s.id === space.id ? space : s)
                : [space, ...prev]
        ))
    }, [])

    // --- Quick Task Creation (for TodayView FAB) ---
    const [quickTasks, setQuickTasks] = useState<Task[]>([])
    const [quickTaskToast, setQuickTaskToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)
    // Googleカレンダー同期に失敗した楽観タスク ID（うっすら表示を解除する）
    const [syncFailedIds, setSyncFailedIds] = useState<Set<string>>(new Set())
    const syncTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    const cancelledQuickTaskIdsRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        return () => {
            for (const t of syncTimeoutsRef.current.values()) clearTimeout(t)
            syncTimeoutsRef.current.clear()
        }
    }, [])
    // タスク更新のローカルオーバーライド（タイマー等の変更を即座に反映）
    const [taskOverrides, setTaskOverrides] = useState<Record<string, Partial<Task>>>({})
    const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(new Set())

    // Debounced calendar refresh (2s after last call) + optimistic event add
    const calendarRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const handleCalendarEventCreated = useCallback((eventData?: {
        id: string; title: string; scheduled_at: string; estimated_time: number; calendar_id?: string | null; description?: string | null
    }) => {
        // 楽観的にカレンダーへ即座追加
        if (eventData) {
            const startTime = new Date(eventData.scheduled_at)
            const endTime = new Date(startTime.getTime() + eventData.estimated_time * 60 * 1000)
            broadcastCalendarOptimisticEvent({
                id: `optimistic-${eventData.id}`,
                user_id: '',
                google_event_id: '',
                calendar_id: eventData.calendar_id || '',
                title: eventData.title,
                description: eventData.description || undefined,
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

    // handleCreateSubTask は後で定義するため、ref 経由で呼び出す（TDZ 回避）
    const handleCreateSubTaskRef = useRef<((parentTaskId: string, title: string) => Promise<void>) | null>(null)

    const handleCreateQuickTask = useCallback(async (taskData: {
        title: string
        project_id: string | null
        scheduled_at: string | null
        estimated_time: number
        reminders: number[]
        calendar_id: string | null
        priority: number
        memo?: string | null
        subtask_titles?: string[]
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
            memo: taskData.memo ?? null,
            memo_images: null,
            node_width: null,
            mindmap_collapsed: false,
        }

        // 時間指定がある予定は即時にタイムラインへ反映（カレンダー選択有無に依存しない）
        const showOnTimeline = !!taskData.scheduled_at
        const expectsCalendarSync = !!(taskData.scheduled_at && taskData.calendar_id)
        if (showOnTimeline) {
            setQuickTasks(prev => [...prev, optimisticTask])
            // カレンダービューにも即時反映（楽観的更新）
            if (taskData.calendar_id && taskData.scheduled_at) {
                handleCalendarEventCreated({
                    id: optimisticId,
                    title: taskData.title,
                    scheduled_at: taskData.scheduled_at,
                    estimated_time: taskData.estimated_time,
                    calendar_id: taskData.calendar_id,
                    description: taskData.memo,
                })
            }
        }

        // 同期タイムアウト（15s で google_event_id が来なければ「失敗」扱いにフェード解除）
        const markSyncFailed = () => {
            setSyncFailedIds(prev => {
                const next = new Set(prev)
                next.add(optimisticId)
                return next
            })
            syncTimeoutsRef.current.delete(optimisticId)
        }
        const clearSyncFailed = () => {
            const t = syncTimeoutsRef.current.get(optimisticId)
            if (t) { clearTimeout(t); syncTimeoutsRef.current.delete(optimisticId) }
            setSyncFailedIds(prev => {
                if (!prev.has(optimisticId)) return prev
                const next = new Set(prev)
                next.delete(optimisticId)
                return next
            })
        }
        if (expectsCalendarSync) {
            const handle = setTimeout(markSyncFailed, 15000)
            syncTimeoutsRef.current.set(optimisticId, handle)
        }

        pushAction({
            description: `「${taskData.title}」を作成`,
            undo: async () => {
                cancelledQuickTaskIdsRef.current.add(optimisticId)
                clearSyncFailed()
                setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
                setTaskOverrides(prev => {
                    const next = { ...prev }
                    delete next[optimisticId]
                    return next
                })
                broadcastCalendarOptimisticEventRemoval(`optimistic-${optimisticId}`)
                await fetch(`/api/tasks/${optimisticId}`, { method: 'DELETE' }).catch(err => {
                    console.warn('[QuickTask] Undo delete failed:', err)
                })
            },
            redo: async () => {
                cancelledQuickTaskIdsRef.current.delete(optimisticId)
                if (showOnTimeline) {
                    setQuickTasks(prev => prev.some(t => t.id === optimisticId) ? prev : [...prev, optimisticTask])
                    if (taskData.calendar_id && taskData.scheduled_at) {
                        handleCalendarEventCreated({
                            id: optimisticId,
                            title: taskData.title,
                            scheduled_at: taskData.scheduled_at,
                            estimated_time: taskData.estimated_time,
                            calendar_id: taskData.calendar_id,
                            description: taskData.memo,
                        })
                    }
                }
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
                        memo: taskData.memo ?? null,
                    }),
                })
                if (!res.ok) throw new Error('Failed to recreate task')
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
                        const syncData = await syncRes.json().catch(() => null)
                        if (syncData?.googleEventId) {
                            setQuickTasks(prev => prev.map(t =>
                                t.id === optimisticId
                                    ? { ...t, google_event_id: syncData.googleEventId }
                                    : t
                            ))
                            clearSyncFailed()
                            handleCalendarEventCreated()
                        }
                    }
                }
            },
        })

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
                        memo: taskData.memo ?? null,
                    }),
                })

                if (!res.ok) {
                    if (showOnTimeline) setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
                    clearSyncFailed()
                    setQuickTaskToast({ type: 'error', message: 'タスクの作成に失敗しました' })
                    return
                }

                if (cancelledQuickTaskIdsRef.current.has(optimisticId)) {
                    await fetch(`/api/tasks/${optimisticId}`, { method: 'DELETE' }).catch(err => {
                        console.warn('[QuickTask] Cancel cleanup failed:', err)
                    })
                    clearSyncFailed()
                    return
                }

                // 親 POST 成功 → サブタスクを順次作成（順序依存の FK 制約のため並列化しない）
                if (taskData.subtask_titles && taskData.subtask_titles.length > 0) {
                    const createSubTask = handleCreateSubTaskRef.current
                    if (createSubTask) {
                        for (const subtaskTitle of taskData.subtask_titles) {
                            await createSubTask(optimisticId, subtaskTitle)
                        }
                    }
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
                            clearSyncFailed()
                            handleCalendarEventCreated()
                        } else {
                            markSyncFailed()
                        }
                        setQuickTaskToast({ type: 'success', message: `Googleカレンダーに登録しました` })
                    } else {
                        markSyncFailed()
                        setQuickTaskToast({ type: 'info', message: 'タスクは保存しましたが、カレンダー同期に失敗しました' })
                    }
                } else {
                    clearSyncFailed()
                    setQuickTaskToast({ type: 'success', message: `「${taskData.title}」を保存しました` })
                }
            } catch (err) {
                console.error('[QuickTask] Background save failed:', err)
                if (showOnTimeline) setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
                clearSyncFailed()
                setQuickTaskToast({ type: 'error', message: 'タスクの作成に失敗しました' })
            }
        })()
    }, [userId, handleCalendarEventCreated, pushAction])

    // タスク更新ラッパー：DB保存 + ローカルstate即時反映（タイマー・編集等）
    const handleUpdateTaskWithQuickSync = useCallback(async (taskId: string, updates: Partial<Task>) => {
        setHiddenTaskIds(prev => {
            if (!prev.has(taskId)) return prev
            const next = new Set(prev)
            next.delete(taskId)
            return next
        })
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

    const handleDeleteTaskWithQuickSync = useCallback(async (taskId: string) => {
        setHiddenTaskIds(prev => {
            const next = new Set(prev)
            next.add(taskId)
            return next
        })
        setQuickTasks(prev => prev.filter(t => t.id !== taskId))
        setTaskOverrides(prev => {
            const next = { ...prev }
            delete next[taskId]
            return next
        })
        try {
            const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            if (!response.ok) throw new Error(`DELETE /api/tasks/${taskId} failed: ${response.status}`)
        } catch (err) {
            console.error('[Dashboard] Failed to delete task:', err)
            setHiddenTaskIds(prev => {
                const next = new Set(prev)
                next.delete(taskId)
                return next
            })
        }
    }, [])

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
        return dedupeGoogleEventTasks(merged).filter(task => !hiddenTaskIds.has(task.id))
    }, [currentGroups, currentTasks, hiddenTaskIds, initialTasks, quickTasks, taskOverrides])

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
            memo_images: null,
            node_width: null,
            mindmap_collapsed: false,
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
                return
            }
            pushAction({
                description: `「${title}」を作成`,
                undo: async () => {
                    setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
                    await fetch(`/api/tasks/${optimisticId}`, { method: 'DELETE' })
                },
                redo: async () => {
                    setQuickTasks(prev => prev.some(t => t.id === optimisticId) ? prev : [...prev, optimisticTask])
                    const redoRes = await fetch('/api/tasks', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: optimisticId,
                            parent_task_id: parentTaskId,
                            project_id: parentTask?.project_id ?? null,
                            title,
                        }),
                    })
                    if (!redoRes.ok) throw new Error('Failed to recreate sub task')
                },
            })
        } catch (err) {
            console.error('[SubTask] Create error:', err)
            setQuickTasks(prev => prev.filter(t => t.id !== optimisticId))
        }
    }, [allTasksMerged, userId, pushAction])

    // handleCreateQuickTask から参照できるようにrefを更新
    useEffect(() => {
        handleCreateSubTaskRef.current = handleCreateSubTask
    }, [handleCreateSubTask])

    // タスク削除（今日のビュー用）— quickTasks + taskOverrides からも削除
    const handleDeleteTaskFromToday = useCallback(async (taskId: string) => {
        setHiddenTaskIds(prev => {
            const next = new Set(prev)
            next.add(taskId)
            return next
        })
        setQuickTasks(prev => prev.filter(t => t.id !== taskId))
        setTaskOverrides(prev => {
            const next = { ...prev }
            delete next[taskId]
            return next
        })

        try {
            const response = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
            if (!response.ok) throw new Error(`DELETE /api/tasks/${taskId} failed: ${response.status}`)
        } catch (err) {
            console.error('[Dashboard] Failed to delete task:', err)
            setHiddenTaskIds(prev => {
                const next = new Set(prev)
                next.delete(taskId)
                return next
            })
        }
    }, [])

    // --- Undo/Redo Keyboard Listener ---
    const [undoToast, setUndoToast] = useState<{
        type: 'success' | 'info'
        message: string
        actionLabel?: string
        duration?: number
    } | null>(null)

    const handleUndoToastAction = useCallback(() => {
        undo().then(desc => {
            if (desc) setUndoToast({ type: 'success', message: `元に戻しました: ${desc}` })
        })
    }, [undo])

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
                const target = e.target as HTMLElement | null
                const tagName = target?.tagName?.toLowerCase()
                if (target?.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
                    return
                }
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

    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{
                message?: unknown
                actionLabel?: unknown
                duration?: unknown
            }>).detail
            if (!detail || typeof detail.message !== 'string') return
            setUndoToast({
                type: 'info',
                message: detail.message,
                actionLabel: typeof detail.actionLabel === 'string' ? detail.actionLabel : '元に戻す',
                duration: typeof detail.duration === 'number' ? detail.duration : 5000,
            })
        }
        window.addEventListener(UNDOABLE_ACTION_EVENT, handler)
        return () => window.removeEventListener(UNDOABLE_ACTION_EVENT, handler)
    }, [])

    // Sidebar State
    const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)

    // today / map / memo ビューでは左サイドバーを自動折りたたみ
    useEffect(() => {
        if (!isViewReady) return
        queueMicrotask(() => {
            setIsLeftSidebarCollapsed(activeView === 'today' || activeView === 'map' || activeView === 'long-term')
        })
    }, [activeView, isViewReady])
    const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
        if (typeof window !== 'undefined') {
            return Math.max(320, Math.floor(window.innerWidth * 0.5))
        }
        return 640
    })
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
        broadcastCalendarOptimisticEvent(event)
    }, [])
    const handleRemoveOptimisticEvent = useCallback((eventId: string) => {
        broadcastCalendarOptimisticEventRemoval(eventId)
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
                const maxW = window.innerWidth * 0.7
                const newWidth = Math.max(280, Math.min(maxW, dragStartWidthRightRef.current + delta))
                setRightSidebarWidth(newWidth)
            }
        }

        const handleTouchMove = (e: TouchEvent) => {
            if (isDraggingRightRef.current) {
                const delta = dragStartXRef.current - e.touches[0].clientX
                const maxW = window.innerWidth * 0.7
                const newWidth = Math.max(280, Math.min(maxW, dragStartWidthRightRef.current + delta))
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
                    projects={projects}
                    selectedSpaceId={selectedSpaceId}
                    selectedProjectId={selectedProjectId}
                    onSelectSpace={setSelectedSpaceId}
                    onSelectProject={setSelectedProjectId}
                    onProjectCreated={handleProjectCreatedFromSwitcher}
                    onProjectSaved={handleProjectSavedFromSwitcher}
                    onProjectDeleted={handleDeleteProject}
                    onSpaceSaved={handleSpaceSavedFromSwitcher}
                    showCalendarSplitToggle={activeView === 'map' || activeView === 'long-term'}
                    isCalendarSplitVisible={isCalendarPanelVisible}
                    onToggleCalendarSplit={toggleCalendarSplit}
                    showMapSplitToggle={activeView === 'long-term'}
                    isMapSplitVisible={isMapSplitVisible}
                    onToggleMapSplit={toggleMapSplit}
                    showMemoSplitToggle={activeView === 'map'}
                    isMemoSplitVisible={isMemoSplitVisible}
                    onToggleMemoSplit={toggleMemoSplit}
                    onMindmapUpdated={refreshFromServer}
                    onLogoClick={openTodayBoard}
                />

                {/* Google カレンダー連携完了の一時通知（?calendar_connected=true を検知して3秒表示） */}
                <CalendarConnectedToast />

                <ProjectContextDialog
                    open={Boolean(contextDialogProject)}
                    project={contextDialogProject}
                    onClose={() => setContextDialogProject(null)}
                />

                {/* Undo/Redo Toast */}
                {undoToast && (
                    <CalendarToast
                        type={undoToast.type}
                        message={undoToast.message}
                        duration={undoToast.duration ?? 2000}
                        actionLabel={undoToast.actionLabel}
                        onAction={undoToast.actionLabel ? handleUndoToastAction : undefined}
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
                {isViewReady && isMobileViewport && activeView === 'today' && (
                    <>
                        {/* Mobile */}
                        <div className="flex-1 min-h-0 flex flex-col md:hidden overflow-hidden">
                            <TodayView
                                allTasks={allTasksMerged}
                                onUpdateTask={handleUpdateTaskWithQuickSync}
                                projects={projects}
                                selectedSpaceId={selectedSpaceId}
                                spaces={spaces}
                                onCreateQuickTask={handleCreateQuickTask}
                                onCreateSubTask={handleCreateSubTask}
                                onDeleteTask={handleDeleteTaskFromToday}
                                onOpenAiChat={() => setIsAiChatOpen(true)}
                            />
                        </div>
                    </>
                )}

                {isViewReady && isMobileViewport && activeView === 'habits' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <HabitsView onUpdateTask={updateTask} />
                    </div>
                )}

                {isViewReady && isMobileViewport && activeView === 'map' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <MobileAiMapView
                            projects={projects}
                            spaces={spaces}
                            selectedProjectId={selectedProjectId}
                            selectedSpaceId={selectedSpaceId}
                            onSelectProject={setSelectedProjectId}
                            onSelectSpace={setSelectedSpaceId}
                            selectedProject={selectedProject}
                            groups={currentGroups}
                            tasks={currentTasks}
                            allTasks={allTasksMerged}
                            onCreateGroup={handleCreateGroup}
                            onDeleteGroup={handleDeleteGroup}
                            onUpdateProject={handleUpdateProjectTitle}
                            onPatchProject={handleUpdateProject}
                            onCreateTask={createTask}
                            onUpdateTask={updateTask}
                            onDeleteTask={handleDeleteTask}
                            onReorderTask={reorderTask}
                            onOpenLinkedMemos={openMindmapLinkedMemos}
                            onKanbanUpdateTask={handleUpdateTaskWithQuickSync}
                            onKanbanDeleteTask={handleDeleteTaskWithQuickSync}
                            refreshFromServer={refreshFromServer}
                        />
                    </div>
                )}

                {isViewReady && isMobileViewport && activeView === 'ai' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <MobileAiExecutionView
                            selectedSpaceId={selectedSpaceId}
                            selectedProjectId={selectedProjectId}
                            onMindmapUpdated={refreshFromServer}
                            onCalendarEventCreated={handleCalendarEventCreated}
                        />
                    </div>
                )}

                {isViewReady && isMobileViewport && activeView === 'automation' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <AutoChatView spaceId={selectedSpaceId} projectId={selectedProjectId} />
                    </div>
                )}

                {isViewReady && activeView === 'settings' && (
                    <div className="flex-1 min-h-0 overflow-hidden">
                        <SettingsOverview />
                    </div>
                )}

                {/* === Mobile/Desktop: Ideal View === */}
                {isViewReady && activeView === 'ideal' && (
                    <div className="flex-1 flex overflow-hidden">
                        <IdealView />
                    </div>
                )}

                {isViewReady && activeView === 'long-term' && (
                    <div className={cn("flex-1 overflow-hidden", isCalendarPanelVisible && "md:hidden")}>
                        {isMapSplitVisible ? (
                            <div className="flex h-full min-h-0 overflow-hidden">
                                <div className="h-full min-w-[420px] max-w-[720px] border-r bg-background" style={{ width: '46%' }}>
                                    <WishlistView
                                        projects={projects}
                                        spaces={spaces}
                                        selectedProjectId={selectedProjectId}
                                        selectedSpaceId={selectedSpaceId}
                                        onSelectSpace={setSelectedSpaceId}
                                        onSelectProject={setSelectedProjectId}
                                        onProjectCreated={handleProjectCreatedFromSwitcher}
                                        onProjectSaved={handleProjectSavedFromSwitcher}
                                        onProjectDeleted={handleDeleteProject}
                                        onSpaceSaved={handleSpaceSavedFromSwitcher}
                                        onOpenTodayMemoSchedule={openTodayMemoSchedule}
                                        isCalendarSplitVisible={false}
                                        onMindmapUpdated={refreshFromServer}
                                    />
                                </div>
                                <div className="min-w-0 flex-1 overflow-hidden">
                                    <CenterPane
                                        project={selectedProject}
                                        spaces={spaces}
                                        projects={projects}
                                        groups={currentGroups}
                                        tasks={currentTasks}
                                        allTasks={allTasksMerged}
                                        onUpdateProject={handleUpdateProjectTitle}
                                        onCreateGroup={handleCreateGroup}
                                        onDeleteGroup={handleDeleteGroup}
                                        onCreateTask={createTask}
                                        onPatchProject={handleUpdateProject}
                                        onUpdateTask={updateTask}
                                        onDeleteTask={handleDeleteTask}
                                        onBulkDelete={bulkDelete}
                                        onReorderTask={reorderTask}
                                        onReorderGroup={reorderGroup}
                                        onRefreshCalendar={handleRefreshCalendar}
                                        onAddOptimisticEvent={handleAddOptimisticEvent}
                                        onRemoveOptimisticEvent={handleRemoveOptimisticEvent}
                                        onOpenLinkedMemos={openMindmapLinkedMemos}
                                        onKanbanUpdateTask={handleUpdateTaskWithQuickSync}
                                        onKanbanDeleteTask={handleDeleteTaskWithQuickSync}
                                    />
                                </div>
                            </div>
                        ) : (
                            <WishlistView
                                projects={projects}
                                spaces={spaces}
                                selectedProjectId={selectedProjectId}
                                selectedSpaceId={selectedSpaceId}
                                onSelectSpace={setSelectedSpaceId}
                                onSelectProject={setSelectedProjectId}
                                onProjectCreated={handleProjectCreatedFromSwitcher}
                                onProjectSaved={handleProjectSavedFromSwitcher}
                                onProjectDeleted={handleDeleteProject}
                                onSpaceSaved={handleSpaceSavedFromSwitcher}
                                onOpenTodayMemoSchedule={openTodayMemoSchedule}
                                isCalendarSplitVisible={false}
                                onToggleCalendarSplit={toggleCalendarSplit}
                                onMindmapUpdated={refreshFromServer}
                            />
                        )}
                    </div>
                )}

                {/* === Desktop: AI View === */}
                {!isMobileViewport && activeView === 'ai' && (
                    <div className={cn("flex-1 w-full overflow-hidden", desktopFlexClass, desktopDashboardWidthClass)}>
                        <AiView
                            selectedSpaceId={selectedSpaceId}
                            selectedProjectId={selectedProjectId}
                        />
                    </div>
                )}

                {!isMobileViewport && activeView === 'automation' && (
                    <div className={cn("flex-1 w-full overflow-hidden", desktopFlexClass, desktopDashboardWidthClass)}>
                        <AutoChatView spaceId={selectedSpaceId} projectId={selectedProjectId} />
                    </div>
                )}

                {/* === Desktop: AI Todos View === */}
                {!isMobileViewport && activeView === 'ai-todos' && (
                    <div className={cn("flex-1 w-full overflow-hidden", desktopFlexClass, desktopDashboardWidthClass)}>
                        <AiTodosView initialTasks={[]} initialSnapshot={null} sessionDate={getTodayDateString()} />
                    </div>
                )}

                {/* === Desktop: 3-pane layout === */}
                {!isMobileViewport && (
                <TodayDateProvider selectedDate={todaySelectedDate} setSelectedDate={setTodaySelectedDate}>
                <div className={cn(
                    "flex-1 w-full relative gap-0 overflow-hidden",
                    desktopFlexClass,
                    desktopDashboardWidthClass,
                    (activeView === 'ai' || activeView === 'automation' || activeView === 'ideal' || activeView === 'ai-todos' || activeView === 'settings' || (activeView === 'long-term' && !isCalendarPanelVisible)) ? "!hidden" : ""
                )}>
                {/* Toggle Button (Today タブでは非表示。サイドバーが常に折りたたまれているため不要) */}
                {activeView !== 'today' && (
                    <div className={cn(
                        "absolute top-4 z-50 transition-all duration-300 ease-in-out",
                        desktopFlexClass,
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
                )}

                {/* Pane 1: Left Sidebar */}
                <div
                    className={cn(
                        "flex-none overflow-hidden h-full transition-all duration-300 ease-in-out",
                        desktopFlexClass,
                        isLeftSidebarCollapsed ? "w-0 opacity-0" : "w-52 opacity-100"
                    )}
                    style={isLeftSidebarCollapsed ? {} : { minWidth: '13rem' }}
                >
                    <LeftSidebar
                        spaces={spaces}
                        selectedSpaceId={selectedSpaceId}
                        projects={projects}
                        selectedProjectId={selectedProjectId}
                        onSelectSpace={setSelectedSpaceId}
                        onSelectProject={setSelectedProjectId}
                        onCreateSpace={handleCreateSpace}
                        onUpdateSpace={handleUpdateSpace}
                        onDeleteSpace={handleDeleteSpace}
                        onCreateProject={handleCreateProject}
                        onUpdateProject={handleUpdateProject}
                        onDeleteProject={handleDeleteProject}
                    />
                </div>

                {/* Pane 2: Center (TodayTaskBoard / MindMap / Habits) */}
                <div className="flex-1 min-w-0 overflow-hidden h-full w-full flex flex-col" style={{ minWidth: 0 }}>
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {activeView === 'habits' ? (
                        <HabitsView onUpdateTask={updateTask} />
                    ) : activeView === 'today' ? (
                        <div className="flex h-full w-full flex-col overflow-hidden">
                            <div className="shrink-0 border-b bg-background px-3 py-2">
                                <div className="inline-flex rounded-md border bg-muted/30 p-0.5 text-xs">
                                    <button
                                        type="button"
                                        onClick={() => updateTodaySubView('memo')}
                                        className={cn(
                                            "min-h-[28px] rounded px-3 py-1 transition-colors",
                                            todaySubView === 'memo'
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        メモ + カレンダー
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateTodaySubView('timeline')}
                                        className={cn(
                                            "min-h-[28px] rounded px-3 py-1 transition-colors",
                                            todaySubView === 'timeline'
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        タイムライン
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateTodaySubView('ai')}
                                        className={cn(
                                            "min-h-[28px] rounded px-3 py-1 transition-colors",
                                            todaySubView === 'ai'
                                                ? "bg-background text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground",
                                        )}
                                    >
                                        AI実行
                                    </button>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 overflow-hidden">
                                {todaySubView === 'memo' ? (
                                    <TodayMemoBoard
                                        projects={projects}
                                        selectedSpaceId={selectedSpaceId}
                                        selectedProjectId={selectedProjectId}
                                        scheduleFocusMemoId={todayMemoScheduleFocus?.memoId ?? null}
                                        scheduleFocusRequestKey={todayMemoScheduleFocus?.requestKey ?? null}
                                        onClearScheduleFocus={() => setTodayMemoScheduleFocus(null)}
                                    />
                                ) : todaySubView === 'timeline' ? (
                                    <TodayTaskBoard
                                        allTasks={allTasksMerged}
                                        onUpdateTask={handleUpdateTaskWithQuickSync}
                                        projects={projects}
                                        onCreateQuickTask={handleCreateQuickTask}
                                        onDeleteTask={handleDeleteTaskFromToday}
                                        syncFailedIds={syncFailedIds}
                                    />
                                ) : (
                                    <AiExecutionTimeline
                                        selectedDate={todaySelectedDate}
                                        showDateControls
                                        onDateChange={setTodaySelectedDate}
                                        selectedSpaceId={selectedSpaceId}
                                        spaces={spaces}
                                    />
                                )}
                            </div>
                        </div>
                    ) : activeView === 'long-term' ? (
                        <WishlistView
                            projects={projects}
                            spaces={spaces}
                            selectedProjectId={selectedProjectId}
                            selectedSpaceId={selectedSpaceId}
                            onOpenTodayMemoSchedule={openTodayMemoSchedule}
                            isCalendarSplitVisible={isCalendarPanelVisible}
                            onToggleCalendarSplit={toggleCalendarSplit}
                            onMindmapUpdated={refreshFromServer}
                        />
                    ) : activeView === 'map' && isMemoSplitVisible ? (
                        <div className="flex h-full min-h-0 overflow-hidden">
                            <div className="h-full min-w-[360px] max-w-[560px] border-r bg-background" style={{ width: '42%' }}>
                                <WishlistView
                                    projects={projects}
                                    spaces={spaces}
                                    selectedProjectId={selectedProjectId}
                                    selectedSpaceId={selectedSpaceId}
                                    onOpenTodayMemoSchedule={openTodayMemoSchedule}
                                    isCalendarSplitVisible={false}
                                    compactComposer
                                    onMindmapUpdated={refreshFromServer}
                                />
                            </div>
                            <div className="min-w-0 flex-1 overflow-hidden">
                                <CenterPane
                                    project={selectedProject}
                                    spaces={spaces}
                                    projects={projects}
                                    groups={currentGroups}
                                    tasks={currentTasks}
                                    allTasks={allTasksMerged}
                                    onUpdateProject={handleUpdateProjectTitle}
                                    onCreateGroup={handleCreateGroup}
                                    onDeleteGroup={handleDeleteGroup}
                                    onCreateTask={createTask}
                                    onPatchProject={handleUpdateProject}
                                    onUpdateTask={updateTask}
                                    onDeleteTask={handleDeleteTask}
                                    onBulkDelete={bulkDelete}
                                    onReorderTask={reorderTask}
                                    onReorderGroup={reorderGroup}
                                    onRefreshCalendar={handleRefreshCalendar}
                                    onAddOptimisticEvent={handleAddOptimisticEvent}
                                    onRemoveOptimisticEvent={handleRemoveOptimisticEvent}
                                    onOpenLinkedMemos={openMindmapLinkedMemos}
                                    onKanbanUpdateTask={handleUpdateTaskWithQuickSync}
                                    onKanbanDeleteTask={handleDeleteTaskWithQuickSync}
                                />
                            </div>
                        </div>
                    ) : (
                        <CenterPane
                            project={selectedProject}
                            spaces={spaces}
                            projects={projects}
                            groups={currentGroups}
                            tasks={currentTasks}
                            allTasks={allTasksMerged}
                            onUpdateProject={handleUpdateProjectTitle}
                            onCreateGroup={handleCreateGroup}
                            onDeleteGroup={handleDeleteGroup}
                            onCreateTask={createTask}
                            onPatchProject={handleUpdateProject}
                            onUpdateTask={updateTask}
                            onDeleteTask={handleDeleteTask}
                            onBulkDelete={bulkDelete}
                            onReorderTask={reorderTask}
                            onReorderGroup={reorderGroup}
                            onRefreshCalendar={handleRefreshCalendar}
                            onAddOptimisticEvent={handleAddOptimisticEvent}
                            onRemoveOptimisticEvent={handleRemoveOptimisticEvent}
                            onOpenLinkedMemos={openMindmapLinkedMemos}
                            onKanbanUpdateTask={handleUpdateTaskWithQuickSync}
                            onKanbanDeleteTask={handleDeleteTaskWithQuickSync}
                        />
                    )}
                    </div>
                </div>

                {/* Right Resize Handle */}
                {isRightSidePanelVisible && (
                    <div
                        className="w-1 h-full bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-none flex items-center justify-center group"
                        onMouseDown={handleRightMouseDown}
                        onTouchStart={handleRightTouchStart}
                    >
                        <div className="w-0.5 h-8 bg-muted-foreground/20 group-hover:bg-primary rounded-full" />
                    </div>
                )}

                {/* Pane 3: Right Sidebar (Calendar) */}
                {isRightSidePanelVisible && (
                    <div
                        className="flex-none overflow-hidden h-full"
                        style={{ width: rightSidebarWidth }}
                    >
                        <RightSidebar
                            ref={rightSidebarRef}
                            onUpdateTask={handleUpdateTaskWithQuickSync}
                            tasks={allTasksMerged}
                            projects={projects}
                            selectedProjectId={selectedProjectId}
                            onCreateQuickTask={handleCreateQuickTask}
                            onCreateSubTask={handleCreateSubTask}
                            onDeleteTask={handleDeleteTaskFromToday}
                            onOpenAiChat={() => setIsAiChatOpen(true)}
                            syncFailedIds={syncFailedIds}
                            calendarScrollToHour={todayMemoScheduleFocus ? 12 : undefined}
                            calendarScrollRequestKey={todayMemoScheduleFocus?.requestKey}
                        />
                    </div>
                )}
            </div>
            </TodayDateProvider>
                )}
            {/* AI Chat Floating Panel (AI・理想・進捗ビュー中は非表示) */}
            {isAiChatOpen && activeView !== 'ai' && activeView !== 'automation' && activeView !== 'ideal' && activeView !== 'ai-todos' && activeView !== 'settings' && (
                <AiChatPanel hideFab onCalendarEventCreated={handleCalendarEventCreated} isOpen={isAiChatOpen} onOpenChange={setIsAiChatOpen} />
            )}
            {/* Scheduling AI Panel */}
            {isSchedulingOpen && activeView !== 'ai' && activeView !== 'automation' && activeView !== 'ideal' && activeView !== 'ai-todos' && activeView !== 'settings' && (
                <SchedulingPanel hideFab onCalendarEventCreated={handleCalendarEventCreated} isOpen={isSchedulingOpen} onOpenChange={setIsSchedulingOpen} />
            )}
            <MindmapLinkedMemosDialog
                target={mindmapLinkedMemoTarget}
                projects={projects}
                onOpenChange={(open) => {
                    if (!open) setMindmapLinkedMemoTarget(null)
                }}
                onTaskUpdated={handleUpdateTaskWithQuickSync}
            />
            </TimerProvider>
        </DragProvider>
    )
}
