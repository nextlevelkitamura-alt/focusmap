"use client"

import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Bot, Calendar, ChevronRight, FolderKanban, KeyRound, Palette, Sparkles } from "lucide-react"
import { SettingsShell } from "@/components/settings/settings-shell"

interface OverviewItem {
  href: string
  title: string
  description: string
  icon: LucideIcon
  accent: string
}

const PRIMARY_ITEMS: OverviewItem[] = [
  {
    href: "/dashboard/settings/ai",
    title: "AI",
    description: "モデル選択と、AIに渡す自分・プロジェクト情報を管理",
    icon: Bot,
    accent: "from-violet-500/25 to-blue-500/10 text-violet-200",
  },
  {
    href: "/dashboard/settings/integrations",
    title: "Googleカレンダー",
    description: "連携アカウント、取り込み期間、取り込むカレンダーを設定",
    icon: Calendar,
    accent: "from-blue-500/25 to-emerald-500/10 text-blue-200",
  },
  {
    href: "/dashboard/settings/projects",
    title: "プロジェクト",
    description: "プロジェクト色、リポジトリ、ローカル実行先を整理",
    icon: FolderKanban,
    accent: "from-amber-500/25 to-orange-500/10 text-amber-200",
  },
]

const SECONDARY_ITEMS: OverviewItem[] = [
  {
    href: "/dashboard/settings/access",
    title: "アクセス",
    description: "APIキーとアカウント",
    icon: KeyRound,
    accent: "from-zinc-500/20 to-zinc-500/5 text-zinc-200",
  },
  {
    href: "/dashboard/settings/appearance",
    title: "外観",
    description: "テーマと表示",
    icon: Palette,
    accent: "from-pink-500/20 to-sky-500/5 text-pink-200",
  },
]

function SettingsLinkCard({ item, compact = false }: { item: OverviewItem; compact?: boolean }) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      className="group flex min-h-[132px] flex-col justify-between rounded-xl border border-white/10 bg-[#202020] p-5 transition hover:border-white/20 hover:bg-[#262626] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      <div className="flex items-start justify-between gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${item.accent}`}>
          <Icon className="h-5 w-5" />
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-300" />
      </div>
      <div className={compact ? "mt-5" : "mt-8"}>
        <h2 className="text-sm font-semibold text-zinc-50">{item.title}</h2>
        <p className="mt-2 text-xs leading-5 text-zinc-400">{item.description}</p>
      </div>
    </Link>
  )
}

export function SettingsOverview() {
  return (
    <SettingsShell
      title="設定"
      description="実際に使う設定だけを置いています。細かい調整は各カテゴリから行えます。"
    >
      <section>
        <div className="mb-5 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-300" />
          <h2 className="text-sm font-semibold text-zinc-100">よく使う設定</h2>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {PRIMARY_ITEMS.map(item => <SettingsLinkCard key={item.href} item={item} />)}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-5 text-sm font-semibold text-zinc-100">その他</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SECONDARY_ITEMS.map(item => <SettingsLinkCard key={item.href} item={item} compact />)}
        </div>
      </section>
    </SettingsShell>
  )
}
