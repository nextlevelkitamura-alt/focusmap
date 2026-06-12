"use client"

import { useCallback, useMemo, useState } from "react"
import type { Task } from "@/types/database"

type UseMindMapCollapsedTaskIdsParams = {
    projectId: string | null | undefined
    groups: Task[]
    tasks: Task[]
}

type PendingCollapseOverride = {
    projectId: string | null
    collapsed: boolean
    baseCollapsed: boolean
}

export function useMindMapCollapsedTaskIds({
    projectId,
    groups,
    tasks,
}: UseMindMapCollapsedTaskIdsParams) {
    const allTasks = useMemo(() => [...groups, ...tasks], [groups, tasks])
    const persistedCollapsedTaskIds = useMemo(
        () => allTasks
            .filter(task => task.mindmap_collapsed === true)
            .map(task => task.id)
            .sort(),
        [allTasks],
    )
    const persistedCollapsedTaskIdSet = useMemo(
        () => new Set(persistedCollapsedTaskIds),
        [persistedCollapsedTaskIds],
    )
    const taskIds = useMemo(
        () => allTasks.map(task => task.id).sort().join("|"),
        [allTasks],
    )
    const taskIdSet = useMemo(
        () => new Set(taskIds ? taskIds.split("|") : []),
        [taskIds],
    )
    const [pendingOverrides, setPendingOverrides] = useState<Map<string, PendingCollapseOverride>>(() => new Map())

    const collapsedTaskIds = useMemo(() => {
        const next = new Set(persistedCollapsedTaskIds)
        for (const [taskId, override] of pendingOverrides) {
            if (!taskIdSet.has(taskId)) continue
            if (override.projectId !== (projectId ?? null)) continue
            if (persistedCollapsedTaskIdSet.has(taskId) !== override.baseCollapsed) continue
            if (override.collapsed) {
                next.add(taskId)
            } else {
                next.delete(taskId)
            }
        }
        return next
    }, [pendingOverrides, persistedCollapsedTaskIdSet, persistedCollapsedTaskIds, projectId, taskIdSet])

    const setTaskCollapsed = useCallback((taskId: string, collapsed: boolean) => {
        setPendingOverrides(previous => {
            const next = new Map(previous)
            const baseCollapsed = persistedCollapsedTaskIdSet.has(taskId)
            if (baseCollapsed === collapsed) {
                next.delete(taskId)
            } else {
                next.set(taskId, {
                    projectId: projectId ?? null,
                    collapsed,
                    baseCollapsed,
                })
            }
            return next
        })
    }, [persistedCollapsedTaskIdSet, projectId])

    return { collapsedTaskIds, setTaskCollapsed }
}
