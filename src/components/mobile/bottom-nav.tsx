"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Calendar, LayoutDashboard, PlusCircle, Zap, Settings } from "lucide-react" // Icons equivalent to: Today, Overview, +, Focus, Settings
import { cn } from "@/lib/utils"

export function BottomNav() {
    const pathname = usePathname()

    const navItems = [
        { href: "/dashboard", icon: Calendar, label: "今日" }, // Today
        { href: "/dashboard/overview", icon: LayoutDashboard, label: "俯瞰" }, // Overview (MindMap)
        { href: "/dashboard/new", icon: PlusCircle, label: "追加" }, // +
        { href: "/dashboard/focus", icon: Zap, label: "集中" }, // Focus
        { href: "/dashboard/settings", icon: Settings, label: "設定" }, // Settings
    ]

    return (
        <div className="fixed bottom-0 left-0 z-50 w-full h-16 bg-background border-t md:hidden">
            <div className="grid h-full grid-cols-5 font-medium">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "inline-flex flex-col items-center justify-center px-5 hover:bg-muted/50 group",
                                isActive ? "text-primary" : "text-muted-foreground"
                            )}
                        >
                            <item.icon className={cn("w-6 h-6 mb-1", isActive && "fill-current")} />
                            <span className="text-[10px]">{item.label}</span>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}
