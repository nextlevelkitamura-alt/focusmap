"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  ChevronDown,
  Cloud,
  Code2,
  FolderKanban,
  Gauge,
  Globe2,
  KeyRound,
  Laptop,
  Monitor,
  Palette,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface SettingsNavItem {
  href: string
  label: string
  icon: LucideIcon
  active?: boolean
}

const NAV_ITEMS: SettingsNavItem[] = [
  { href: "/dashboard/settings", label: "一般", icon: Settings, active: true },
  { href: "/dashboard/settings/appearance", label: "外観", icon: Palette },
  { href: "/dashboard/settings/ai", label: "AI", icon: Bot },
  { href: "/dashboard/settings/integrations", label: "連携", icon: Calendar },
  { href: "/dashboard/settings/projects", label: "プロジェクト", icon: FolderKanban },
  { href: "/dashboard/settings/access", label: "アクセス", icon: KeyRound },
]

const WORK_MODES = [
  {
    id: "pro",
    title: "コーディング向け",
    description: "より詳細な計画と実行ログ",
    icon: Code2,
  },
  {
    id: "daily",
    title: "日常業務向け",
    description: "必要な確認だけに絞る",
    icon: Sparkles,
  },
]

function SettingRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-400">{description}</p>
      </div>
      <div className="sm:justify-self-end">{children}</div>
    </div>
  )
}

export function SettingsOverview() {
  const [workMode, setWorkMode] = useState("pro")
  const [defaultAccess, setDefaultAccess] = useState(true)
  const [autoReview, setAutoReview] = useState(true)
  const [fullAccess, setFullAccess] = useState(false)
  const [showMenuBar, setShowMenuBar] = useState(true)

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
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex min-h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 md:flex md:w-full",
                    item.active
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
          <div className="mx-auto w-full max-w-[780px]">
            <h1 className="text-xl font-semibold tracking-normal text-zinc-50">一般</h1>

            <section className="mt-12">
              <div className="mb-5">
                <h2 className="text-sm font-semibold text-zinc-100">作業モード</h2>
                <p className="mt-2 text-sm text-zinc-500">Focusmap が表示する技術的な詳細の量を選択</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {WORK_MODES.map(mode => {
                  const Icon = mode.icon
                  const selected = workMode === mode.id

                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setWorkMode(mode.id)}
                      className={cn(
                        "grid min-h-[84px] grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border px-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
                        selected
                          ? "border-white/[0.08] bg-[#292929] text-white"
                          : "border-white/10 bg-transparent text-zinc-200 hover:border-white/[0.16] hover:bg-white/[0.04]"
                      )}
                      aria-pressed={selected}
                    >
                      <Icon className="h-5 w-5 text-zinc-200" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{mode.title}</span>
                        <span className="mt-1 block text-xs text-zinc-400">{mode.description}</span>
                      </span>
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border",
                          selected ? "border-blue-400 bg-blue-500" : "border-zinc-600"
                        )}
                      >
                        {selected && <Check className="h-3 w-3 text-white" />}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="mt-11">
              <h2 className="mb-5 text-sm font-semibold text-zinc-100">権限</h2>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#202020]">
                <SettingRow
                  title="デフォルトの権限"
                  description="ワークスペース内のファイルを読み取り・編集できます。必要に応じて追加のアクセスを要求できます。"
                >
                  <Switch checked={defaultAccess} onCheckedChange={setDefaultAccess} className="data-[state=checked]:bg-blue-500" />
                </SettingRow>
                <div className="border-t border-white/[0.08]" />
                <SettingRow
                  title="自動レビュー"
                  description="実行前後に変更内容を確認し、危険な操作や想定外の差分を検出します。"
                >
                  <Switch checked={autoReview} onCheckedChange={setAutoReview} className="data-[state=checked]:bg-blue-500" />
                </SettingRow>
                <div className="border-t border-white/[0.08]" />
                <SettingRow
                  title="フルアクセス"
                  description="承認なしでローカルコマンドとネットワークを使えるようにします。信頼できる作業だけで有効にしてください。"
                >
                  <Switch checked={fullAccess} onCheckedChange={setFullAccess} className="data-[state=checked]:bg-blue-500" />
                </SettingRow>
              </div>
            </section>

            <section className="mt-11">
              <h2 className="mb-5 text-sm font-semibold text-zinc-100">一般</h2>
              <div className="overflow-hidden rounded-xl border border-white/10 bg-[#202020]">
                <SettingRow title="デフォルトで開く場所" description="ファイルやフォルダーを開く既定のアプリ">
                  <Select defaultValue="vscode">
                    <SelectTrigger className="h-9 w-full min-w-[210px] border-0 bg-white/[0.07] text-zinc-100 shadow-none focus:ring-blue-400">
                      <span className="inline-flex items-center gap-2">
                        <Monitor className="h-4 w-4 text-blue-400" />
                        <SelectValue />
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="vscode">VS Code</SelectItem>
                      <SelectItem value="cursor">Cursor</SelectItem>
                      <SelectItem value="finder">Finder</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <div className="border-t border-white/[0.08]" />
                <SettingRow title="言語" description="アプリ UI の表示言語">
                  <Select defaultValue="auto">
                    <SelectTrigger className="h-9 w-full min-w-[210px] border-0 bg-white/[0.07] text-zinc-100 shadow-none focus:ring-blue-400">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">自動検出</SelectItem>
                      <SelectItem value="ja">日本語</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <div className="border-t border-white/[0.08]" />
                <SettingRow title="メニューバーに表示" description="メインウィンドウを閉じても、Focusmap をメニューバーに表示する">
                  <Switch checked={showMenuBar} onCheckedChange={setShowMenuBar} className="data-[state=checked]:bg-blue-500" />
                </SettingRow>
              </div>
            </section>

            <section className="mt-11">
              <h2 className="mb-5 text-sm font-semibold text-zinc-100">状態</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: ShieldCheck, title: "認証", value: "接続済み" },
                  { icon: Cloud, title: "同期", value: "自動" },
                  { icon: Laptop, title: "実行PC", value: "このMac" },
                  { icon: Gauge, title: "実行ログ", value: "標準" },
                  { icon: Plug, title: "API", value: "有効" },
                  { icon: Globe2, title: "公開URL", value: "focusmap-official.com" },
                ].map(item => (
                  <div key={item.title} className="flex min-h-[68px] items-center gap-3 rounded-xl border border-white/10 bg-[#202020] px-4">
                    <item.icon className="h-4 w-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-zinc-500">{item.title}</p>
                      <p className="truncate text-sm font-medium text-zinc-100">{item.value}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 text-zinc-600" />
                  </div>
                ))}
              </div>
            </section>

            <section className="mt-11 rounded-xl border border-blue-400/20 bg-blue-400/[0.07] px-5 py-4">
              <div className="flex gap-3">
                <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
                <div>
                  <h2 className="text-sm font-semibold text-zinc-100">AI 実行環境</h2>
                  <p className="mt-1 text-xs leading-5 text-zinc-400">
                    詳細なAIモデル、外部連携、リポジトリ連携は左の項目から設定できます。
                  </p>
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  )
}
