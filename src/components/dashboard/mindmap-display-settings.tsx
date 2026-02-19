"use client"

import * as React from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"
import { cn } from "@/lib/utils"

export interface MindMapDisplaySettings {
  showStatus: boolean;        // ●○ タスクステータス
  showPriority: boolean;      // [高][中][低] 優先度
  showScheduledAt: boolean;   // 1/5 10:00 日時設定
  showEstimatedTime: boolean; // 30分 見積もり時間
  showProgress: boolean;      // 2/5 進捗バー
  showCollapseButton: boolean; // > 折りたたみボタン
}

export const DEFAULT_SETTINGS: MindMapDisplaySettings = {
  showStatus: true,
  showPriority: true,
  showScheduledAt: false,
  showEstimatedTime: false,
  showProgress: true,
  showCollapseButton: true,
}

const STORAGE_KEY = "mindmap-display-settings"

// LocalStorage から設定を読み込み
export function loadSettings(): MindMapDisplaySettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_SETTINGS
    
    const parsed = JSON.parse(stored) as Partial<MindMapDisplaySettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch (error) {
    console.error("[MindMapSettings] Failed to load settings:", error)
    return DEFAULT_SETTINGS
  }
}

// LocalStorage に設定を保存
export function saveSettings(settings: MindMapDisplaySettings): void {
  if (typeof window === "undefined") return
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error) {
    console.error("[MindMapSettings] Failed to save settings:", error)
  }
}

interface MindMapDisplaySettingsProps {
  value: MindMapDisplaySettings
  onChange: (settings: MindMapDisplaySettings) => void
}

export function MindMapDisplaySettingsPopover({ value, onChange }: MindMapDisplaySettingsProps) {
  const [open, setOpen] = React.useState(false)

  const handleToggle = (key: keyof MindMapDisplaySettings) => {
    const newSettings = { ...value, [key]: !value[key] }
    onChange(newSettings)
    saveSettings(newSettings)
  }

  const handleAllOn = () => {
    const allOn: MindMapDisplaySettings = {
      showStatus: true,
      showPriority: true,
      showScheduledAt: true,
      showEstimatedTime: true,
      showProgress: true,
      showCollapseButton: true,
    }
    onChange(allOn)
    saveSettings(allOn)
  }

  const handleAllOff = () => {
    const allOff: MindMapDisplaySettings = {
      showStatus: false,
      showPriority: false,
      showScheduledAt: false,
      showEstimatedTime: false,
      showProgress: false,
      showCollapseButton: false,
    }
    onChange(allOff)
    saveSettings(allOff)
  }

  const handleReset = () => {
    onChange(DEFAULT_SETTINGS)
    saveSettings(DEFAULT_SETTINGS)
  }

  const settingItems: Array<{ key: keyof MindMapDisplaySettings; label: string; description: string }> = [
    { key: "showStatus", label: "タスクステータス", description: "●○" },
    { key: "showPriority", label: "優先度", description: "[高][中][低]" },
    { key: "showScheduledAt", label: "日時設定", description: "1/5 10:00" },
    { key: "showEstimatedTime", label: "見積もり時間", description: "30分" },
    { key: "showProgress", label: "進捗バー", description: "2/5" },
    { key: "showCollapseButton", label: "折りたたみボタン", description: ">" },
  ]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          title="MindMap表示設定"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          {/* Header */}
          <div className="border-b pb-2">
            <h3 className="text-sm font-semibold">MindMap 表示設定</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              表示する情報を選択してください
            </p>
          </div>

          {/* Settings List */}
          <div className="space-y-2">
            {settingItems.map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between cursor-pointer hover:bg-muted/30 p-1.5 rounded transition-colors"
              >
                <div className="flex items-center gap-2 flex-1">
                  <input
                    type="checkbox"
                    checked={value[item.key]}
                    onChange={() => handleToggle(item.key)}
                    className="h-4 w-4 rounded border-muted-foreground/30 text-primary focus:ring-primary cursor-pointer"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-medium">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground">{item.description}</div>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Actions */}
          <div className="border-t pt-2 flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleAllOn}
            >
              すべてON
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleAllOff}
            >
              すべてOFF
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              onClick={handleReset}
            >
              デフォルト
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
