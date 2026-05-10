"use client"

import { useView, DashboardView } from "@/contexts/ViewContext"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, Bot, Target, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

const mainNavItems: { id: DashboardView; icon: typeof CalendarDays; label: string }[] = [
    { id: "today",     icon: CalendarDays, label: "Today" },
    { id: "long-term", icon: Sparkles,     label: "Wish" },
    { id: "habits",    icon: Target,       label: "習慣" },
    { id: "ai",        icon: Bot,          label: "AI" },
]

export function BottomNav() {
    const { activeView, setActiveView } = useView()
    const pathname = usePathname()
    const router = useRouter()

    const isSettingsPage = pathname.startsWith('/dashboard/settings')

    return (
        <div className="fixed bottom-0 left-0 z-50 w-full bg-background border-t md:hidden pb-[env(safe-area-inset-bottom,0px)]">
            <div className="grid h-16 grid-cols-4 font-medium">
                {mainNavItems.map((item) => {
                    const isActive = !isSettingsPage && activeView === item.id
                    return (
                        <button
                            key={item.id}
                            onClick={() => {
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
