"use client"

import dynamic from "next/dynamic"
import { Space, Project, TaskGroup, Task } from "@/types/database"

const DashboardClient = dynamic(
    () => import("./dashboard-client").then(mod => ({ default: mod.DashboardClient })),
    {
        ssr: false,
        loading: () => (
            <div className="flex items-center justify-center h-screen bg-background">
                <div className="animate-pulse text-muted-foreground">読み込み中...</div>
            </div>
        ),
    }
)

interface DashboardLoaderProps {
    initialSpaces: Space[]
    initialProjects: Project[]
    initialGroups: TaskGroup[]
    initialTasks: Task[]
    userId: string
}

export function DashboardLoader(props: DashboardLoaderProps) {
    return <DashboardClient {...props} />
}
