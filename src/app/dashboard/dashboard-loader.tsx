"use client"

import dynamic from "next/dynamic"
import { Space, Project, Task } from "@/types/database"

const DashboardClient = dynamic(
    () => import("./dashboard-client").then(mod => ({ default: mod.DashboardClient })),
    {
        ssr: false,
        loading: () => (
            <div className="flex h-screen flex-col gap-3 bg-background p-4">
                <div className="h-12 shrink-0 animate-pulse rounded-md bg-muted/70" />
                <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-[13rem_1fr_22rem]">
                    <div className="hidden rounded-md border bg-muted/30 md:block" />
                    <div className="rounded-md border bg-muted/20" />
                    <div className="hidden rounded-md border bg-muted/30 md:block" />
                </div>
            </div>
        ),
    }
)

interface DashboardLoaderProps {
    initialSpaces: Space[]
    initialProjects: Project[]
    initialTasks: Task[]
    userId: string
}

export function DashboardLoader(props: DashboardLoaderProps) {
    return <DashboardClient {...props} />
}
