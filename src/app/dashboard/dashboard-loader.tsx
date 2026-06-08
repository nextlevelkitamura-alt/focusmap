"use client"

import dynamic from "next/dynamic"
import { Space, Project, Task } from "@/types/database"
import { DashboardStartupFallback } from "./dashboard-startup-fallback"

const DashboardClient = dynamic(
    () => import("./dashboard-client").then(mod => ({ default: mod.DashboardClient })),
    {
        ssr: false,
        loading: () => (
            <>
                <DashboardStartupFallback />
                <div className="hidden h-screen flex-col gap-3 bg-background p-4 md:flex">
                    <div className="h-12 shrink-0 animate-pulse rounded-md bg-muted/70" />
                    <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-[13rem_1fr_22rem]">
                        <div className="rounded-md border bg-muted/30" />
                        <div className="rounded-md border bg-muted/20" />
                        <div className="rounded-md border bg-muted/30" />
                    </div>
                </div>
            </>
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
