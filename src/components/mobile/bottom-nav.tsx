"use client"

import { useEffect } from "react"
import { useView, DashboardView } from "@/contexts/ViewContext"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, Network, Settings, StickyNote, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { preloadDashboardView } from "@/lib/dashboard-preload"

type BottomNavItem =
    | { type: "view"; id: DashboardView; icon: typeof CalendarDays; label: string; primary?: boolean }

const mainNavItems: BottomNavItem[] = [
    { type: "view", id: "today",      icon: CalendarDays, label: "Todo" },
    { type: "view", id: "long-term",  icon: StickyNote,   label: "メモ" },
    { type: "view", id: "map",        icon: Network,      label: "マップ" },
    { type: "view", id: "ai",         icon: MessageCircle, label: "チャット", primary: true },
    { type: "view", id: "settings",   icon: Settings,     label: "設定" },
]

export function BottomNav() {
    const { activeView, setActiveView } = useView()
    const pathname = usePathname()
    const router = useRouter()

    const isSettingsPage = pathname.startsWith('/dashboard/settings')

    useEffect(() => {
        const isMobile = window.matchMedia('(max-width: 767px)').matches
        if (isMobile && activeView === 'habits' && !isSettingsPage) {
            setActiveView('today')
        }
    }, [activeView, isSettingsPage, setActiveView])

    return (
        <div className="fixed bottom-0 left-0 z-50 w-full border-t border-zinc-200 bg-white/[0.98] shadow-[0_-1px_0_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-[#050607]/[0.98] dark:shadow-[0_-1px_0_rgba(255,255,255,0.04)] md:hidden pb-[env(safe-area-inset-bottom,0px)]">
            <div className="grid h-[76px] grid-cols-5 font-medium">
                {mainNavItems.map((item) => {
                    const isActive = item.id === "settings"
                        ? isSettingsPage || (!isSettingsPage && activeView === "settings")
                        : !isSettingsPage && activeView === item.id
                    return (
                        <button
                            key={item.id}
                            onFocus={() => {
                                preloadDashboardView(item.id)
                            }}
                            onPointerEnter={() => {
                                preloadDashboardView(item.id)
                            }}
                            onPointerDown={() => {
                                preloadDashboardView(item.id)
                                if (item.id !== "settings" && isSettingsPage) router.prefetch('/dashboard')
                            }}
                            onClick={() => {
                                if (item.id === "settings") {
                                    if (isSettingsPage) {
                                        if (pathname !== '/dashboard/settings') router.push('/dashboard/settings')
                                        return
                                    }
                                    setActiveView("settings")
                                    return
                                }
                                if (isSettingsPage) router.push('/dashboard')
                                setActiveView(item.id)
                            }}
                            aria-label={item.label}
                            title={item.label}
                            className={cn(
                                "inline-flex flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                                isActive ? "text-blue-600 dark:text-[#58a6ff]" : "text-neutral-500 active:text-neutral-700 dark:active:text-neutral-300"
                            )}
                        >
                            <span
                                className={cn(
                                    "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                                    isActive
                                        ? "text-blue-600 dark:text-[#58a6ff]"
                                        : "text-neutral-500 active:bg-zinc-100 dark:active:bg-white/[0.06]",
                                    item.type === "view" && item.primary && !isActive && "text-neutral-500",
                                    item.type === "view" && item.primary && isActive && "text-blue-600 dark:text-[#58a6ff]",
                                )}
                            >
                                <item.icon className={cn("h-[23px] w-[23px]", isActive && "stroke-[2.4]")} />
                            </span>
                            <span className="leading-none">{item.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
