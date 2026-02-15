"use client"

import { BottomNav } from "@/components/mobile/bottom-nav"
import { NotificationPermissionBanner } from "@/components/notifications"
import { ViewProvider } from "@/contexts/ViewContext"


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <ViewProvider>
            <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
                {/* Notification Permission Banner */}
                <NotificationPermissionBanner />

                {/* Header is rendered inside DashboardClient for space data access */}

                <div className="flex-1 flex overflow-hidden relative">
                    {/* Main Content Area */}
                    <main className="flex-1 overflow-hidden relative pb-16 md:pb-0 flex flex-col">
                        {children}
                    </main>
                </div>

                {/* Mobile Bottom Nav */}
                <BottomNav />
            </div>
        </ViewProvider>
    )
}
