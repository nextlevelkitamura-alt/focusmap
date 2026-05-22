"use client"

import { useEffect } from "react"
import { useView, DashboardView } from "@/contexts/ViewContext"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, Bot, Sparkles, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

type BottomNavItem =
    | { type: "view"; id: DashboardView; icon: typeof CalendarDays; label: string }
    | { type: "settings"; icon: typeof Settings; label: string }

const mainNavItems: BottomNavItem[] = [
    { type: "view", id: "today",     icon: CalendarDays, label: "Today" },
    { type: "view", id: "long-term", icon: Sparkles,     label: "メモ" },
    { type: "view", id: "ai",        icon: Bot,          label: "AI" },
    { type: "settings",              icon: Settings,     label: "設定" },
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
            <div className="grid h-16 grid-cols-4 font-medium">
                {mainNavItems.map((item) => {
                    const isActive = item.type === "settings"
                        ? isSettingsPage
                        : !isSettingsPage && activeView === item.id
                    return (
                        <button
                            key={item.type === "settings" ? "settings" : item.id}
                            onClick={() => {
                                if (item.type === "settings") {
                                    router.push('/dashboard/settings')
                                    return
                                }
                                if (isSettingsPage) router.push('/dashboard')
                                setActiveView(item.id)
                            }}
                            className={cn(
                                "inline-flex flex-col items-center justify-center hover:bg-muted/50",
                                isActive ? "text-primary" : "text-muted-foreground"
                            )}
                        >
                            <item.icon className={cn("w-5 h-5 mb-1", isActive && "fill-current")} />
                            <span className="text-[10px]">{item.label}</span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
