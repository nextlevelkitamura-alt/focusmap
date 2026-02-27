"use client"

import { useView, DashboardView } from "@/contexts/ViewContext"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, Network, Target, Settings, Bot } from "lucide-react"
import { cn } from "@/lib/utils"

const navItems: { id: DashboardView | 'settings'; icon: typeof CalendarDays; label: string }[] = [
    { id: "today", icon: CalendarDays, label: "To do" },
    { id: "map", icon: Network, label: "マップ" },
    { id: "ai", icon: Bot, label: "AI" },
    { id: "habits", icon: Target, label: "習慣" },
    { id: "settings", icon: Settings, label: "設定" },
]

export function BottomNav() {
    const { activeView, setActiveView } = useView()
    const pathname = usePathname()
    const router = useRouter()

    const isSettingsPage = pathname.startsWith('/dashboard/settings')

    return (
        <div className="fixed bottom-0 left-0 z-50 w-full h-16 bg-background border-t md:hidden">
            <div className="grid h-full grid-cols-5 font-medium">
                {navItems.map((item) => {
                    const isActive = item.id === 'settings'
                        ? isSettingsPage
                        : (!isSettingsPage && activeView === item.id)

                    return (
                        <button
                            key={item.id}
                            onClick={() => {
                                if (item.id === 'settings') {
                                    router.push('/dashboard/settings')
                                } else {
                                    if (isSettingsPage) {
                                        router.push('/dashboard')
                                    }
                                    setActiveView(item.id as DashboardView)
                                }
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
