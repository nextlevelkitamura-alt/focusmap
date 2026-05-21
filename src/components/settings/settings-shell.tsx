"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, Bot, Calendar, FolderKanban, KeyRound, Palette, Settings } from "lucide-react"
import { cn } from "@/lib/utils"

interface SettingsNavItem {
  href: string
  label: string
  icon: LucideIcon
}

const NAV_ITEMS: SettingsNavItem[] = [
  { href: "/dashboard/settings", label: "一般", icon: Settings },
  { href: "/dashboard/settings/ai", label: "AI", icon: Bot },
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

  return (
    <div className="min-h-full flex-1 bg-[#101010] text-zinc-100">
      <div className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[1500px] flex-col md:flex-row">
        <aside className="border-b border-white/[0.08] bg-[#2f2f2f] md:w-[300px] md:shrink-0 md:border-b-0 md:border-r md:border-white/[0.08]">
          <div className="px-4 pb-3 pt-4 md:px-5 md:pb-6 md:pt-7">
            <Link
              href="/dashboard"
              className="inline-flex min-h-10 items-center gap-2 rounded-md text-sm text-zinc-400 transition hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <ArrowLeft className="h-4 w-4" />
              アプリに戻る
            </Link>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1 md:overflow-visible md:px-3 md:pb-0">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon
              const active = pathname === item.href

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:flex md:w-full",
                    active
                      ? "bg-white/[0.12] text-white"
                      : "text-zinc-300 hover:bg-white/[0.08] hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto bg-[#111111] px-4 pb-12 pt-8 sm:px-8 md:px-12 md:pt-14 lg:px-20">
          <div className={cn("mx-auto w-full max-w-[1040px]", className)}>
            <header className="mb-9">
              <h1 className="text-xl font-semibold tracking-normal text-zinc-50">{title}</h1>
              {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{description}</p>}
            </header>
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
