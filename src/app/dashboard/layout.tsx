"use client"

import { BottomNav } from "@/components/mobile/bottom-nav"
import { Header } from "@/components/layout/header"
import { NotificationPermissionBanner } from "@/components/notifications"


export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
            {/* Notification Permission Banner */}
            <NotificationPermissionBanner />

            {/* Global Header */}
            <Header />

            <div className="flex-1 flex overflow-hidden relative">
                {/* Main Content Area */}
                <main className="flex-1 overflow-hidden relative pb-16 md:pb-0 flex">
                    {children}
                </main>
            </div>

            {/* Mobile Bottom Nav */}
            <BottomNav />
        </div>
    )
}
