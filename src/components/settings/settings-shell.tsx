"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useMemo, useState, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { ArrowLeft, Bot, Calendar, ChevronLeft, FolderKanban, KeyRound, Palette, Search, X } from "lucide-react"
import { SettingsAccountMenu } from "@/components/settings/settings-account-menu"
import { SettingsStatusChip } from "@/components/settings/settings-primitives"
import { useSettingsStatusSummary } from "@/components/settings/settings-status-summary"
import { useView } from "@/contexts/ViewContext"
import { cn } from "@/lib/utils"

interface SettingsNavItem {
  href: string
  label: string
  icon: LucideIcon
  keywords: string[]
  statusKey: "ai" | "projects" | "calendar" | "api" | "appearance"
}

const NAV_GROUPS: Array<{ title: string; items: SettingsNavItem[] }> = [
  {
    title: "状態",
    items: [
      {
        href: "/dashboard/settings/automation",
        label: "AI / 自動化",
        icon: Bot,
        keywords: ["ai", "自動化", "codex", "mac", "agent", "エージェント"],
        statusKey: "ai",
      },
    ],
  },
  {
    title: "作業環境",
    items: [
      {
        href: "/dashboard/settings/projects",
        label: "プロジェクト",
        icon: FolderKanban,
        keywords: ["project", "repo", "context", "scan", "リポジトリ", "文脈"],
        statusKey: "projects",
      },
      {
        href: "/dashboard/settings/integrations",
        label: "連携",
        icon: Calendar,
        keywords: ["calendar", "google", "integration", "カレンダー"],
        statusKey: "calendar",
      },
    ],
  },
  {
    title: "管理",
    items: [
      {
        href: "/dashboard/settings/access",
        label: "アクセス/API",
        icon: KeyRound,
        keywords: ["api", "key", "account", "logout", "scope", "アカウント"],
        statusKey: "api",
      },
      {
        href: "/dashboard/settings/appearance",
        label: "外観",
        icon: Palette,
        keywords: ["theme", "display", "テーマ", "表示"],
        statusKey: "appearance",
      },
    ],
  },
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
  const [query, setQuery] = useState("")
  const statusSummary = useSettingsStatusSummary()
  const isLocalSettingsView = pathname === "/dashboard" && activeView === "settings"
  const isRootSettings = pathname === "/dashboard/settings" || isLocalSettingsView
  const normalizedQuery = query.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return NAV_GROUPS
    return NAV_GROUPS
      .map(group => ({
        ...group,
        items: group.items.filter(item => {
          const haystack = [item.label, ...item.keywords].join(" ").toLowerCase()
          return haystack.includes(normalizedQuery)
        }),
      }))
      .filter(group => group.items.length > 0)
  }, [normalizedQuery])

  const statusFor = (item: SettingsNavItem) => {
    if (item.statusKey === "appearance") return { label: "OS", tone: "muted" as const }
    if (item.statusKey === "ai") return { label: statusSummary.ai.chip, tone: statusSummary.ai.tone }
    if (item.statusKey === "projects") return { label: statusSummary.projects.chip, tone: statusSummary.projects.tone }
    if (item.statusKey === "calendar") return { label: statusSummary.calendar.chip, tone: statusSummary.calendar.tone }
    return { label: statusSummary.apiKeys.chip, tone: statusSummary.apiKeys.tone }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-zinc-50 text-zinc-950 dark:bg-black dark:text-zinc-100 md:bg-zinc-100 md:dark:bg-[#080808]">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] flex-col md:flex-row">
        <aside className="hidden border-zinc-200 bg-white md:flex md:w-[300px] md:shrink-0 md:flex-col md:border-r dark:border-white/[0.08] dark:bg-[#0d0d0d]">
          <div className="px-4 pb-3 pt-4 md:px-5 md:pb-4 md:pt-6">
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

            <Link
              href="/dashboard/settings"
              prefetch={false}
              className="mt-3 block rounded-md text-[22px] font-semibold leading-8 text-zinc-950 transition hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 dark:text-zinc-50 dark:hover:text-zinc-300"
            >
              設定
            </Link>

            <div className="relative mt-4">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="設定を検索"
                className="h-10 w-full rounded-lg border border-zinc-200 bg-zinc-100 pl-9 pr-9 text-[13px] text-zinc-950 outline-none transition placeholder:text-zinc-500 focus:border-zinc-400 focus:bg-white dark:border-white/[0.06] dark:bg-white/[0.045] dark:text-zinc-100 dark:focus:border-white/[0.18] dark:focus:bg-white/[0.07]"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
                  aria-label="検索をクリア"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {filteredGroups.length > 0 ? (
              <div className="space-y-5">
                {filteredGroups.map(group => (
                  <div key={group.title} className="space-y-1.5">
                    <div className="px-3 text-[11px] font-medium leading-5 text-zinc-500">{group.title}</div>
                    {group.items.map(item => {
                      const Icon = item.icon
                      const active = pathname === item.href
                      const status = statusFor(item)

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          prefetch={false}
                          className={cn(
                            "group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-[14px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
                            active
                              ? "bg-white/[0.14] text-white shadow-[inset_3px_0_0_#fff]"
                              : "text-zinc-300 hover:bg-white/[0.07] hover:text-white",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-zinc-500 group-hover:text-zinc-300" />
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          <SettingsStatusChip tone={status.tone} className="min-h-5 px-2 text-[10px]">
                            {status.label}
                          </SettingsStatusChip>
                        </Link>
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-4 text-[12px] text-zinc-500">
                一致する設定はありません
              </div>
            )}
          </nav>

          <div className="px-3 pb-4">
            <p className="mb-2 px-1 text-[11px] text-zinc-600">検索はローカルフィルタ</p>
            <SettingsAccountMenu />
          </div>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-zinc-50 px-4 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] pt-5 sm:px-6 md:bg-zinc-50 md:px-10 md:pb-12 md:pt-12 dark:bg-black dark:md:bg-[#111111] lg:px-14">
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
