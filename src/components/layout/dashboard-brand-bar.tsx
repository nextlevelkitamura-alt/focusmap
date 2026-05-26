"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"
import { GlobalWorkspaceSwitcher } from "@/components/layout/global-workspace-switcher"
import { MessageSquare } from "lucide-react"

export function DashboardBrandBar() {
    const pathname = usePathname()

    if (pathname === "/dashboard") return null

    return (
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b bg-background px-4 md:px-6">
            <Link
                href="/dashboard"
                className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Focusmap ホームへ戻る"
            >
                <FocusmapLogo className="h-9 w-auto text-foreground" />
            </Link>

            <div className="flex items-center gap-2">
                <Link
                    href="/dashboard/chat"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/60 transition-colors"
                    aria-label="自動化チャット"
                >
                    <MessageSquare className="h-3 w-3" />
                    <span className="hidden sm:inline">自動化チャット</span>
                </Link>
                <GlobalWorkspaceSwitcher />
            </div>
        </header>
    )
}
