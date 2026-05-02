"use client"

import { forwardRef } from "react"
import { DesktopRightPanel, DesktopRightPanelRef } from "@/components/dashboard/desktop-right-panel"
import { Task, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { type QuickTaskData } from "@/components/today/quick-task-fab"

export interface RightSidebarRef {
    refreshCalendar: () => Promise<void>
    addOptimisticEvent: (event: CalendarEvent) => void
    removeOptimisticEvent: (eventId: string) => void
}

interface RightSidebarProps {
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    tasks?: Task[]
    projects?: Project[]
    onCreateQuickTask?: (data: QuickTaskData) => Promise<void>
    onCreateSubTask?: (parentTaskId: string, title: string) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onOpenAiChat?: () => void
    syncFailedIds?: Set<string>
}

export const RightSidebar = forwardRef<RightSidebarRef, RightSidebarProps>(function RightSidebar(props, ref) {
    return (
        <DesktopRightPanel
            ref={ref as React.Ref<DesktopRightPanelRef>}
            {...props}
        />
    )
})
