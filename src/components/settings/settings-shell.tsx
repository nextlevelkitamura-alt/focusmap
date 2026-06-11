"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, Bot, Calendar, ChevronLeft, FolderKanban, KeyRound, Palette, Settings } from "lucide-react"
import { useView } from "@/contexts/ViewContext"
import { cn } from "@/lib/utils"

interface SettingsNavItem {
  href: string
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: SettingsNavItem[] = [
  { href: "/dashboard/settings", label: "一般", icon: Settings },
  { href: "/dashboard/settings/automation", label: "AI", icon: Bot },
  { href: "/dashboard/settings/integrations", label: "連携", icon: Calendar },
  { href: "/dashboard/settings/projects", label: "プロジェクト", icon: FolderKanban },
  { href: "/dashboard/settings/access", label: "アクセス", icon: KeyRound },
  { href: "/dashboard/settings/appearance", label: "外観", icon: Palette },
]

interface SettingsShellProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
}

export function SettingsShell({ title, description, children, className }: SettingsShellProps) {
  const pathname = usePathname()
  const { activeView, setActiveView } = useView()
  const isLocalSettingsView = pathname === "/dashboard" && activeView === "settings"
  const isRootSettings = pathname === "/dashboard/settings" || isLocalSettingsView

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-100 md:bg-zinc-100 md:dark:bg-[#101010]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col md:flex-row">
        <aside className="hidden border-zinc-200 bg-white md:block md:w-[300px] md:shrink-0 md:border-r dark:border-white/[0.08] dark:bg-[#2f2f2f]">
          <div className="px-4 pb-3 pt-4 md:px-5 md:pb-6 md:pt-7">
            <Link
              href="/dashboard"
              prefetch={false}
              onClick={() => {
                if (isLocalSettingsView) setActiveView("today")
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-zinc-600 transition hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <ArrowLeft className="h-4 w-4" />
              アプリに戻る
            </Link>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:px-3 md:pb-0">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon
              const active = pathname === item.href || (isLocalSettingsView && item.href === "/dashboard/settings")

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:flex md:w-full",
                    active
                      ? "bg-zinc-200 text-zinc-950 dark:bg-white/[0.12] dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-zinc-50 px-4 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-6 md:bg-zinc-50 md:px-12 md:pb-12 md:pt-14 dark:bg-black dark:md:bg-[#111111] lg:px-20">
          <div className={cn("mx-auto w-full max-w-[1040px]", className)}>
            <header className="mb-6 md:mb-9">
              {!isRootSettings && (
                <Link
                  href="/dashboard/settings"
                  prefetch={false}
                  className="-ml-2 mb-2 inline-flex min-h-10 items-center gap-0.5 rounded-md px-1 text-[17px] text-blue-400 active:opacity-60 md:hidden"
                >
                  <ChevronLeft className="h-5 w-5" />
                  設定
                </Link>
              )}
              <h1 className="text-[34px] font-bold leading-tight tracking-normal text-zinc-950 md:text-xl md:font-semibold dark:text-zinc-50">{title}</h1>
              {description && <p className="mt-2 hidden max-w-3xl text-sm leading-6 text-zinc-500 md:block dark:text-zinc-500">{description}</p>}
            </header>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
