"use client"

import { forwardRef } from "react"
import { DesktopRightPanel, DesktopRightPanelRef } from "@/components/dashboard/desktop-right-panel"
import { Task } from "@/types/database"
import { CalendarEvent } from "@/types/calendar"

export interface RightSidebarRef {
    refreshCalendar: () => Promise<void>
    addOptimisticEvent: (event: CalendarEvent) => void
    removeOptimisticEvent: (eventId: string) => void
}

interface RightSidebarProps {
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    tasks?: Task[]
}

export const RightSidebar = forwardRef<RightSidebarRef, RightSidebarProps>(function RightSidebar(props, ref) {
    return (
        <DesktopRightPanel
            ref={ref as React.Ref<DesktopRightPanelRef>}
            {...props}
        />
    )
})
