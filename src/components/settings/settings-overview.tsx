"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Bot, Calendar, ChevronRight, FolderKanban, KeyRound, Palette, Search, X } from "lucide-react"
import { SettingsAccountMenu } from "@/components/settings/settings-account-menu"
import {
  SettingRow,
  SettingsSection,
  SettingsStatusChip,
  SettingsEmptyState,
} from "@/components/settings/settings-primitives"
import {
  SettingsStatusSummaryBlock,
  useSettingsStatusSummary,
} from "@/components/settings/settings-status-summary"
import { SettingsShell } from "@/components/settings/settings-shell"
import { cn } from "@/lib/utils"

type OverviewCategory = {
  href: string
  title: string
  description: string
  mobileDescription: string
  icon: LucideIcon
  group: "状態" | "作業環境" | "管理"
  statusKey: "ai" | "projects" | "calendar" | "api" | "appearance"
  keywords: string[]
}

const CATEGORIES: OverviewCategory[] = [
  {
    href: "/dashboard/settings/automation",
    title: "AI / 自動化",
    description: "Macエージェント、Codex、取り込み、自動化ルール",
    mobileDescription: "Mac接続",
    icon: Bot,
    group: "状態",
    statusKey: "ai",
    keywords: ["ai", "自動化", "codex", "mac", "agent", "エージェント"],
  },
  {
    href: "/dashboard/settings/projects",
    title: "プロジェクト",
    description: "repo path、説明/context、スキャン",
    mobileDescription: "repo / context",
    icon: FolderKanban,
    group: "作業環境",
    statusKey: "projects",
    keywords: ["project", "repo", "context", "scan", "リポジトリ", "文脈"],
  },
  {
    href: "/dashboard/settings/integrations",
    title: "連携",
    description: "Google Calendar、取り込み期間、カレンダー選択",
    mobileDescription: "Google Calendar",
    icon: Calendar,
    group: "作業環境",
    statusKey: "calendar",
    keywords: ["calendar", "google", "integration", "カレンダー"],
  },
  {
    href: "/dashboard/settings/access",
    title: "アクセス/API",
    description: "API keys、scope、account、danger zone",
    mobileDescription: "API keys / account",
    icon: KeyRound,
    group: "管理",
    statusKey: "api",
    keywords: ["api", "key", "account", "logout", "scope", "アカウント"],
  },
  {
    href: "/dashboard/settings/appearance",
    title: "外観",
    description: "テーマ、表示密度、マップ配色",
    mobileDescription: "テーマ",
    icon: Palette,
    group: "管理",
    statusKey: "appearance",
    keywords: ["theme", "display", "テーマ", "表示", "外観"],
  },
]

const GROUP_ORDER: Array<OverviewCategory["group"]> = ["状態", "作業環境", "管理"]

function useFilteredCategories(query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  return useMemo(() => {
    const filtered = normalizedQuery
      ? CATEGORIES.filter(item => [item.title, item.description, item.mobileDescription, ...item.keywords].join(" ").toLowerCase().includes(normalizedQuery))
      : CATEGORIES

    return GROUP_ORDER
      .map(group => ({
        group,
        items: filtered.filter(item => item.group === group),
      }))
      .filter(section => section.items.length > 0)
  }, [normalizedQuery])
}

function statusFor(category: OverviewCategory, summary: ReturnType<typeof useSettingsStatusSummary>) {
  if (category.statusKey === "appearance") return { label: "OS", tone: "muted" as const }
  if (category.statusKey === "ai") return { label: summary.ai.chip, tone: summary.ai.tone }
  if (category.statusKey === "projects") return { label: summary.projects.chip, tone: summary.projects.tone }
  if (category.statusKey === "calendar") return { label: summary.calendar.chip, tone: summary.calendar.tone }
  return { label: summary.apiKeys.chip, tone: summary.apiKeys.tone }
}

function SearchBox({ query, setQuery, className }: { query: string; setQuery: (value: string) => void; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
      <input
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="設定を検索"
        className="h-11 w-full rounded-lg border border-white/[0.07] bg-white/[0.045] pl-9 pr-9 text-[14px] text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-white/[0.18] focus:bg-white/[0.07]"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition hover:bg-white/[0.08] hover:text-zinc-200"
          aria-label="検索をクリア"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  )
}

function DesktopCategoryList({
  sections,
  summary,
}: {
  sections: Array<{ group: OverviewCategory["group"]; items: OverviewCategory[] }>
  summary: ReturnType<typeof useSettingsStatusSummary>
}) {
  if (sections.length === 0) {
    return <SettingsEmptyState>一致する設定はありません</SettingsEmptyState>
  }

  return (
    <div className="space-y-5">
      {sections.map(section => (
        <SettingsSection key={section.group} title={section.group}>
          {section.items.map(item => {
            const status = statusFor(item, summary)
            return (
              <SettingRow
                key={item.href}
                href={item.href}
                icon={item.icon}
                title={item.title}
                description={item.description}
                status={<SettingsStatusChip tone={status.tone}>{status.label}</SettingsStatusChip>}
                control={<ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />}
              />
            )
          })}
        </SettingsSection>
      ))}
    </div>
  )
}

function MobileCategoryList({
  sections,
  summary,
}: {
  sections: Array<{ group: OverviewCategory["group"]; items: OverviewCategory[] }>
  summary: ReturnType<typeof useSettingsStatusSummary>
}) {
  if (sections.length === 0) {
    return (
      <div className="md:hidden">
        <SettingsEmptyState>一致する設定はありません</SettingsEmptyState>
      </div>
    )
  }

  return (
    <div className="space-y-5 md:hidden">
      {sections.map(section => (
        <section key={section.group} className="space-y-2">
          <h2 className="px-1 text-[12px] font-medium text-zinc-500">{section.group}</h2>
          <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045]">
            {section.items.map(item => {
              const Icon = item.icon
              const status = statusFor(item, summary)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  className="flex min-h-[64px] items-center gap-3 border-b border-white/[0.07] px-4 py-3 transition active:bg-white/[0.08] last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-black/20 text-zinc-400">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-medium leading-5 text-zinc-50">{item.title}</span>
                    <span className="mt-0.5 block truncate text-[12px] leading-4 text-zinc-500">{item.mobileDescription}</span>
                  </span>
                  <SettingsStatusChip tone={status.tone}>{status.label}</SettingsStatusChip>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600" />
                </Link>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export function SettingsOverview() {
  const [query, setQuery] = useState("")
  const sections = useFilteredCategories(query)
  const summary = useSettingsStatusSummary()

  return (
    <SettingsShell
      title="設定"
      description="AI実行、連携、プロジェクト文脈を確認して、必要な復旧へ進みます。"
      className="max-w-[1180px]"
    >
      <div className="space-y-7">
        <SearchBox query={query} setQuery={setQuery} className="md:hidden" />

        <div className="md:hidden">
          <SettingsStatusSummaryBlock compact summary={summary} />
        </div>

        <div className="hidden md:block">
          <SettingsStatusSummaryBlock summary={summary} />
        </div>

        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="hidden md:block">
            <DesktopCategoryList sections={sections} summary={summary} />
          </div>

          <MobileCategoryList sections={sections} summary={summary} />

          <aside className="hidden space-y-5 xl:block">
            <SettingsSection title="要対応" description="実行前に確認したい項目">
              <SettingRow
                title="プロジェクト実行先"
                description="repo path と context は詳細画面で確認"
                status={<SettingsStatusChip tone={summary.projects.tone}>{summary.projects.chip}</SettingsStatusChip>}
              />
              <SettingRow
                title="外部AI scope"
                description={summary.apiKeys.detail}
                status={<SettingsStatusChip tone={summary.apiKeys.tone}>{summary.apiKeys.chip}</SettingsStatusChip>}
              />
              <SettingRow
                title="Google Calendar"
                description={summary.calendar.detail}
                status={<SettingsStatusChip tone={summary.calendar.tone}>{summary.calendar.chip}</SettingsStatusChip>}
              />
            </SettingsSection>
          </aside>
        </div>

        <section className="space-y-2 md:hidden">
          <h2 className="px-1 text-[12px] font-medium text-zinc-500">アカウント</h2>
          <SettingsAccountMenu />
        </section>
      </div>
    </SettingsShell>
  )
}
