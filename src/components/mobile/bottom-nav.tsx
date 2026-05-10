"use client"

import { useView, DashboardView } from "@/contexts/ViewContext"
import { usePathname, useRouter } from "next/navigation"
import { CalendarDays, Bot, Target, MoreHorizontal, Network, Star, Route } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"

const mainNavItems: { id: DashboardView; icon: typeof CalendarDays; label: string }[] = [
    { id: "today", icon: CalendarDays, label: "ボード" },
    { id: "ai", icon: Bot, label: "AI" },
    { id: "habits", icon: Target, label: "習慣" },
]

const moreNavItems: { id: DashboardView; icon: typeof CalendarDays; label: string }[] = [
    { id: "map", icon: Network, label: "マップ" },
    { id: "ideal", icon: Star, label: "理想" },
    { id: "long-term", icon: Route, label: "長期" },
]

export function BottomNav() {
    const { activeView, setActiveView } = useView()
    const pathname = usePathname()
    const router = useRouter()
    const [showMore, setShowMore] = useState(false)

    const isSettingsPage = pathname.startsWith('/dashboard/settings')
    const isMoreActive = moreNavItems.some(item => item.id === activeView)

    return (
        <>
            {/* More menu overlay */}
            {showMore && (
                <div
                    className="fixed inset-0 z-40 md:hidden"
                    onClick={() => setShowMore(false)}
                >
                    <div
                        className="absolute bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] right-4 bg-background border rounded-xl shadow-lg p-1 min-w-[120px]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {moreNavItems.map((item) => (
                            <button
                                key={item.id}
                                onClick={() => {
                                    if (isSettingsPage) router.push('/dashboard')
                                    setActiveView(item.id)
                                    setShowMore(false)
                                }}
                                className={cn(
                                    "flex items-center gap-2 w-full px-3 py-2.5 rounded-lg text-sm transition-colors",
                                    activeView === item.id
                                        ? "text-primary bg-primary/10"
                                        : "text-muted-foreground hover:bg-muted/50"
                                )}
                            >
                                <item.icon className="w-4 h-4" />
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Bottom nav bar */}
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
                                    setShowMore(false)
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
                    {/* More button */}
                    <button
                        onClick={() => setShowMore(prev => !prev)}
                        className={cn(
                            "inline-flex flex-col items-center justify-center hover:bg-muted/50",
                            isMoreActive ? "text-primary" : "text-muted-foreground"
                        )}
                    >
                        <MoreHorizontal className={cn("w-5 h-5 mb-1", isMoreActive && "fill-current")} />
                        <span className="text-[10px]">その他</span>
                    </button>
                </div>
            </div>
        </>
    )
}
