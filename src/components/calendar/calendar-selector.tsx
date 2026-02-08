"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { RefreshCw, Settings, ChevronDown, CheckSquare, Square, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { useCalendars, type UserCalendar } from "@/hooks/useCalendars"

interface CalendarSelectorProps {
  onVisibleCalendarIdsChange?: (ids: string[]) => void
  compact?: boolean
}

export function CalendarSelector({ onVisibleCalendarIdsChange, compact = false }: CalendarSelectorProps) {
  const { calendars, isLoading, error, fetchCalendars, toggleCalendar, toggleAll } = useCalendars()

  // デバッグログ
  useEffect(() => {
    console.log('[CalendarSelector] State:', {
      isLoading,
      error: error?.message,
      calendarsCount: calendars.length,
      calendars: calendars.map(c => ({ name: c.name, id: c.google_calendar_id, selected: c.selected }))
    })
  }, [isLoading, error, calendars])

  // 表示中のカレンダーIDのリストを親に通知
  useEffect(() => {
    const visibleIds = calendars.filter(c => c.selected).map(c => c.google_calendar_id)
    onVisibleCalendarIdsChange?.(visibleIds)
  }, [calendars, onVisibleCalendarIdsChange])

  // 全選択チェック
  const allSelected = calendars.length > 0 && calendars.every(c => c.selected)
  const someSelected = calendars.some(c => c.selected) && !allSelected

  if (isLoading) {
    if (compact) {
      return (
        <div className="flex items-center gap-1 px-2">
          <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">読込中</span>
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center p-2">
        <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
        <span className="ml-1 text-[10px] text-muted-foreground">読み込み中...</span>
      </div>
    )
  }

  const handleDisconnect = async () => {
    if (!confirm('連携を解除しますか？')) return
    try {
      await fetch('/api/calendar/disconnect', { method: 'POST' })
      alert('連携を解除しました')
      window.location.reload()
    } catch (e) {
      alert('解除に失敗しました')
    }
  }

  // エラー表示の改善
  if (error) {
    const isTokenError = error.message.includes('OAuth') || error.message.includes('token') || error.message.includes('Calendar not connected');

    // Compact モード用のエラー表示
    if (compact) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] gap-1 px-2 text-red-600"
          onClick={() => window.location.href = '/api/calendar/connect'}
          title={error.message}
        >
          カレンダーエラー
        </Button>
      )
    }

    return (
      <div className="p-2 space-y-2">
        <div className="space-y-1">
          <p className="text-[10px] font-semibold text-red-600">接続エラー</p>
          <p className="text-[9px] text-muted-foreground">{error.message}</p>
        </div>

        {isTokenError ? (
          <div className="space-y-1">
            <Button
              onClick={() => window.location.href = '/api/calendar/connect'}
              size="sm"
              variant="default"
              className="w-full h-7 text-[10px]"
            >
              Google カレンダーに接続
            </Button>
            <p className="text-[9px] text-muted-foreground text-center">
              初回接続または再認証が必要です
            </p>
          </div>
        ) : (
          <div className="flex gap-1">
            <Button
              onClick={() => fetchCalendars()}
              size="sm"
              variant="outline"
              className="flex-1 h-6 text-[10px]"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              再試行
            </Button>
            <Button
              onClick={handleDisconnect}
              size="sm"
              variant="destructive"
              className="flex-1 h-6 text-[10px]"
            >
              解除
            </Button>
          </div>
        )}
      </div>
    )
  }

  if (calendars.length === 0) {
    // Compact モードでもエラー状態を表示
    if (compact) {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[10px] gap-1 px-2 text-muted-foreground"
          onClick={() => window.location.href = '/api/calendar/connect'}
        >
          カレンダー接続
        </Button>
      )
    }
    return (
      <div className="p-2 text-[10px] text-muted-foreground text-center">
        カレンダーが見つかりません
      </div>
    )
  }

  const selectedCount = calendars.filter(cal => cal.selected).length

  // Compact mode (dropdown)
  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-2">
            <span>カレンダー</span>
            <span className="text-muted-foreground">({selectedCount})</span>
            <ChevronDown className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48 max-h-64 overflow-y-auto">
          {calendars.map((calendar) => (
            <DropdownMenuCheckboxItem
              key={calendar.id}
              checked={calendar.selected}
              onCheckedChange={() => toggleCalendar(calendar.id, !calendar.selected)}
              className="flex items-center gap-2 py-1.5"
            >
              <div
                className="w-2.5 h-2.5 rounded-full shrink-0 border"
                style={{ backgroundColor: calendar.background_color || '#ccc' }}
              />
              <span className="flex-1 truncate text-[10px]">
                {calendar.name}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] text-muted-foreground">
              {allSelected ? '全解除' : '全選択'}
            </span>
            <button
              onClick={() => toggleAll(!allSelected)}
              className="p-0.5 hover:bg-accent rounded"
            >
              {allSelected ? (
                <X className="w-3 h-3 text-muted-foreground" />
              ) : (
                <CheckSquare className="w-3 h-3" />
              )}
            </button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  // Full mode
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-medium">マイカレンダー</span>
        <div className="flex gap-0.5">
          <Button
            onClick={() => fetchCalendars()}
            size="icon"
            variant="ghost"
            className="h-5 w-5 p-0"
            disabled={isLoading}
            title="更新"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Calendar List */}
      <div className="space-y-0.5 max-h-48 overflow-y-auto">
        {calendars.map((calendar) => (
          <label
            key={calendar.id}
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer transition-colors"
          >
            <input
              type="checkbox"
              checked={calendar.selected}
              onChange={() => toggleCalendar(calendar.id, !calendar.selected)}
              className="w-3 h-3 rounded"
            />
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0 border"
              style={{ backgroundColor: calendar.background_color || '#ccc' }}
            />
            <span className="text-[10px] flex-1 truncate" title={calendar.name}>
              {calendar.name}
            </span>
            {calendar.is_primary && (
              <span className="text-[8px] px-1 py-0 rounded bg-primary/10 text-primary">
                メイン
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}
