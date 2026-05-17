"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { Calendar, Check, Link2, Mail, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCalendars } from "@/hooks/useCalendars"

interface CalendarStatus {
  isConnected: boolean
  tokenExpired?: boolean
  linkedAccount?: {
    name: string | null
    email: string
    picture: string | null
  } | null
}

/**
 * ダッシュボード右パネルに表示する「カレンダー連携カード」
 *
 * - 未接続: 接続ボタン
 * - 接続済み: 連携アカウント表示 + 「取り込むカレンダー」チェックボックスリスト
 *
 * 設定ページの calendar-settings.tsx よりコンパクトで、Today画面のサイドに置く想定。
 */
export function DashboardCalendarPanel() {
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const { calendars, isLoading: calendarsLoading, toggleCalendar } = useCalendars()
  const [expanded, setExpanded] = useState(true)

  useEffect(() => {
    fetch("/api/calendar/status")
      .then(res => (res.ok ? res.json() : null))
      .then(data => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setStatusLoading(false))
  }, [])

  if (statusLoading) {
    return (
      <div className="mx-3 mt-2 py-3 px-3 rounded-lg border border-border bg-muted/20 flex items-center gap-2 text-xs text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        カレンダー連携情報を確認しています…
      </div>
    )
  }

  // 未接続表示
  if (!status?.isConnected || status?.tokenExpired) {
    const isReconnect = !!status?.tokenExpired
    return (
      <div className="mx-3 mt-2 py-3 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
        <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
          {isReconnect ? "再接続が必要です" : "カレンダーに接続されていません"}
        </p>
        <p className="text-[10px] text-blue-700 dark:text-blue-300 mt-1">
          {isReconnect
            ? "アクセストークンが期限切れです。再接続してください。"
            : "Googleカレンダーと連携すると、予定を自動で表示できます"}
        </p>
        <button
          onClick={() => (window.location.href = "/api/calendar/connect")}
          className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
        >
          <Link2 className="w-3 h-3" />
          {isReconnect ? "再接続する" : "カレンダーを接続"}
        </button>
      </div>
    )
  }

  // 接続済み表示
  const linkedAccount = status.linkedAccount
  const selectedCount = calendars.filter(c => c.selected).length
  const totalCount = calendars.length

  return (
    <div className="mx-3 mt-2 rounded-lg border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/40 dark:bg-emerald-950/20 overflow-hidden">
      {/* ヘッダー */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/20 transition-colors text-left"
      >
        <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-emerald-900 dark:text-emerald-100 truncate">
            Googleカレンダー連携中
          </p>
          {linkedAccount?.email ? (
            <p className="text-[10px] text-emerald-800/80 dark:text-emerald-200/70 truncate flex items-center gap-1">
              <Mail className="w-2.5 h-2.5 shrink-0" />
              {linkedAccount.email}
            </p>
          ) : (
            <p className="text-[10px] text-emerald-800/60 dark:text-emerald-200/50">
              アカウント情報を取得中…
            </p>
          )}
        </div>
        <span className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 shrink-0">
          {selectedCount}/{totalCount}
        </span>
      </button>

      {/* カレンダー選択 */}
      {expanded && (
        <div className="border-t border-emerald-200/60 dark:border-emerald-900/40 px-3 py-2 space-y-1.5 bg-white/40 dark:bg-black/20">
          <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1">
            <Calendar className="w-3 h-3" />
            取り込むカレンダーを選択
          </p>

          {calendarsLoading ? (
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-1">
              <RefreshCw className="w-3 h-3 animate-spin" />
              読み込み中…
            </div>
          ) : calendars.length === 0 ? (
            <p className="text-[10px] text-muted-foreground py-1">
              利用可能なカレンダーがありません
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto space-y-1 -mr-1 pr-1">
              {calendars.map(cal => (
                <label
                  key={cal.id}
                  className={cn(
                    "flex items-center gap-2 px-1.5 py-1 rounded cursor-pointer hover:bg-muted/40 transition-colors",
                    cal.selected && "bg-muted/30"
                  )}
                >
                  <input
                    type="checkbox"
                    checked={cal.selected}
                    onChange={e => {
                      toggleCalendar(cal.id, e.target.checked).catch(() => {})
                    }}
                    className="w-3 h-3 rounded border-gray-300"
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: cal.background_color || cal.color || "#039BE5" }}
                  />
                  <span className="text-[11px] truncate flex-1" title={cal.name}>
                    {cal.name}
                    {cal.is_primary && (
                      <span className="ml-1 text-[9px] text-muted-foreground">(プライマリ)</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <p className="text-[9px] text-muted-foreground/70 pt-1">
            選択を変更すると、Todayタイムラインに表示される予定が変わります
          </p>
        </div>
      )}
    </div>
  )
}
