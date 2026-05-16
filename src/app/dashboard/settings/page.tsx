import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import type { LucideIcon } from "lucide-react"
import { Bot, Calendar, ChevronRight, FolderKanban, Key, Palette } from "lucide-react"

interface SettingsRow {
  href: string
  label: string
  description: string
  icon: LucideIcon
}

const SETTING_ROWS: SettingsRow[] = [
  { href: "/dashboard/settings/ai", label: "AI", description: "モデルとAIに渡す情報", icon: Bot },
  { href: "/dashboard/settings/integrations", label: "連携", description: "カレンダー・通知", icon: Calendar },
  { href: "/dashboard/settings/projects", label: "プロジェクトとリポジトリ", description: "色・自動スキャン・Claude起動先", icon: FolderKanban },
  { href: "/dashboard/settings/access", label: "アクセス", description: "APIキー・アカウント", icon: Key },
  { href: "/dashboard/settings/appearance", label: "表示", description: "テーマ・配色", icon: Palette },
]

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-bold">設定</h1>
      </div>

      <div className="mx-3 rounded-2xl bg-card overflow-hidden divide-y divide-border/40">
        {SETTING_ROWS.map(row => {
          const Icon = row.icon
          return (
            <Link
              key={row.href}
              href={row.href}
              className="flex items-center gap-3 min-h-[60px] px-4 py-2 active:bg-muted/60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-base">{row.label}</span>
                <span className="block text-[11px] text-muted-foreground truncate">{row.description}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground/60" />
            </Link>
          )
        })}
      </div>

      <p className="px-5 pt-2 text-[11px] text-muted-foreground leading-4">
        各項目をタップすると詳細設定が開きます。
      </p>
    </div>
  )
}
