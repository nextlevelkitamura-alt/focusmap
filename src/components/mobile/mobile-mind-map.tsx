"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CodexNodePanel } from "@/components/codex/codex-node-panel"
import { CustomMindMapView, type CustomMindMapImportedChatDragEvent } from "@/components/mindmap/custom-mind-map-view"
import { TaskProgressDetailPanel } from "@/components/task-progress/task-progress-detail-panel"
import { TaskProgressKanban, type TaskProgressImportDragEvent, type TaskProgressImportItem, type TaskProgressImportRepoOption } from "@/components/task-progress/task-progress-kanban"
import { getCodexTaskUiState, type CodexTaskUiStateName } from "@/lib/codex-run-state"
import {
    CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS,
    requestCodexThreadArchiveFromNode,
    setCodexSourceTaskCompletionFromNode,
} from "@/lib/codex-source-completion"
import { codexThreadImportActivityAt, codexThreadPromptPreviewFromMemo } from "@/lib/codex-thread-import-display"
import { buildLongNodeHeadingPayload } from "@/lib/memo-ai-generation"
import { getHiddenCodexInboxTaskIds } from "@/lib/codex-inbox-visibility"
import { aiTaskToTaskProgressFallback } from "@/lib/task-progress-fallback"
import { hydrateTaskProgressMindMapSources } from "@/lib/task-progress-source"
import { codexMonitorUiLabel, getCodexMonitorUiStatus } from "@/lib/task-progress-ui"
import { LINKED_TASK_STATUS_EVENT } from "@/lib/calendar-constants"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import { useTaskProgressSnapshot } from "@/hooks/useTaskProgressSnapshot"
import { useAvailableRepos } from "@/hooks/useAvailableRepos"
import { useMindMapCollapsedTaskIds } from "@/hooks/useMindMapCollapsedTaskIds"
import type { AiTask } from "@/types/ai-task"
import type { Project, Space, Task } from "@/types/database"
import type { TaskProgressSnapshotTask, TaskProgressStatus } from "@/types/task-progress"

type MobileCustomDropPosition = "above" | "below" | "as-child"
const TASK_PROGRESS_FIXTURE_STATUSES: TaskProgressStatus[] = ["running", "awaiting_approval", "completed", "failed"]
const TASK_PROGRESS_ACTIVITY_HINT_STATUSES = new Set(["pending", "running", "awaiting_approval", "needs_input"])

type OptimisticCodexPlacement = {
    parentTaskId: string | null
    projectId: string
}

function formatChatImportUpdatedLabel(value: string | null | undefined) {
    if (!value) return "更新不明"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return "更新不明"
    return `最終 ${date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} ${date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`
}

function normalizeRepoPath(value: string | null | undefined) {
    return (value ?? "").trim().replace(/\/+$/, "")
}

function repoNameFromPath(value: string | null | undefined) {
    const normalized = normalizeRepoPath(value)
    if (!normalized) return null
    return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized
}

function recordValue(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

function codexScopeRepoPathFromAiTask(aiTask: AiTask | null | undefined) {
    const result = recordValue(aiTask?.result)
    const meta = recordValue(result?.meta)
    return normalizeRepoPath(
        stringValue(meta?.scope_repo_path) ||
        stringValue(result?.scope_repo_path) ||
        null,
    )
}

function codexThreadMatchesSelectedRepo(
    task: Task,
    aiTask: AiTask | null | undefined,
    taskProject: Project | null | undefined,
    selectedRepoPath: string | null | undefined,
) {
    const selected = normalizeRepoPath(selectedRepoPath)
    if (!selected) return false
    const taskWorkDir = normalizeRepoPath(task.codex_work_dir ?? aiTask?.cwd ?? null)
    if (taskWorkDir === selected) return true
    if (codexScopeRepoPathFromAiTask(aiTask) === selected) return true
    return normalizeRepoPath(taskProject?.repo_path) === selected
}

function codexChatImportStatusLabel(
    visualStatus: string | null | undefined,
    fallbackLabel: string | null | undefined,
) {
    if (visualStatus === "completed" || visualStatus === "done") {
        return fallbackLabel ?? "完了済み"
    }
    return getCodexMonitorUiStatus(visualStatus) === "review"
        ? "返信待ち"
        : fallbackLabel ?? codexMonitorUiLabel(visualStatus)
}

function shouldUseTaskProgressFixture() {
    if (typeof window === "undefined") return false
    const params = new URLSearchParams(window.location.search)
    if (params.has("taskProgressFixture")) return true
    return window.localStorage.getItem("focusmap:task-progress-fixture") === "1"
}

interface MobileMindMapProps {
    project: Project
    spaces?: Space[]
    projects?: Project[]
    groups: Task[]
    tasks: Task[]
    allTasks?: Task[]
    onCreateGroup?: (title: string) => Promise<Task | null>
    onDeleteGroup?: (groupId: string) => Promise<void>
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onPatchProject?: (projectId: string, updates: Partial<Project>) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onReorderTask?: (taskId: string, referenceTaskId: string, position: "above" | "below") => Promise<void>
    onOpenLinkedMemos?: (taskId: string) => void
    focusEditNodeId?: string | null
    onKanbanUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onKanbanDeleteTask?: (taskId: string) => Promise<void>
    codexOpenSignal?: number
}

export function MobileMindMap({
    project,
    spaces = [],
    projects = [],
    groups,
    tasks,
    allTasks = [],
    onCreateGroup,
    onDeleteGroup,
    onUpdateProject,
    onPatchProject,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
    onReorderTask,
    onOpenLinkedMemos,
    focusEditNodeId,
    onKanbanUpdateTask,
    onKanbanDeleteTask,
    codexOpenSignal,
}: MobileMindMapProps) {
    const { collapsedTaskIds, setTaskCollapsed: setTaskCollapsedState } = useMindMapCollapsedTaskIds({
        projectId: project.id,
        groups,
        tasks,
    })
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
    const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null)
    const [codexPanelTaskId, setCodexPanelTaskId] = useState<string | null>(null)
    const [taskProgressPanelTaskId, setTaskProgressPanelTaskId] = useState<string | null>(null)
    const [taskProgressPanelTaskOverride, setTaskProgressPanelTaskOverride] = useState<TaskProgressSnapshotTask | null>(null)
    const [generatingHeadingNodeIds, setGeneratingHeadingNodeIds] = useState<Set<string>>(new Set())
    const [codexThreadImportOverride, setCodexThreadImportOverride] = useState<boolean | null>(null)
    const [codexRepoPathOverride, setCodexRepoPathOverride] = useState<string | null | undefined>(undefined)
    const [codexImportRepoPathOverride, setCodexImportRepoPathOverride] = useState<string | null | undefined>(undefined)
    const [isCodexThreadImportSaving, setIsCodexThreadImportSaving] = useState(false)
    const [hiddenCodexChatImportIds, setHiddenCodexChatImportIds] = useState<Set<string>>(() => new Set())
    const [mobileCodexImportDragEvent, setMobileCodexImportDragEvent] = useState<CustomMindMapImportedChatDragEvent | null>(null)
    const [optimisticCodexPlacements, setOptimisticCodexPlacements] = useState<Record<string, OptimisticCodexPlacement>>({})
    const [taskProgressFixtureEnabled] = useState(() => shouldUseTaskProgressFixture())
    const mobileCodexImportDragSequenceRef = useRef(0)
    const handledFocusEditNodeIdRef = useRef<string | null>(null)
    const emptyAiTaskMap = useMemo(() => new Map<string, AiTask>(), [])
    const currentMapTaskIds = useMemo(() => {
        const ids = new Set<string>()
        for (const task of [...groups, ...tasks]) {
            if (task?.id) ids.add(task.id)
        }
        return ids
    }, [groups, tasks])
    const allTasksById = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of allTasks) {
            if (task?.id) map.set(task.id, task)
        }
        for (const task of [...groups, ...tasks]) {
            if (task?.id) map.set(task.id, task)
        }
        return map
    }, [allTasks, groups, tasks])
    const applyOptimisticCodexPlacement = useCallback((task: Task): Task => {
        const placement = optimisticCodexPlacements[task.id]
        if (!placement) return task
        return {
            ...task,
            parent_task_id: placement.parentTaskId,
            project_id: placement.projectId,
            deleted_at: null,
        }
    }, [optimisticCodexPlacements])
    const mapGroups = useMemo(() => {
        const next = groups.map(applyOptimisticCodexPlacement)
        for (const [taskId, placement] of Object.entries(optimisticCodexPlacements)) {
            if (placement.parentTaskId !== null) continue
            if (currentMapTaskIds.has(taskId)) continue
            const task = allTasksById.get(taskId)
            if (!task || task.deleted_at != null) continue
            next.push({
                ...task,
                parent_task_id: null,
                project_id: placement.projectId,
                deleted_at: null,
            })
        }
        return next
    }, [allTasksById, applyOptimisticCodexPlacement, currentMapTaskIds, groups, optimisticCodexPlacements])
    const mapTasks = useMemo(() => {
        const next = tasks.map(applyOptimisticCodexPlacement)
        for (const [taskId, placement] of Object.entries(optimisticCodexPlacements)) {
            if (placement.parentTaskId === null) continue
            if (currentMapTaskIds.has(taskId)) continue
            const task = allTasksById.get(taskId)
            if (!task || task.deleted_at != null) continue
            next.push({
                ...task,
                parent_task_id: placement.parentTaskId,
                project_id: placement.projectId,
                deleted_at: null,
            })
        }
        return next
    }, [allTasksById, applyOptimisticCodexPlacement, currentMapTaskIds, optimisticCodexPlacements, tasks])
    const taskMap = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of [...mapGroups, ...mapTasks]) {
            if (task?.id) map.set(task.id, task)
        }
        return map
    }, [mapGroups, mapTasks])
    const allMindMapTasks = useMemo(() => [...mapGroups, ...mapTasks], [mapGroups, mapTasks])
    const hiddenCodexInboxTaskIds = useMemo(
        () => getHiddenCodexInboxTaskIds(allMindMapTasks),
        [allMindMapTasks],
    )
    const visibleMapGroups = useMemo(
        () => mapGroups.filter(group => !hiddenCodexInboxTaskIds.has(group.id)),
        [hiddenCodexInboxTaskIds, mapGroups],
    )
    const visibleMapTasks = useMemo(
        () => mapTasks.filter(task => !hiddenCodexInboxTaskIds.has(task.id)),
        [hiddenCodexInboxTaskIds, mapTasks],
    )
    const kanbanProjects = useMemo(() => {
        const map = new Map<string, Project>()
        for (const candidate of projects) map.set(candidate.id, candidate)
        map.set(project.id, project)
        return Array.from(map.values())
    }, [project, projects])
    const [kanbanSpaceId, setKanbanSpaceId] = useState<string | null>(() => project.space_id ?? null)
    const [kanbanProjectId, setKanbanProjectId] = useState<string | null>(() => project.id)
    const {
        repos: availableRepos,
        isLoading: isAvailableReposLoading,
        error: availableReposError,
        refresh: refreshAvailableRepos,
        requestRescan: requestAvailableReposRescan,
    } = useAvailableRepos()

    useEffect(() => {
        setKanbanSpaceId(project.space_id ?? null)
        setKanbanProjectId(project.id)
        setCodexThreadImportOverride(null)
        setCodexRepoPathOverride(undefined)
        setCodexImportRepoPathOverride(undefined)
        setHiddenCodexChatImportIds(new Set())
        setMobileCodexImportDragEvent(null)
        setOptimisticCodexPlacements({})
    }, [project.id, project.space_id])

    useEffect(() => {
        setOptimisticCodexPlacements(prev => {
            let changed = false
            const next = { ...prev }
            for (const [taskId, placement] of Object.entries(prev)) {
                const task = allTasksById.get(taskId)
                if (!task || task.deleted_at != null) {
                    delete next[taskId]
                    changed = true
                    continue
                }
                if (task.parent_task_id === placement.parentTaskId && task.project_id === placement.projectId) {
                    delete next[taskId]
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [allTasksById])

    const projectRepoPath = useMemo(() => (
        normalizeRepoPath(codexRepoPathOverride !== undefined ? codexRepoPathOverride : project.repo_path)
    ), [codexRepoPathOverride, project.repo_path])
    const selectedCodexImportRepoPath = useMemo(() => (
        normalizeRepoPath(codexImportRepoPathOverride !== undefined ? codexImportRepoPathOverride : projectRepoPath)
    ), [codexImportRepoPathOverride, projectRepoPath])
    const codexThreadImportEnabled = codexThreadImportOverride ?? Boolean(project.codex_thread_import_enabled)
    const projectsForSelectedImportRepo = useMemo(() => {
        if (!selectedCodexImportRepoPath) return []
        return kanbanProjects.filter(candidate => normalizeRepoPath(candidate.repo_path) === selectedCodexImportRepoPath)
    }, [kanbanProjects, selectedCodexImportRepoPath])
    const selectedRepoImportProjects = useMemo(() => (
        projectsForSelectedImportRepo.filter(candidate => Boolean(candidate.codex_thread_import_enabled))
    ), [projectsForSelectedImportRepo])
    const selectedRepoImportEnabled = selectedRepoImportProjects.length > 0 ||
        (projectRepoPath === selectedCodexImportRepoPath && codexThreadImportEnabled)
    const selectedImportRepoIsCodexCandidate = useMemo(() => (
        availableRepos.some(repo => repo.source === "codex" && normalizeRepoPath(repo.absolute_path) === selectedCodexImportRepoPath)
    ), [availableRepos, selectedCodexImportRepoPath])
    const selectedRepoImportOwnerLabel = selectedRepoImportProjects
        .map(candidate => candidate.title)
        .filter(Boolean)
        .slice(0, 2)
        .join(" / ") || (selectedRepoImportEnabled ? project.title : null)

    const patchProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
        if (onPatchProject) {
            await onPatchProject(projectId, updates)
            return
        }

        const res = await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        })
        if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(typeof data.error === "string" ? data.error : "Codex thread import update failed")
        }
    }, [onPatchProject])

    const selectCodexImportRepoPath = useCallback((repoPath: string | null) => {
        setCodexImportRepoPathOverride(normalizeRepoPath(repoPath) || null)
    }, [])

    const toggleSelectedRepoImport = useCallback(async () => {
        if (!project.id || !selectedCodexImportRepoPath || isCodexThreadImportSaving) return
        if (!selectedRepoImportEnabled && !selectedImportRepoIsCodexCandidate) return
        const previousImportOverride = codexThreadImportOverride
        const previousRepoOverride = codexRepoPathOverride
        setIsCodexThreadImportSaving(true)
        try {
            if (selectedRepoImportEnabled) {
                const targets = selectedRepoImportProjects.length > 0
                    ? selectedRepoImportProjects
                    : (projectRepoPath === selectedCodexImportRepoPath ? [project] : [])
                await Promise.all(targets.map(candidate => (
                    patchProject(candidate.id, { codex_thread_import_enabled: false })
                )))
                if (projectRepoPath === selectedCodexImportRepoPath) setCodexThreadImportOverride(false)
                return
            }

            await patchProject(project.id, {
                repo_path: selectedCodexImportRepoPath,
                codex_thread_import_enabled: true,
            })
            setCodexRepoPathOverride(selectedCodexImportRepoPath)
            setCodexThreadImportOverride(true)
        } catch (error) {
            setCodexThreadImportOverride(previousImportOverride)
            setCodexRepoPathOverride(previousRepoOverride)
            console.error("[MobileMindMap] Failed to toggle repo-scoped Codex thread import:", error)
        } finally {
            setIsCodexThreadImportSaving(false)
        }
    }, [
        codexRepoPathOverride,
        codexThreadImportOverride,
        isCodexThreadImportSaving,
        patchProject,
        project,
        projectRepoPath,
        selectedCodexImportRepoPath,
        selectedImportRepoIsCodexCandidate,
        selectedRepoImportEnabled,
        selectedRepoImportProjects,
    ])

    const handleRefreshAvailableRepos = useCallback(async () => {
        await requestAvailableReposRescan()
        await refreshAvailableRepos()
    }, [refreshAvailableRepos, requestAvailableReposRescan])

    const kanbanProject = useMemo(() => (
        kanbanProjects.find(candidate => candidate.id === kanbanProjectId) ?? project
    ), [kanbanProjectId, kanbanProjects, project])
    const kanbanTaskNodes = useMemo(() => {
        if (!kanbanProject?.id) return allMindMapTasks
        if (kanbanProject.id === project.id) return allMindMapTasks
        return allTasks.filter(task => task.project_id === kanbanProject.id && task.deleted_at === null)
    }, [allMindMapTasks, allTasks, kanbanProject?.id, project.id])
    const knownCodexTaskNodes = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of allMindMapTasks) map.set(task.id, task)
        for (const task of kanbanTaskNodes) map.set(task.id, task)
        return Array.from(map.values())
    }, [allMindMapTasks, kanbanTaskNodes])
    const repoScopedCodexTaskNodes = useMemo(() => {
        const map = new Map<string, Task>()
        const source = allTasks.length > 0 ? allTasks : allMindMapTasks
        for (const task of source) {
            if (task.deleted_at == null) map.set(task.id, task)
        }
        for (const task of allMindMapTasks) map.set(task.id, task)
        return Array.from(map.values())
    }, [allMindMapTasks, allTasks])
    const repoScopedTasksById = useMemo(
        () => new Map(repoScopedCodexTaskNodes.map(task => [task.id, task])),
        [repoScopedCodexTaskNodes],
    )
    const projectById = useMemo(() => new Map(kanbanProjects.map(candidate => [candidate.id, candidate])), [kanbanProjects])
    const fallbackSourceTasksByIdForCodex = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of repoScopedCodexTaskNodes) map.set(task.id, task)
        for (const task of knownCodexTaskNodes) map.set(task.id, task)
        return map
    }, [knownCodexTaskNodes, repoScopedCodexTaskNodes])
    const kanbanSourceTasksById = useMemo(() => new Map(kanbanTaskNodes.map(task => [task.id, task])), [kanbanTaskNodes])
    const codexSourceTaskIds = useMemo(() => Array.from(fallbackSourceTasksByIdForCodex.keys()).filter(Boolean), [fallbackSourceTasksByIdForCodex])
    const memoAiTasks = useMemoAiTasks({ sourceTaskIds: codexSourceTaskIds })
    const bySourceId = memoAiTasks.bySourceId ?? emptyAiTaskMap
    const getMemoAiTaskBySourceId = memoAiTasks.getBySourceId
    const refreshMemoAiTaskStatus = memoAiTasks.refreshStatus
    const getBySourceId = useCallback((sourceId: string) => (
        getMemoAiTaskBySourceId?.(sourceId) ?? null
    ), [getMemoAiTaskBySourceId])

    const taskProgressFixtureTasks = useMemo<TaskProgressSnapshotTask[] | undefined>(() => {
        if (!taskProgressFixtureEnabled) return undefined
        const now = new Date().toISOString()
        return allMindMapTasks.slice(0, TASK_PROGRESS_FIXTURE_STATUSES.length).map((task, index) => {
            const status = TASK_PROGRESS_FIXTURE_STATUSES[index] ?? "running"
            return {
                id: `fixture:${task.id}`,
                title: task.title,
                status,
                executor: "codex_app",
                codex_thread_id: `fixture-mobile-thread-${index + 1}`,
                current_step: status === "running" ? "スマホ幅の進捗表示を確認中" : status === "awaiting_approval" ? "確認待ちです" : null,
                progress_percent: status === "running" ? 58 : status === "completed" ? 100 : null,
                summary: status === "failed" ? "検証でエラーがあります" : "Codex監視snapshotの表示確認",
                updated_at: now,
                source_type: "mindmap",
                source_id: task.id,
            }
        })
    }, [allMindMapTasks, taskProgressFixtureEnabled])
    const taskProgressActivityHintKey = useMemo(() => {
        const activeKeys: string[] = []
        for (const task of bySourceId.values()) {
            if (task.executor !== "codex" && task.executor !== "codex_app") continue
            if (!TASK_PROGRESS_ACTIVITY_HINT_STATUSES.has(task.status)) continue
            const result = task.result && typeof task.result === "object" && !Array.isArray(task.result)
                ? task.result as Record<string, unknown>
                : {}
            const lastActivityAt = typeof result.last_activity_at === "string" ? result.last_activity_at : ""
            activeKeys.push(`${task.id}:${task.status}:${task.started_at ?? ""}:${task.completed_at ?? ""}:${lastActivityAt}`)
        }
        return activeKeys.length > 0 ? activeKeys.sort().join("|") : null
    }, [bySourceId])

    const {
        tasks: taskProgressTasks,
        getById: getTaskProgressById,
        pollIntervalMs: taskProgressPollIntervalMs,
        isLoading: isTaskProgressSnapshotLoading,
        error: taskProgressSnapshotError,
        refresh: refreshTaskProgressSnapshot,
    } = useTaskProgressSnapshot({
        detailOpen: !!taskProgressPanelTaskId,
        activityHintKey: taskProgressActivityHintKey,
        fixtureTasks: taskProgressFixtureTasks,
    })
    const [isRefreshingTaskProgressSnapshot, setIsRefreshingTaskProgressSnapshot] = useState(false)
    const handleRefreshTaskProgressSnapshot = useCallback(async () => {
        setIsRefreshingTaskProgressSnapshot(true)
        try {
            await refreshTaskProgressSnapshot()
        } finally {
            setIsRefreshingTaskProgressSnapshot(false)
        }
    }, [refreshTaskProgressSnapshot])
    const codexArchiveRequestTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
    const codexCompletionSyncInFlightRef = useRef(new Map<string, Promise<void>>())
    const codexCompletionLastSyncRef = useRef(new Map<string, { status: string; syncedAt: number }>())
    const taskStatusByIdRef = useRef(new Map<string, string | null | undefined>())
    useEffect(() => {
        const next = new Map<string, string | null | undefined>()
        for (const task of knownCodexTaskNodes) next.set(task.id, task.status)
        taskStatusByIdRef.current = next
    }, [knownCodexTaskNodes])
    useEffect(() => {
        const timers = codexArchiveRequestTimersRef.current
        return () => {
            for (const timer of timers.values()) clearTimeout(timer)
            timers.clear()
        }
    }, [])
    const clearCodexArchiveRequestTimer = useCallback((taskId: string) => {
        const timer = codexArchiveRequestTimersRef.current.get(taskId)
        if (!timer) return
        clearTimeout(timer)
        codexArchiveRequestTimersRef.current.delete(taskId)
    }, [])
    const scheduleCodexArchiveRequest = useCallback((taskId: string, aiTask: AiTask) => {
        clearCodexArchiveRequestTimer(taskId)
        const timer = setTimeout(() => {
            codexArchiveRequestTimersRef.current.delete(taskId)
            if (taskStatusByIdRef.current.get(taskId) !== "done") return
            void requestCodexThreadArchiveFromNode(aiTask)
                .then((requested) => requested
                    ? Promise.all([refreshMemoAiTaskStatus(), refreshTaskProgressSnapshot()]).then(() => undefined)
                    : undefined)
                .catch((error) => {
                    console.error("[MobileMindMap] Failed to request Codex thread archive from node status:", error)
                })
        }, CODEX_SOURCE_TASK_ARCHIVE_GRACE_MS)
        codexArchiveRequestTimersRef.current.set(taskId, timer)
    }, [clearCodexArchiveRequestTimer, refreshMemoAiTaskStatus, refreshTaskProgressSnapshot])
    const syncCodexSourceTaskCompletion = useCallback(async (taskId: string, status: string) => {
        if (status !== "done" && status !== "todo") return

        const aiTask = bySourceId.get(taskId)
        if (!aiTask || (aiTask.executor !== "codex" && aiTask.executor !== "codex_app")) return

        const now = Date.now()
        const lastSync = codexCompletionLastSyncRef.current.get(taskId)
        if (lastSync?.status === status && now - lastSync.syncedAt < 2_000) return

        const syncKey = `${taskId}:${status}`
        const inFlight = codexCompletionSyncInFlightRef.current.get(syncKey)
        if (inFlight) {
            await inFlight
            return
        }

        clearCodexArchiveRequestTimer(taskId)
        const syncPromise = (async () => {
            try {
                await setCodexSourceTaskCompletionFromNode(aiTask, status === "done")
                codexCompletionLastSyncRef.current.set(taskId, { status, syncedAt: Date.now() })
                if (status === "done") scheduleCodexArchiveRequest(taskId, aiTask)
                await Promise.all([
                    refreshMemoAiTaskStatus(),
                    refreshTaskProgressSnapshot(),
                ])
            } catch (error) {
                console.error("[MobileMindMap] Failed to update Codex completion from node status:", error)
            } finally {
                codexCompletionSyncInFlightRef.current.delete(syncKey)
            }
        })()
        codexCompletionSyncInFlightRef.current.set(syncKey, syncPromise)
        await syncPromise
    }, [bySourceId, clearCodexArchiveRequestTimer, refreshMemoAiTaskStatus, refreshTaskProgressSnapshot, scheduleCodexArchiveRequest])
    useEffect(() => {
        const handleLinkedTaskStatus = (event: Event) => {
            const detail = (event as CustomEvent<{ taskId?: unknown; status?: unknown }>).detail
            const taskId = typeof detail?.taskId === "string" ? detail.taskId : null
            const status = typeof detail?.status === "string" ? detail.status : null
            if (!taskId || !status) return
            void syncCodexSourceTaskCompletion(taskId, status)
        }
        window.addEventListener(LINKED_TASK_STATUS_EVENT, handleLinkedTaskStatus)
        return () => window.removeEventListener(LINKED_TASK_STATUS_EVENT, handleLinkedTaskStatus)
    }, [syncCodexSourceTaskCompletion])
    const updateTaskForCodexScope = useCallback(async (taskId: string, updates: Partial<Task>) => {
        const task = fallbackSourceTasksByIdForCodex.get(taskId)
        const update = task?.project_id && task.project_id !== project.id
            ? onKanbanUpdateTask ?? onUpdateTask
            : onUpdateTask ?? onKanbanUpdateTask
        if (!update) return
        await update(taskId, updates)
    }, [fallbackSourceTasksByIdForCodex, onKanbanUpdateTask, onUpdateTask, project.id])

    const setTaskCollapsed = useCallback((taskId: string, collapsed: boolean) => {
        setTaskCollapsedState(taskId, collapsed)

        void updateTaskForCodexScope(taskId, { mindmap_collapsed: collapsed }).catch(error => {
            console.error("[MobileMindMap] Failed to persist collapsed state:", error)
        })
    }, [setTaskCollapsedState, updateTaskForCodexScope])

    const handleUpdateTaskStatus = useCallback(async (taskId: string, status: string) => {
        await updateTaskForCodexScope(taskId, { status })
        await syncCodexSourceTaskCompletion(taskId, status)
    }, [syncCodexSourceTaskCompletion, updateTaskForCodexScope])
    const handleGenerateHeadingFromLongNode = useCallback(async (taskId: string) => {
        if (!onUpdateTask) return
        if (generatingHeadingNodeIds.has(taskId)) return

        const targetTask = taskMap.get(taskId)
        if (!targetTask) return

        const { detail, pendingHeading } = buildLongNodeHeadingPayload(targetTask.title, targetTask.memo)
        if (!detail) return

        setGeneratingHeadingNodeIds(prev => {
            const next = new Set(prev)
            next.add(taskId)
            return next
        })

        try {
            await onUpdateTask(taskId, {
                title: pendingHeading,
                memo: detail,
            })

            const res = await fetch("/api/ai/generate-memo-heading", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ detail, currentHeading: pendingHeading }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                throw new Error(typeof data.error === "string" ? data.error : "見出し生成に失敗しました")
            }

            const heading = typeof data.heading === "string" ? data.heading.trim() : ""
            if (!heading) throw new Error("見出し生成に失敗しました")

            await onUpdateTask(taskId, {
                title: heading,
                memo: detail,
            })
        } catch (error) {
            console.error("[MobileMindMap] Failed to generate heading from long node:", error)
        } finally {
            setGeneratingHeadingNodeIds(prev => {
                const next = new Set(prev)
                next.delete(taskId)
                return next
            })
        }
    }, [generatingHeadingNodeIds, onUpdateTask, taskMap])
    const taskProgressFallbackTasks = useMemo(() => {
        if (taskProgressFixtureEnabled) return []
        const fallbackTasks: TaskProgressSnapshotTask[] = []
        for (const [sourceId, aiTask] of bySourceId.entries()) {
            const sourceTask = fallbackSourceTasksByIdForCodex.get(sourceId)
            if (!sourceTask) continue
            const fallbackTask = aiTaskToTaskProgressFallback(aiTask, {
                id: sourceId,
                title: sourceTask.title,
            })
            if (fallbackTask) fallbackTasks.push(fallbackTask)
        }
        return fallbackTasks
    }, [bySourceId, fallbackSourceTasksByIdForCodex, taskProgressFixtureEnabled])
    const taskProgressDisplayTasks = useMemo(() => {
        const merged = new Map<string, TaskProgressSnapshotTask>()
        for (const task of taskProgressFallbackTasks) merged.set(task.id, task)
        for (const task of taskProgressTasks) merged.set(task.id, task)
        return hydrateTaskProgressMindMapSources(Array.from(merged.values()), bySourceId)
    }, [bySourceId, taskProgressFallbackTasks, taskProgressTasks])

    const codexRunByNodeId = useMemo(() => {
        const result: Record<string, { state: CodexTaskUiStateName; taskId: string; label: string; lastActivityAt?: string | null; updatedAt?: string | null }> = {}
        for (const task of fallbackSourceTasksByIdForCodex.values()) {
            const aiTask = getBySourceId(task.id)
            const uiState = getCodexTaskUiState(aiTask)
            if (!aiTask || !uiState) continue
            const aiResult = aiTask.result && typeof aiTask.result === "object" && !Array.isArray(aiTask.result)
                ? aiTask.result as Record<string, unknown>
                : {}
            const lastActivityAt = typeof aiResult.last_activity_at === "string" ? aiResult.last_activity_at : null
            result[task.id] = {
                state: uiState.state,
                taskId: aiTask.id,
                label: uiState.label,
                lastActivityAt,
                updatedAt: lastActivityAt ?? aiTask.completed_at ?? aiTask.started_at ?? aiTask.created_at,
            }
        }
        return result
    }, [fallbackSourceTasksByIdForCodex, getBySourceId])

    const taskProgressByNodeId = useMemo(() => {
        const result: Record<string, TaskProgressSnapshotTask> = {}
        const snapshotByAiTaskId = new Map(taskProgressDisplayTasks.map(task => [task.id, task]))
        for (const progressTask of taskProgressDisplayTasks) {
            if (progressTask.source_type === "mindmap" && progressTask.source_id && fallbackSourceTasksByIdForCodex.has(progressTask.source_id)) {
                result[progressTask.source_id] = progressTask
            }
        }
        for (const task of fallbackSourceTasksByIdForCodex.values()) {
            if (result[task.id]) continue
            const aiTask = getBySourceId(task.id)
            const progressTask = aiTask ? snapshotByAiTaskId.get(aiTask.id) : null
            if (progressTask) result[task.id] = progressTask
        }
        return result
    }, [fallbackSourceTasksByIdForCodex, getBySourceId, taskProgressDisplayTasks])

    const codexInboxGroupIds = useMemo(() => {
        const ids = new Set<string>()
        for (const task of repoScopedCodexTaskNodes) {
            if (task.deleted_at != null) continue
            if (task.source === "codex_inbox" || task.title === "Codex Inbox") ids.add(task.id)
        }
        return ids
    }, [repoScopedCodexTaskNodes])

    const codexChatImportItems = useMemo<TaskProgressImportItem[]>(() => {
        if (!selectedCodexImportRepoPath) return []

        return repoScopedCodexTaskNodes
            .filter(task => task.source === "codex_app_thread" && task.deleted_at == null)
            .filter(task => !hiddenCodexChatImportIds.has(task.id))
            .flatMap(task => {
                const placedTask = applyOptimisticCodexPlacement(task)
                const progressTask = taskProgressByNodeId[task.id]
                const codexRun = codexRunByNodeId[task.id]
                const aiTask = getBySourceId(task.id)
                const taskProject = task.project_id ? projectById.get(task.project_id) ?? null : null
                if (!codexThreadMatchesSelectedRepo(task, aiTask, taskProject, selectedCodexImportRepoPath)) return []
                if (progressTask && getCodexMonitorUiStatus(progressTask.status) === "unsent") return []
                if (codexRun?.state === "prompt_waiting") return []
                const parentTask = placedTask.parent_task_id ? repoScopedTasksById.get(placedTask.parent_task_id) ?? taskMap.get(placedTask.parent_task_id) ?? null : null
                const placed = !placedTask.parent_task_id || !codexInboxGroupIds.has(placedTask.parent_task_id)
                const placementLabel = placed
                    ? `配置済み: ${parentTask?.title?.trim() || "プロジェクト直下"}`
                    : "未配置"
                const updatedAt = codexThreadImportActivityAt({ task, aiTask, progressTask, codexRun })
                const visualStatus = progressTask?.status ?? codexRun?.state ?? null
                return [{
                    id: task.id,
                    aiTaskId: progressTask?.id ?? codexRun?.taskId ?? aiTask?.id ?? null,
                    title: task.title,
                    snippet: codexThreadPromptPreviewFromMemo(task.memo),
                    repoPath: task.codex_work_dir?.trim() || null,
                    threadId: task.codex_thread_id?.trim() || null,
                    status: visualStatus,
                    statusLabel: codexChatImportStatusLabel(
                        visualStatus,
                        progressTask ? codexMonitorUiLabel(progressTask.status) : codexRun?.label,
                    ),
                    placementLabel,
                    placed,
                    updatedLabel: formatChatImportUpdatedLabel(updatedAt),
                    updatedAtIso: updatedAt,
                }]
            })
            .sort((a, b) => {
                const taskA = repoScopedTasksById.get(a.id)
                const taskB = repoScopedTasksById.get(b.id)
                return (taskB?.updated_at ?? "").localeCompare(taskA?.updated_at ?? "")
            })
    }, [
        codexInboxGroupIds,
        codexRunByNodeId,
        applyOptimisticCodexPlacement,
        getBySourceId,
        hiddenCodexChatImportIds,
        projectById,
        repoScopedCodexTaskNodes,
        repoScopedTasksById,
        selectedCodexImportRepoPath,
        taskMap,
        taskProgressByNodeId,
    ])

    const mobileImportRepoOptions = useMemo<TaskProgressImportRepoOption[]>(() => {
        const map = new Map<string, TaskProgressImportRepoOption>()
        const put = (pathValue: string | null | undefined, labelValue?: string | null, sourceLabel?: string | null) => {
            const path = normalizeRepoPath(pathValue)
            if (!path) return
            const existing = map.get(path)
            const label = labelValue?.trim() || repoNameFromPath(path) || path
            if (existing) {
                if (!existing.sourceLabel && sourceLabel) {
                    map.set(path, { ...existing, sourceLabel })
                }
                return
            }
            map.set(path, {
                id: path,
                path,
                label,
                sourceLabel: sourceLabel ?? null,
            })
        }

        for (const repo of availableRepos.filter(repo => repo.source === "codex")) {
            put(repo.absolute_path, repo.display_name, repo.hostname)
        }
        put(selectedCodexImportRepoPath, repoNameFromPath(selectedCodexImportRepoPath), "選択中")

        return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "ja"))
    }, [availableRepos, selectedCodexImportRepoPath])

    const selectedCodexImportRepoLabel = useMemo(() => {
        if (!selectedCodexImportRepoPath) return null
        return mobileImportRepoOptions.find(option => option.path === selectedCodexImportRepoPath)?.label ||
            repoNameFromPath(selectedCodexImportRepoPath) ||
            selectedCodexImportRepoPath
    }, [mobileImportRepoOptions, selectedCodexImportRepoPath])

    const taskProgressPanelTask = useMemo(() => {
        if (!taskProgressPanelTaskId) return null
        return getTaskProgressById(taskProgressPanelTaskId) ??
            taskProgressDisplayTasks.find(task => task.id === taskProgressPanelTaskId) ??
            (taskProgressPanelTaskOverride?.id === taskProgressPanelTaskId ? taskProgressPanelTaskOverride : null)
    }, [getTaskProgressById, taskProgressDisplayTasks, taskProgressPanelTaskId, taskProgressPanelTaskOverride])

    const handleOpenTaskProgress = useCallback((task: TaskProgressSnapshotTask) => {
        setTaskProgressPanelTaskOverride(task)
        setTaskProgressPanelTaskId(task.id)
    }, [])

    const codexPanelTask = useMemo(() => {
        if (!codexPanelTaskId) return null
        return fallbackSourceTasksByIdForCodex.get(codexPanelTaskId) ?? null
    }, [codexPanelTaskId, fallbackSourceTasksByIdForCodex])
    const codexPanelProject = useMemo(() => {
        if (!codexPanelTask?.project_id) return project
        return kanbanProjects.find(candidate => candidate.id === codexPanelTask.project_id) ?? project
    }, [codexPanelTask?.project_id, kanbanProjects, project])

    const codexDirCandidates = useMemo(() => {
        const set = new Set<string>()
        const panelRepo = (codexPanelProject.repo_path ?? "").trim()
        if (panelRepo) set.add(panelRepo)
        const repo = (project.repo_path ?? "").trim()
        if (repo) set.add(repo)
        for (const task of knownCodexTaskNodes) {
            const dir = (task.codex_work_dir ?? "").trim()
            if (dir) set.add(dir)
        }
        return Array.from(set)
    }, [codexPanelProject.repo_path, knownCodexTaskNodes, project.repo_path])

    const codexPanelNode = useMemo(() => {
        const task = codexPanelTask
        if (!task) return null
        const aiTask = getBySourceId(task.id)
        const aiResult = aiTask?.result && typeof aiTask.result === "object" && !Array.isArray(aiTask.result)
            ? aiTask.result as Record<string, unknown>
            : {}
        const threadId =
            (typeof aiTask?.codex_thread_id === "string" && aiTask.codex_thread_id.trim()) ||
            (typeof aiResult.codex_thread_id === "string" && aiResult.codex_thread_id.trim()) ||
            ""
        const threadUrlFromResult = typeof aiResult.codex_thread_url === "string" ? aiResult.codex_thread_url.trim() : ""
        return {
            taskId: task.id,
            title: task.title,
            memo: (task.memo ?? "").trim(),
            cwd: task.codex_work_dir ?? null,
            status: task.codex_status ?? null,
            codexThreadUrl: threadId ? `codex://threads/${threadId}` : threadUrlFromResult || null,
            scheduledLabel: task.scheduled_at ? task.scheduled_at.slice(0, 10) : null,
            priority: task.priority ?? null,
            estimatedLabel: task.estimated_time ? `${task.estimated_time}分` : null,
            isDone: task.status === "done",
            hasMemo: !!(task.memo && task.memo.trim()),
        }
    }, [codexPanelTask, getBySourceId])

    const persistCodexDir = useCallback(async (taskId: string, dir: string) => {
        try {
            await updateTaskForCodexScope(taskId, { codex_work_dir: dir })
        } catch {
            // パネル上の選択は維持し、次回保存で復旧できるようにする。
        }
    }, [updateTaskForCodexScope])

    const isDescendant = useCallback((ancestorId: string, childId: string) => {
        let current = taskMap.get(childId)
        const visited = new Set<string>()
        while (current?.parent_task_id && !visited.has(current.parent_task_id)) {
            if (current.parent_task_id === ancestorId) return true
            visited.add(current.parent_task_id)
            current = taskMap.get(current.parent_task_id)
        }
        return false
    }, [taskMap])

    const handleMobileImportDrag = useCallback((event: TaskProgressImportDragEvent) => {
        mobileCodexImportDragSequenceRef.current += 1
        setMobileCodexImportDragEvent({
            sequence: mobileCodexImportDragSequenceRef.current,
            phase: event.phase,
            taskId: event.item.id,
            title: event.item.title,
            snippet: event.item.snippet,
            clientX: event.clientX,
            clientY: event.clientY,
        })
    }, [])

    const handleDropCodexImportNode = useCallback(async ({
        taskId,
        targetId,
        position,
    }: {
        taskId: string
        targetId: string
        position: MobileCustomDropPosition
    }) => {
        if (!onUpdateTask && !onKanbanUpdateTask) return
        const importedTask = repoScopedTasksById.get(taskId) ?? allTasksById.get(taskId) ?? taskMap.get(taskId)
        if (!importedTask) return
        if (taskId === targetId) return

        const targetTask = targetId === "project-root"
            ? null
            : taskMap.get(targetId) ?? allTasksById.get(targetId) ?? null
        if (targetId !== "project-root" && !targetTask) return
        if (targetTask && isDescendant(taskId, targetTask.id)) return

        const parentTaskId = targetId === "project-root"
            ? null
            : position === "as-child"
                ? targetId
                : targetTask?.parent_task_id ?? null

        const updates: Partial<Task> = {
            parent_task_id: parentTaskId,
            project_id: project.id,
        }

        const siblingOrderUpdates = (() => {
            if (!targetTask || position === "as-child") return [] as Array<{ id: string; order_index: number }>
            const candidates = new Map<string, Task>()
            for (const task of allMindMapTasks) {
                if (task?.id) candidates.set(task.id, task)
            }
            const siblings = Array.from(candidates.values())
                .filter(task => task.id !== taskId && (task.parent_task_id ?? null) === parentTaskId)
                .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
            const targetIndex = siblings.findIndex(task => task.id === targetTask.id)
            if (targetIndex < 0) return [] as Array<{ id: string; order_index: number }>
            const insertAt = position === "above" ? targetIndex : targetIndex + 1
            const reordered = [
                ...siblings.slice(0, insertAt),
                { ...importedTask, parent_task_id: parentTaskId },
                ...siblings.slice(insertAt),
            ]
            return reordered.flatMap((task, index) => {
                if (task.id === taskId || (task.order_index ?? 0) !== index) {
                    return [{ id: task.id, order_index: index }]
                }
                return []
            })
        })()
        const importedOrderUpdate = siblingOrderUpdates.find(update => update.id === taskId)
        if (importedOrderUpdate) updates.order_index = importedOrderUpdate.order_index

        if (parentTaskId) setTaskCollapsed(parentTaskId, false)
        setHiddenCodexChatImportIds(prev => {
            const next = new Set(prev)
            next.add(taskId)
            return next
        })
        setOptimisticCodexPlacements(prev => ({
            ...prev,
            [taskId]: {
                parentTaskId,
                projectId: project.id,
            },
        }))

        try {
            await updateTaskForCodexScope(taskId, updates)
            for (const orderUpdate of siblingOrderUpdates) {
                if (orderUpdate.id === taskId) continue
                await updateTaskForCodexScope(orderUpdate.id, { order_index: orderUpdate.order_index })
            }
            setSelectedNodeId(taskId)
            setSelectedNodeIds(new Set([taskId]))
        } catch (error) {
            setHiddenCodexChatImportIds(prev => {
                const next = new Set(prev)
                next.delete(taskId)
                return next
            })
            setOptimisticCodexPlacements(prev => {
                if (!prev[taskId]) return prev
                const next = { ...prev }
                delete next[taskId]
                return next
            })
            console.error("[MobileMindMap] Failed to place imported Codex chat:", error)
        }
    }, [
        allMindMapTasks,
        allTasksById,
        isDescendant,
        onKanbanUpdateTask,
        onUpdateTask,
        project.id,
        repoScopedTasksById,
        setTaskCollapsed,
        taskMap,
        updateTaskForCodexScope,
    ])

    const handleSelectNode = useCallback((nodeId: string | null) => {
        setSelectedNodeId(nodeId)
        setSelectedNodeIds(nodeId && taskMap.has(nodeId) ? new Set([nodeId]) : new Set())
    }, [taskMap])

    const handleSelectNodes = useCallback((nodeIds: string[], primaryNodeId: string | null) => {
        const next = new Set(nodeIds.filter(nodeId => taskMap.has(nodeId)))
        setSelectedNodeIds(next)
        setSelectedNodeId(
            primaryNodeId && (taskMap.has(primaryNodeId) || primaryNodeId === "project-root")
                ? primaryNodeId
                : Array.from(next)[0] ?? null
        )
    }, [taskMap])

    const handleToggleCollapse = useCallback((taskId: string) => {
        setTaskCollapsed(taskId, !collapsedTaskIds.has(taskId))
    }, [collapsedTaskIds, setTaskCollapsed])

    useEffect(() => {
        if (!pendingEditNodeId) return
        if (pendingEditNodeId !== "project-root" && !taskMap.has(pendingEditNodeId)) return
        const timer = window.setTimeout(() => setPendingEditNodeId(null), 1800)
        return () => window.clearTimeout(timer)
    }, [pendingEditNodeId, taskMap])

    const selectSingleTask = useCallback((taskId: string | null) => {
        setSelectedNodeId(taskId)
        setSelectedNodeIds(taskId && taskId !== "project-root" ? new Set([taskId]) : new Set())
    }, [])

    useEffect(() => {
        if (!focusEditNodeId) {
            handledFocusEditNodeIdRef.current = null
            return
        }
        if (handledFocusEditNodeIdRef.current === focusEditNodeId) return
        if (focusEditNodeId !== "project-root" && !taskMap.has(focusEditNodeId)) return

        let cancelled = false
        const nodeId = focusEditNodeId
        void Promise.resolve().then(() => {
            if (cancelled) return
            handledFocusEditNodeIdRef.current = nodeId
            setPendingEditNodeId(nodeId)
            if (nodeId === "project-root") {
                setSelectedNodeId("project-root")
                setSelectedNodeIds(new Set())
            } else {
                selectSingleTask(nodeId)
            }
        })
        return () => {
            cancelled = true
        }
    }, [focusEditNodeId, selectSingleTask, taskMap])

    const findRootTaskId = useCallback((taskId: string) => {
        let current = taskMap.get(taskId)
        const visited = new Set<string>()
        while (current?.parent_task_id && !visited.has(current.parent_task_id)) {
            visited.add(current.parent_task_id)
            current = taskMap.get(current.parent_task_id)
        }
        return current?.id ?? taskId
    }, [taskMap])

    const calculateDeleteFocus = useCallback((taskId: string): string => {
        const task = taskMap.get(taskId)
        if (!task) return "project-root"

        if (!task.parent_task_id) {
            const roots = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
            const index = roots.findIndex(root => root.id === taskId)
            return roots[index + 1]?.id ?? roots[index - 1]?.id ?? "project-root"
        }

        const siblings = tasks
            .filter(candidate => candidate.parent_task_id === task.parent_task_id)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        const index = siblings.findIndex(sibling => sibling.id === taskId)
        return siblings[index + 1]?.id ?? siblings[index - 1]?.id ?? task.parent_task_id
    }, [groups, taskMap, tasks])

    const handleAddRootNode = useCallback(async () => {
        if (!onCreateGroup) return
        const newTask = await onCreateGroup("")
        if (!newTask?.id) return
        setPendingEditNodeId(newTask.id)
        selectSingleTask(newTask.id)
    }, [onCreateGroup, selectSingleTask])

    const handleAddChildNode = useCallback(async (parentTaskId: string) => {
        if (!onCreateTask) return
        setTaskCollapsed(parentTaskId, false)

        const newTask = await onCreateTask(findRootTaskId(parentTaskId), "", parentTaskId)
        if (!newTask?.id) return
        setPendingEditNodeId(newTask.id)
        selectSingleTask(newTask.id)
    }, [findRootTaskId, onCreateTask, selectSingleTask, setTaskCollapsed])

    const handleAddSiblingNode = useCallback(async (taskId: string) => {
        const task = taskMap.get(taskId)
        if (!task) return

        if (!task.parent_task_id) {
            if (!onCreateGroup) return
            const newTask = await onCreateGroup("")
            if (!newTask?.id) return
            setPendingEditNodeId(newTask.id)
            selectSingleTask(newTask.id)
            void (async () => {
                await onReorderTask?.(newTask.id, taskId, "below")
            })().catch(error => {
                console.error("[MobileMindMap] Failed to reorder root sibling after create:", error)
            })
            return
        }

        if (!onCreateTask) return
        const newTask = await onCreateTask(findRootTaskId(task.parent_task_id), "", task.parent_task_id)
        if (!newTask?.id) return
        setPendingEditNodeId(newTask.id)
        selectSingleTask(newTask.id)
        void (async () => {
            await onReorderTask?.(newTask.id, taskId, "below")
        })().catch(error => {
            console.error("[MobileMindMap] Failed to reorder sibling after create:", error)
        })
    }, [findRootTaskId, onCreateGroup, onCreateTask, onReorderTask, selectSingleTask, taskMap])

    const handlePromoteNode = useCallback(async (taskId: string) => {
        if (!onUpdateTask) return
        const task = taskMap.get(taskId)
        if (!task?.parent_task_id) return

        const parent = taskMap.get(task.parent_task_id)
        if (!parent) return

        if (parent.parent_task_id) {
            await onUpdateTask(taskId, { parent_task_id: parent.parent_task_id })
        } else {
            await onUpdateTask(taskId, { parent_task_id: null, project_id: project.id })
        }
        selectSingleTask(taskId)
    }, [onUpdateTask, project.id, selectSingleTask, taskMap])

    const handleDeleteNode = useCallback(async (taskId: string) => {
        const task = taskMap.get(taskId)
        if (!task) return

        const fallbackFocusId = calculateDeleteFocus(taskId)
        setPendingEditNodeId(fallbackFocusId)
        if (fallbackFocusId === "project-root") {
            setSelectedNodeId("project-root")
            setSelectedNodeIds(new Set())
        } else {
            selectSingleTask(fallbackFocusId)
        }

        void (async () => {
            if (!task.parent_task_id) {
                await onDeleteGroup?.(taskId)
            } else {
                await onDeleteTask?.(taskId)
            }
        })().catch(error => {
            console.error("[MobileMindMap] Failed to delete node:", error)
        })
    }, [calculateDeleteFocus, onDeleteGroup, onDeleteTask, selectSingleTask, taskMap])

    const collectCodexImportTaskTreeIds = useCallback((taskId: string) => {
        const childrenByParent = new Map<string, Task[]>()
        for (const task of repoScopedTasksById.values()) {
            if (!task.parent_task_id) continue
            const children = childrenByParent.get(task.parent_task_id) ?? []
            children.push(task)
            childrenByParent.set(task.parent_task_id, children)
        }
        const ids = [taskId]
        const collect = (parentId: string) => {
            for (const child of childrenByParent.get(parentId) ?? []) {
                ids.push(child.id)
                collect(child.id)
            }
        }
        collect(taskId)
        return ids
    }, [repoScopedTasksById])

    const handleDeleteTaskFromKanban = useCallback(async (taskId: string) => {
        const sourceTask = fallbackSourceTasksByIdForCodex.get(taskId)
        const hiddenIds = collectCodexImportTaskTreeIds(taskId)
        setHiddenCodexChatImportIds(prev => {
            const next = new Set(prev)
            for (const id of hiddenIds) next.add(id)
            return next
        })

        try {
            if (sourceTask?.project_id && sourceTask.project_id !== project.id && onKanbanDeleteTask) {
                await onKanbanDeleteTask(taskId)
                return
            }
            if (sourceTask && !sourceTask.parent_task_id && onDeleteGroup) {
                await onDeleteGroup(taskId)
                return
            }
            if (sourceTask && onDeleteTask) {
                await onDeleteTask(taskId)
                return
            }
            await handleDeleteNode(taskId)
        } catch (error) {
            setHiddenCodexChatImportIds(prev => {
                const next = new Set(prev)
                for (const id of hiddenIds) next.delete(id)
                return next
            })
            console.error("[MobileMindMap] Failed to delete Codex task:", error)
        }
    }, [
        collectCodexImportTaskTreeIds,
        fallbackSourceTasksByIdForCodex,
        handleDeleteNode,
        onDeleteGroup,
        onDeleteTask,
        onKanbanDeleteTask,
        project.id,
    ])

    const handleSaveTitle = useCallback(async (taskId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed || !onUpdateTask) return
        await onUpdateTask(taskId, { title: trimmed })
    }, [onUpdateTask])

    const handleSaveProjectTitle = useCallback(async (title: string) => {
        const trimmed = title.trim()
        if (!trimmed || !onUpdateProject) return
        await onUpdateProject(project.id, trimmed)
    }, [onUpdateProject, project.id])

    const handleMoveTask = useCallback(async ({
        taskId,
        targetId,
        position,
    }: {
        taskId: string
        targetId: string
        position: MobileCustomDropPosition
    }) => {
        const draggedTask = taskMap.get(taskId)
        if (!draggedTask || taskId === targetId) return

        if (targetId === "project-root") {
            if (!onUpdateTask) return
            if (!draggedTask.parent_task_id && draggedTask.project_id === project.id) return
            await onUpdateTask(taskId, { parent_task_id: null, project_id: project.id })
            return
        }

        if (isDescendant(taskId, targetId)) return
        const targetTask = taskMap.get(targetId)
        if (!targetTask) return

        const draggedIsRoot = groups.some(group => group.id === taskId)

        if (position === "as-child") {
            if (!onUpdateTask) return

            if (draggedTask.parent_task_id === targetTask.id) {
                await onReorderTask?.(draggedTask.id, targetTask.id, "below")
                return
            }

            setTaskCollapsed(targetTask.id, false)

            const updates: Partial<Task> = { parent_task_id: targetTask.id }
            if (draggedIsRoot) updates.project_id = null
            await onUpdateTask(draggedTask.id, updates)
            return
        }

        if (!onReorderTask) return
        await onReorderTask(draggedTask.id, targetTask.id, position)

        if (!onUpdateTask) return
        const nextParentId = targetTask.parent_task_id ?? null
        if (nextParentId === null && draggedTask.project_id !== project.id) {
            await onUpdateTask(draggedTask.id, { project_id: project.id })
        } else if (nextParentId !== null && draggedIsRoot) {
            await onUpdateTask(draggedTask.id, { project_id: null })
        }
    }, [groups, isDescendant, onReorderTask, onUpdateTask, project.id, setTaskCollapsed, taskMap])

    return (
        <>
            <CustomMindMapView
                project={project}
                groups={visibleMapGroups}
                tasks={visibleMapTasks}
                isMobile
                collapsedTaskIds={collapsedTaskIds}
                selectedNodeId={selectedNodeId}
                selectedNodeIds={selectedNodeIds}
                onSelectNode={handleSelectNode}
                onSelectNodes={handleSelectNodes}
                onToggleCollapse={handleToggleCollapse}
                pendingEditNodeId={pendingEditNodeId}
                onAddRootNode={handleAddRootNode}
                onAddChildNode={handleAddChildNode}
                onAddSiblingNode={handleAddSiblingNode}
                onPromoteNode={handlePromoteNode}
                onDeleteNode={handleDeleteNode}
                onSaveTitle={handleSaveTitle}
                onSaveProjectTitle={handleSaveProjectTitle}
                onUpdateStatus={handleUpdateTaskStatus}
                onUpdateScheduledAt={(taskId, scheduledAt) => onUpdateTask?.(taskId, { scheduled_at: scheduledAt })}
                onUpdateSchedule={(taskId, params) => onUpdateTask?.(taskId, {
                    scheduled_at: params.scheduledAt,
                    estimated_time: params.estimatedMinutes,
                    calendar_id: params.calendarId,
                })}
                onResizeNode={onUpdateTask ? (taskId, width) => onUpdateTask(taskId, { node_width: width }) : undefined}
                onGenerateHeadingFromLongNode={handleGenerateHeadingFromLongNode}
                generatingHeadingNodeIds={generatingHeadingNodeIds}
                onRunCodex={(taskId) => setCodexPanelTaskId(taskId)}
                codexRunByNodeId={codexRunByNodeId}
                codexThreadImportEnabled={selectedRepoImportEnabled}
                codexThreadImportAvailable={!!selectedCodexImportRepoPath}
                codexThreadImportPending={isCodexThreadImportSaving}
                codexThreadImportRepoPath={selectedCodexImportRepoPath || null}
                onToggleCodexThreadImport={toggleSelectedRepoImport}
                taskProgressByNodeId={taskProgressByNodeId}
                onOpenTaskProgress={handleOpenTaskProgress}
                onMoveTask={handleMoveTask}
                importedChatDragTitle={mobileCodexImportDragEvent?.phase === "start" || mobileCodexImportDragEvent?.phase === "move"
                    ? mobileCodexImportDragEvent.title ?? null
                    : null}
                mobileImportedChatDragEvent={mobileCodexImportDragEvent}
                onDropImportedChatNode={handleDropCodexImportNode}
            />
            <TaskProgressKanban
                tasks={taskProgressDisplayTasks}
                sourceTasksById={kanbanSourceTasksById}
                spaces={spaces}
                projects={kanbanProjects}
                selectedSpaceId={kanbanSpaceId}
                selectedProjectId={kanbanProject?.id ?? kanbanProjectId}
                onSelectSpace={setKanbanSpaceId}
                onSelectProject={setKanbanProjectId}
                isMobile
                isLoading={isTaskProgressSnapshotLoading}
                isRefreshing={isRefreshingTaskProgressSnapshot}
                error={taskProgressSnapshotError}
                pollIntervalMs={taskProgressPollIntervalMs}
                onRefresh={handleRefreshTaskProgressSnapshot}
                onOpenTask={handleOpenTaskProgress}
                onRunSourceTask={(taskId) => setCodexPanelTaskId(taskId)}
                onToggleSourceTaskComplete={(taskId, done) => { void handleUpdateTaskStatus(taskId, done ? "done" : "todo") }}
                onDeleteSourceTask={(taskId) => { void handleDeleteTaskFromKanban(taskId) }}
                mobileOpenSignal={codexOpenSignal}
                mobileTriggerVisible={false}
                mobileImportItems={codexChatImportItems}
                mobileImportRepoControl={{
                    selectedRepoPath: selectedCodexImportRepoPath || null,
                    selectedRepoLabel: selectedCodexImportRepoLabel,
                    importEnabled: selectedRepoImportEnabled,
                    importOwnerLabel: selectedRepoImportOwnerLabel,
                    importPending: isCodexThreadImportSaving,
                    repoOptions: mobileImportRepoOptions,
                    repoOptionsLoading: isAvailableReposLoading,
                    repoError: availableReposError,
                    onSelectRepoPath: selectCodexImportRepoPath,
                    onToggleImport: toggleSelectedRepoImport,
                    onRefreshRepos: handleRefreshAvailableRepos,
                }}
                onMobileImportDrag={handleMobileImportDrag}
            />
            <TaskProgressDetailPanel
                open={!!taskProgressPanelTask}
                task={taskProgressPanelTask}
                isMobile
                onOpenChange={(open) => {
                    if (!open) {
                        setTaskProgressPanelTaskId(null)
                        setTaskProgressPanelTaskOverride(null)
                    }
                }}
            />
            {codexPanelNode && (
                <CodexNodePanel
                    open
                    node={codexPanelNode}
                    candidates={codexDirCandidates}
                    onClose={() => setCodexPanelTaskId(null)}
                    onPersistDir={persistCodexDir}
                    onSaveHeading={(taskId, heading) => updateTaskForCodexScope(taskId, { title: heading })}
                    onSaveDraft={(taskId, draft) => updateTaskForCodexScope(taskId, { title: draft.title, memo: draft.memo })}
                    onSaveTaskDetails={(taskId, updates) => updateTaskForCodexScope(taskId, updates)}
                    onOpenMemo={onOpenLinkedMemos}
                    onToggleComplete={(taskId, done) => { void handleUpdateTaskStatus(taskId, done ? "done" : "todo") }}
                    onAddChild={(taskId) => { void handleAddChildNode(taskId) }}
                    onDelete={(taskId) => { void handleDeleteNode(taskId) }}
                />
            )}
        </>
    )
}
