"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { CodexNodePanel } from "@/components/codex/codex-node-panel"
import { CustomMindMapView } from "@/components/mindmap/custom-mind-map-view"
import { getCodexTaskUiState, type CodexRunState } from "@/lib/codex-run-state"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import type { Project, Task } from "@/types/database"

type MobileCustomDropPosition = "above" | "below" | "as-child"

interface MobileMindMapProps {
    project: Project
    projects?: Project[]
    groups: Task[]
    tasks: Task[]
    onCreateGroup?: (title: string) => Promise<Task | null>
    onDeleteGroup?: (groupId: string) => Promise<void>
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onReorderTask?: (taskId: string, referenceTaskId: string, position: "above" | "below") => Promise<void>
    onOpenLinkedMemos?: (taskId: string) => void
}

export function MobileMindMap({
    project,
    groups,
    tasks,
    onCreateGroup,
    onDeleteGroup,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
    onReorderTask,
    onOpenLinkedMemos,
}: MobileMindMapProps) {
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set())
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
    const [pendingEditNodeId, setPendingEditNodeId] = useState<string | null>(null)
    const [codexPanelTaskId, setCodexPanelTaskId] = useState<string | null>(null)
    const { getBySourceId } = useMemoAiTasks()

    const taskMap = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of [...groups, ...tasks]) {
            if (task?.id) map.set(task.id, task)
        }
        return map
    }, [groups, tasks])
    const allMindMapTasks = useMemo(() => [...groups, ...tasks], [groups, tasks])

    const codexRunByNodeId = useMemo(() => {
        const result: Record<string, { state: CodexRunState; taskId: string; label: string; lastActivityAt?: string | null }> = {}
        for (const task of allMindMapTasks) {
            const aiTask = getBySourceId(task.id)
            const uiState = getCodexTaskUiState(aiTask)
            if (!aiTask || !uiState) continue
            const aiResult = aiTask.result && typeof aiTask.result === "object" && !Array.isArray(aiTask.result)
                ? aiTask.result as Record<string, unknown>
                : {}
            result[task.id] = {
                state: uiState.state,
                taskId: aiTask.id,
                label: uiState.label,
                lastActivityAt: typeof aiResult.last_activity_at === "string" ? aiResult.last_activity_at : null,
            }
        }
        return result
    }, [allMindMapTasks, getBySourceId])

    const codexDirCandidates = useMemo(() => {
        const set = new Set<string>()
        for (const task of allMindMapTasks) {
            const dir = (task.codex_work_dir ?? "").trim()
            if (dir) set.add(dir)
        }
        const repo = (project.repo_path ?? "").trim()
        if (repo) set.add(repo)
        return Array.from(set)
    }, [allMindMapTasks, project.repo_path])

    const codexPanelNode = useMemo(() => {
        if (!codexPanelTaskId) return null
        const task = taskMap.get(codexPanelTaskId)
        if (!task) return null
        return {
            taskId: task.id,
            title: task.title,
            memo: (task.memo ?? "").trim(),
            cwd: task.codex_work_dir ?? null,
            status: task.codex_status ?? null,
            scheduledLabel: task.scheduled_at ? task.scheduled_at.slice(0, 10) : null,
            priority: task.priority ?? null,
            estimatedLabel: task.estimated_time ? `${task.estimated_time}分` : null,
            isDone: task.status === "done",
            hasMemo: !!(task.memo && task.memo.trim()),
        }
    }, [codexPanelTaskId, taskMap])

    const persistCodexDir = useCallback(async (taskId: string, dir: string) => {
        try {
            await onUpdateTask?.(taskId, { codex_work_dir: dir })
        } catch {
            // パネル上の選択は維持し、次回保存で復旧できるようにする。
        }
    }, [onUpdateTask])

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
        setCollapsedTaskIds(prev => {
            const next = new Set(prev)
            if (next.has(taskId)) next.delete(taskId)
            else next.add(taskId)
            return next
        })
    }, [])

    useEffect(() => {
        if (!pendingEditNodeId) return
        const timer = window.setTimeout(() => setPendingEditNodeId(null), 800)
        return () => window.clearTimeout(timer)
    }, [pendingEditNodeId])

    const selectSingleTask = useCallback((taskId: string | null) => {
        setSelectedNodeId(taskId)
        setSelectedNodeIds(taskId && taskId !== "project-root" ? new Set([taskId]) : new Set())
    }, [])

    const findRootTaskId = useCallback((taskId: string) => {
        let current = taskMap.get(taskId)
        const visited = new Set<string>()
        while (current?.parent_task_id && !visited.has(current.parent_task_id)) {
            visited.add(current.parent_task_id)
            current = taskMap.get(current.parent_task_id)
        }
        return current?.id ?? taskId
    }, [taskMap])

    const calculateNextFocus = useCallback((taskId: string): string | null => {
        const task = taskMap.get(taskId)
        if (!task) return null

        if (!task.parent_task_id) {
            const roots = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
            const index = roots.findIndex(root => root.id === taskId)
            if (index === -1) return "project-root"
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
        setCollapsedTaskIds(prev => {
            if (!prev.has(parentTaskId)) return prev
            const next = new Set(prev)
            next.delete(parentTaskId)
            return next
        })

        const newTask = await onCreateTask(findRootTaskId(parentTaskId), "", parentTaskId)
        if (!newTask?.id) return
        setPendingEditNodeId(newTask.id)
        selectSingleTask(newTask.id)
    }, [findRootTaskId, onCreateTask, selectSingleTask])

    const handleAddSiblingNode = useCallback(async (taskId: string) => {
        const task = taskMap.get(taskId)
        if (!task) return

        if (!task.parent_task_id) {
            await handleAddRootNode()
            return
        }

        if (!onCreateTask) return
        const newTask = await onCreateTask(findRootTaskId(task.parent_task_id), "", task.parent_task_id)
        if (!newTask?.id) return
        setPendingEditNodeId(newTask.id)
        selectSingleTask(newTask.id)
    }, [findRootTaskId, handleAddRootNode, onCreateTask, selectSingleTask, taskMap])

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

        const hasChildren = tasks.some(candidate => candidate.parent_task_id === taskId)
        if (hasChildren && typeof window !== "undefined") {
            const confirmed = window.confirm("子タスクを含むタスクを削除しますか？\nすべての子タスクも削除されます。")
            if (!confirmed) return
        }

        const nextFocusId = calculateNextFocus(taskId)
        if (!task.parent_task_id) {
            await onDeleteGroup?.(taskId)
        } else {
            await onDeleteTask?.(taskId)
        }

        if (nextFocusId === "project-root") {
            setSelectedNodeId("project-root")
            setSelectedNodeIds(new Set())
        } else {
            selectSingleTask(nextFocusId)
        }
    }, [calculateNextFocus, onDeleteGroup, onDeleteTask, selectSingleTask, taskMap, tasks])

    const handleSaveTitle = useCallback(async (taskId: string, title: string) => {
        const trimmed = title.trim()
        if (!trimmed || !onUpdateTask) return
        await onUpdateTask(taskId, { title: trimmed })
    }, [onUpdateTask])

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

            setCollapsedTaskIds(prev => {
                if (!prev.has(targetTask.id)) return prev
                const next = new Set(prev)
                next.delete(targetTask.id)
                return next
            })

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
    }, [groups, isDescendant, onReorderTask, onUpdateTask, project.id, taskMap])

    return (
        <>
            <CustomMindMapView
                project={project}
                groups={groups}
                tasks={tasks}
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
                onUpdateStatus={(taskId, status) => onUpdateTask?.(taskId, { status })}
                onResizeNode={onUpdateTask ? (taskId, width) => onUpdateTask(taskId, { node_width: width }) : undefined}
                onOpenLinkedMemos={onOpenLinkedMemos}
                onRunCodex={(taskId) => setCodexPanelTaskId(taskId)}
                codexRunByNodeId={codexRunByNodeId}
                onMoveTask={handleMoveTask}
            />
            {codexPanelNode && (
                <CodexNodePanel
                    open
                    node={codexPanelNode}
                    candidates={codexDirCandidates}
                    onClose={() => setCodexPanelTaskId(null)}
                    onPersistDir={persistCodexDir}
                    onOpenMemo={onOpenLinkedMemos}
                    onToggleComplete={(taskId, done) => { void onUpdateTask?.(taskId, { status: done ? "done" : "todo" }) }}
                    onAddChild={(taskId) => { void handleAddChildNode(taskId) }}
                    onDelete={(taskId) => { void handleDeleteNode(taskId) }}
                />
            )}
        </>
    )
}
