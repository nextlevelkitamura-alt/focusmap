"use client"

import { forwardRef, useImperativeHandle, useRef } from "react"
import { Task, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { DesktopTodayPanel } from "@/components/dashboard/desktop-today-panel"
import { type QuickTaskData } from "@/components/today/quick-task-fab"

export interface DesktopRightPanelRef {
    refreshCalendar: () => Promise<void>
    addOptimisticEvent: (event: CalendarEvent) => void
    removeOptimisticEvent: (eventId: string) => void
}

interface DesktopRightPanelProps {
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    tasks?: Task[]
    projects?: Project[]
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onOpenAiChat?: () => void
    onOpenScheduling?: () => void
}

export const DesktopRightPanel = forwardRef<DesktopRightPanelRef, DesktopRightPanelProps>(
    function DesktopRightPanel({
        onUpdateTask,
        tasks = [],
        projects = [],
        onCreateQuickTask,
        onCreateSubTask,
        onDeleteTask,
        onOpenAiChat,
        onOpenScheduling,
    }, ref) {
        // Ref interface is maintained for backward compatibility
        // DesktopTodayPanel uses useTodayViewLogic which manages its own calendar state
        useImperativeHandle(ref, () => ({
            refreshCalendar: async () => { /* managed by useTodayViewLogic's syncNow */ },
            addOptimisticEvent: () => { /* managed by useTodayViewLogic */ },
            removeOptimisticEvent: () => { /* managed by useTodayViewLogic */ },
        }), [])

        return (
            <DesktopTodayPanel
                allTasks={tasks}
                onUpdateTask={onUpdateTask || (async () => {})}
                projects={projects}
                onCreateQuickTask={onCreateQuickTask}
                onCreateSubTask={onCreateSubTask}
                onDeleteTask={onDeleteTask}
                onOpenAiChat={onOpenAiChat}
                onOpenScheduling={onOpenScheduling}
            />
        )
    }
)

DesktopRightPanel.displayName = 'DesktopRightPanel'
