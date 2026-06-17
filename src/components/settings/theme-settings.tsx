"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { List, Moon, Monitor, Palette, Sun } from "lucide-react"
import {
  SaveStateText,
  SettingRow,
  SettingsSection,
  SettingsStatusChip,
} from "@/components/settings/settings-primitives"
import { cn } from "@/lib/utils"

const themeOptions = [
  { value: "system", label: "OS", icon: Monitor },
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
]

export function ThemeSettings() {
  const { theme, setTheme } = useTheme()
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle")

  const handleSelectTheme = (value: string) => {
    setTheme(value)
    setSaveState("saved")
    window.setTimeout(() => setSaveState("idle"), 1800)
  }

  return (
    <div className="space-y-5">
      <SettingsSection
        title="表示"
        description="低リスクな見た目の設定を同じ行形式で管理します。"
      >
        <SettingRow
          icon={Sun}
          title="テーマ"
          description="OS設定、ライト、ダークを切り替えます。"
          status={<SaveStateText state={saveState} />}
          control={
            <div className="grid min-h-10 grid-cols-3 overflow-hidden rounded-lg border border-white/[0.08] bg-black/20 p-1">
              {themeOptions.map(option => {
                const Icon = option.icon
                const active = (theme ?? "system") === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[12px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35",
                      active
                        ? "bg-zinc-100 text-zinc-950"
                        : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
                    )}
                    onClick={() => handleSelectTheme(option.value)}
                    aria-pressed={active}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {option.label}
                  </button>
                )
              })}
            </div>
          }
        />
        <SettingRow
          icon={List}
          title="表示密度"
          description="compact / comfortable は次フェーズで追加します。"
          status={<SettingsStatusChip tone="muted">準備中</SettingsStatusChip>}
        />
        <SettingRow
          icon={Palette}
          title="マップの配色"
          description="プロジェクト色はプロジェクト設定で管理します。"
          status={<SettingsStatusChip tone="muted">プロジェクト設定へ</SettingsStatusChip>}
        />
        <div className="flex min-h-[96px] items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-medium leading-5 text-zinc-50">Preview</h3>
            <p className="mt-1 text-[12px] leading-5 text-zinc-500">
              設定画面と同じプリミティブで表示確認します。
            </p>
          </div>
          <div className="w-full max-w-[280px] rounded-lg border border-white/[0.08] bg-zinc-100 p-4">
            <div className="h-2 w-24 rounded-full bg-zinc-400" />
            <div className="mt-3 h-2 w-full rounded-full bg-zinc-300" />
            <div className="mt-2 h-2 w-2/3 rounded-full bg-zinc-300" />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="保存状態">
        <SettingRow
          title="変更の反映"
          description="テーマ変更は端末の表示設定としてすぐ反映されます。"
          status={<SettingsStatusChip tone="neutral">保存済み</SettingsStatusChip>}
        />
      </SettingsSection>
    </div>
  )
}
