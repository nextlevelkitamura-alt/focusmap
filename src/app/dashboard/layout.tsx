"use client"

import { BottomNav } from "@/components/mobile/bottom-nav"
import { DashboardBrandBar } from "@/components/layout/dashboard-brand-bar"
import { ViewProvider } from "@/contexts/ViewContext"
import { useForceDesktopDashboard } from "@/hooks/useForceDesktopDashboard"
import { cn } from "@/lib/utils"


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const forceDesktopDashboard = useForceDesktopDashboard()

    return (
        <ViewProvider>
            <div className="flex flex-col h-dvh overflow-hidden bg-background text-foreground">
                {/* DashboardClient renders the full header on /dashboard. Sub pages still need a persistent home link. */}
                <DashboardBrandBar />

                <div className="flex-1 min-h-0 flex overflow-hidden relative">
                    {/* Main Content Area */}
                    <main className={cn(
                        "flex-1 min-h-0 relative flex flex-col",
                        forceDesktopDashboard ? "overflow-auto pb-0" : "overflow-hidden pb-16 md:pb-0",
                    )}>
                        {children}
                    </main>
                </div>

                {/* Mobile Bottom Nav */}
                {!forceDesktopDashboard && <BottomNav />}
            </div>
        </ViewProvider>
    )
}
