"use client"

import { useEffect } from "react"
import { useView, DashboardView } from "@/contexts/ViewContext"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, Network, Settings, StickyNote, MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { preloadDashboardView } from "@/lib/dashboard-preload"

type BottomNavItem =
    | { type: "view"; id: DashboardView; icon: typeof CalendarDays; label: string; primary?: boolean }
    | { type: "settings"; icon: typeof Settings; label: string }

const mainNavItems: BottomNavItem[] = [
    { type: "view", id: "today",      icon: CalendarDays, label: "Today" },
    { type: "view", id: "long-term",  icon: StickyNote,   label: "メモ" },
    { type: "view", id: "ai",         icon: MessageCircle, label: "チャット", primary: true },
    { type: "view", id: "map",        icon: Network,      label: "マップ" },
    { type: "settings",               icon: Settings,     label: "設定" },
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
                    const isActive = item.type === "settings"
                        ? isSettingsPage
                        : !isSettingsPage && activeView === item.id
                    return (
                        <button
                            key={item.type === "settings" ? "settings" : item.id}
                            onFocus={() => {
                                if (item.type === "view") preloadDashboardView(item.id)
                                else router.prefetch('/dashboard/settings')
                            }}
                            onPointerEnter={() => {
                                if (item.type === "view") preloadDashboardView(item.id)
                                else router.prefetch('/dashboard/settings')
                            }}
                            onPointerDown={() => {
                                if (item.type === "view") preloadDashboardView(item.id)
                                else router.prefetch('/dashboard/settings')
                                if (item.type === "view" && isSettingsPage) router.prefetch('/dashboard')
                            }}
                            onClick={() => {
                                if (item.type === "settings") {
                                    router.push('/dashboard/settings')
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
