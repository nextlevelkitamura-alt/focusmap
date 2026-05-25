"use client"

import { forwardRef, lazy, Suspense } from "react"
import type { DesktopRightPanelRef } from "@/components/dashboard/desktop-right-panel"
import { Task, Project } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"
import { type QuickTaskData } from "@/components/today/quick-task-fab"

const DesktopRightPanel = lazy(() =>
    import("@/components/dashboard/desktop-right-panel").then(mod => ({ default: mod.DesktopRightPanel }))
)

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
    calendarScrollToHour?: number
    calendarScrollRequestKey?: number
}

export const RightSidebar = forwardRef<RightSidebarRef, RightSidebarProps>(function RightSidebar(props, ref) {
    return (
        <Suspense fallback={<div className="h-full w-full animate-pulse bg-muted/30" />}>
            <DesktopRightPanel
                ref={ref as React.Ref<DesktopRightPanelRef>}
                {...props}
            />
        </Suspense>
    )
})
