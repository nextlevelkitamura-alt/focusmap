"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Bot, Calendar, ChevronRight, FolderKanban, KeyRound, Palette, Sparkles, UsersRound } from "lucide-react"
import { SettingsShell } from "@/components/settings/settings-shell"
import { cn } from "@/lib/utils"

interface OverviewItem {
  href: string
  title: string
  description: string
  icon: LucideIcon
  iconClass: string
}

const PRIMARY_ITEMS: OverviewItem[] = [
  {
    href: "/dashboard/settings/automation",
    title: "AI",
    description: "MacエージェントとCodex連携を確認",
    icon: Bot,
    iconClass: "bg-emerald-500 text-white",
  },
  {
    href: "/dashboard/settings/integrations",
    title: "Googleカレンダー",
    description: "連携アカウント、取り込み期間、取り込むカレンダーを設定",
    icon: Calendar,
    iconClass: "bg-blue-500 text-white",
  },
  {
    href: "/dashboard/settings/projects",
    title: "プロジェクト",
    description: "プロジェクト色、リポジトリ、ローカル実行先を整理",
    icon: FolderKanban,
    iconClass: "bg-orange-500 text-white",
  },
]

const SECONDARY_ITEMS: OverviewItem[] = [
  {
    href: "/dashboard/settings/spaces",
    title: "スペース共有",
    description: "メンバー招待と権限",
    icon: UsersRound,
    iconClass: "bg-emerald-500 text-white",
  },
  {
    href: "/dashboard/settings/access",
    title: "アクセス",
    description: "APIキーとアカウント",
    icon: KeyRound,
    iconClass: "bg-zinc-500 text-white",
  },
  {
    href: "/dashboard/settings/appearance",
    title: "外観",
    description: "テーマと表示",
    icon: Palette,
    iconClass: "bg-pink-500 text-white",
  },
]

function SettingsListSection({ title, items }: { title: string; items: OverviewItem[] }) {
  return (
    <section className="space-y-2">
      <h2 className="px-4 text-[13px] font-medium text-zinc-500">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-transparent dark:bg-[#1c1c1e] dark:shadow-none">
        {items.map((item, index) => (
          <SettingsListRow
            key={item.href}
            item={item}
            showDivider={index < items.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

function SettingsListRow({ item, showDivider }: { item: OverviewItem; showDivider: boolean }) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      prefetch={false}
      className="group flex min-h-[58px] items-center gap-3 px-4 transition active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:hover:bg-zinc-50 dark:active:bg-white/[0.06] dark:md:hover:bg-white/[0.04]"
    >
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", item.iconClass)}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className={cn("flex min-w-0 flex-1 items-center gap-3 py-2.5", showDivider && "border-b border-zinc-200 dark:border-white/[0.08]")}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-5 text-zinc-950 dark:text-zinc-50">{item.title}</div>
          <div className="mt-0.5 truncate text-[12px] leading-4 text-zinc-500">{item.description}</div>
        </div>
        <ChevronRight className="h-4.5 w-4.5 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-400" />
      </div>
    </Link>
  )
}

export function SettingsOverview() {
  return (
    <SettingsShell
      title="設定"
      description="実際に使う設定だけを置いています。細かい調整は各カテゴリから行えます。"
      className="max-w-[720px]"
    >
      <div className="space-y-7">
        <div className="flex min-h-[76px] items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 shadow-sm dark:border-transparent dark:bg-[#1c1c1e] dark:shadow-none">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            <Sparkles className="h-5 w-5 text-blue-500 dark:text-blue-300" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-zinc-950 dark:text-zinc-50">Focusmap</div>
            <div className="mt-0.5 truncate text-[13px] text-zinc-500">予定と自動化をまとめて管理</div>
          </div>
        </div>

        <div className="space-y-7">
          <SettingsListSection title="よく使う設定" items={PRIMARY_ITEMS} />
          <SettingsListSection title="その他" items={SECONDARY_ITEMS} />
        </div>
      </div>
    </SettingsShell>
  )
}
