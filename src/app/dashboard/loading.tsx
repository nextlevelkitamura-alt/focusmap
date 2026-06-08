import { DashboardStartupFallback } from "./dashboard-startup-fallback"

export default function DashboardLoading() {
    return (
        <>
            <DashboardStartupFallback />
            <div className="hidden h-full min-h-0 flex-col gap-3 bg-background p-4 md:flex">
                <div className="h-12 shrink-0 animate-pulse rounded-md bg-muted/70" />
                <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[13rem_1fr_22rem]">
                    <div className="rounded-md border bg-muted/30" />
                    <div className="rounded-md border bg-muted/20" />
                    <div className="rounded-md border bg-muted/30" />
                </div>
            </div>
        </>
    )
}
