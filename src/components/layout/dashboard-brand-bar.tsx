"use client"

import { Suspense } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"
import { GlobalWorkspaceSwitcher } from "@/components/layout/global-workspace-switcher"
import { MessageSquare } from "lucide-react"
import { useView } from "@/contexts/ViewContext"

export function DashboardBrandBar() {
    const pathname = usePathname()
    const { setActiveView } = useView()

    if (pathname === "/dashboard") return null

    const handleLogoClick = () => {
        setActiveView("today")
        try {
            window.localStorage.setItem("focusmap:today-sub-view", "memo")
        } catch {}
    }

    return (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
            <Link
                href="/dashboard"
                onClick={handleLogoClick}
                className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Todayボードへ移動"
            >
                <FocusmapLogo className="h-9 w-auto text-foreground" />
            </Link>

            <div className="flex items-center gap-2">
                <Link
                    href="/dashboard/chat"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
                    aria-label="チャット"
                >
                    <MessageSquare className="h-3 w-3" />
                    <span className="hidden sm:inline">チャット</span>
                </Link>
                <Suspense fallback={null}>
                    <GlobalWorkspaceSwitcher />
                </Suspense>
            </div>
        </header>
    )
}
