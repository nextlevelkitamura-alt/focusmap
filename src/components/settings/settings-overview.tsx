"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Bot, Calendar, ChevronRight, FolderKanban, KeyRound, Palette, Sparkles, UsersRound, Workflow } from "lucide-react"
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
    href: "/dashboard/settings/ai",
    title: "AI",
    description: "モデル選択と、AIに渡す自分・プロジェクト情報を管理",
    icon: Bot,
    iconClass: "bg-violet-500 text-white",
  },
  {
    href: "/dashboard/settings/automation",
    title: "自動化",
    description: "PC実行、GWS、Playwright、認証状態を管理",
    icon: Workflow,
    iconClass: "bg-cyan-500 text-white",
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
      <div className="overflow-hidden rounded-xl bg-[#1c1c1e]">
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
      className="group flex min-h-[58px] items-center gap-3 px-4 transition active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:hover:bg-white/[0.04]"
    >
      <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", item.iconClass)}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className={cn("flex min-w-0 flex-1 items-center gap-3 py-2.5", showDivider && "border-b border-white/[0.08]")}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] leading-5 text-zinc-50">{item.title}</div>
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
        <Link
          href="/dashboard/settings/ai"
          className="flex min-h-[76px] items-center gap-3 rounded-xl bg-[#1c1c1e] px-4 transition active:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:hover:bg-white/[0.04]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-zinc-100">
            <Sparkles className="h-5 w-5 text-blue-300" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-semibold text-zinc-50">Focusmap</div>
            <div className="mt-0.5 truncate text-[13px] text-zinc-500">AIと予定をまとめて管理</div>
          </div>
          <ChevronRight className="h-4.5 w-4.5 shrink-0 text-zinc-600" />
        </Link>

        <div className="space-y-7">
          <SettingsListSection title="よく使う設定" items={PRIMARY_ITEMS} />
          <SettingsListSection title="その他" items={SECONDARY_ITEMS} />
        </div>
      </div>
    </SettingsShell>
  )
}
