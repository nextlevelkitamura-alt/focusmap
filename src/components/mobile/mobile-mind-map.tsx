"use client"

import { useCallback, useMemo, useState } from "react"
import { CustomMindMapView } from "@/components/mindmap/custom-mind-map-view"
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
    onUpdateTask,
    onReorderTask,
    onOpenLinkedMemos,
}: MobileMindMapProps) {
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set())
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())

    const taskMap = useMemo(() => {
        const map = new Map<string, Task>()
        for (const task of [...groups, ...tasks]) {
            if (task?.id) map.set(task.id, task)
        }
        return map
    }, [groups, tasks])

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
            onUpdateStatus={(taskId, status) => onUpdateTask?.(taskId, { status })}
            onOpenLinkedMemos={onOpenLinkedMemos}
            onMoveTask={handleMoveTask}
        />
    )
}
