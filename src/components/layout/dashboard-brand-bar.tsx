"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { FocusmapLogo } from "@/components/ui/focusmap-logo"

export function DashboardBrandBar() {
    const pathname = usePathname()

    if (pathname === "/dashboard") return null

    return (
        <header className="flex h-14 shrink-0 items-center border-b bg-background px-4 md:px-6">
            <Link
                href="/dashboard"
                className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Focusmap ホームへ戻る"
            >
                <FocusmapLogo className="h-9 w-auto text-foreground" />
            </Link>
        </header>
    )
}
