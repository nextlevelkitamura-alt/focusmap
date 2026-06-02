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
        <div className="fixed bottom-0 left-0 z-50 w-full bg-background border-t md:hidden pb-[env(safe-area-inset-bottom,0px)]">
            <div className="grid h-16 grid-cols-5 font-medium">
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
                                "inline-flex flex-col items-center justify-center gap-0.5 text-[10px]",
                                isActive ? "text-primary" : "text-muted-foreground"
                            )}
                        >
                            <span
                                className={cn(
                                    "inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                                    isActive
                                        ? "bg-muted text-foreground"
                                        : "text-muted-foreground active:bg-muted/70",
                                    item.type === "view" && item.primary && !isActive && "bg-primary/10 text-primary",
                                    item.type === "view" && item.primary && isActive && "bg-primary text-primary-foreground",
                                )}
                            >
                                <item.icon className={cn("h-[18px] w-[18px]", isActive && "stroke-[2.4]")} />
                            </span>
                            <span className="leading-none">{item.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
