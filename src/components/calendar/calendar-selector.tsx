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

  // 表示中のカレンダーIDのリストを親に通知
  useEffect(() => {
    const visibleIds = calendars.filter(c => c.selected).map(c => c.google_calendar_id)
    onVisibleCalendarIdsChange?.(visibleIds)
  }, [calendars, onVisibleCalendarIdsChange])

  // 全選択チェック
  const allSelected = calendars.length > 0 && calendars.every(c => c.selected)
  const someSelected = calendars.some(c => c.selected) && !allSelected

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-2">
        <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
        <span className="ml-1 text-[10px] text-muted-foreground">読み込み中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-2 space-y-1">
        <p className="text-[10px] text-red-500">{error.message}</p>
        <Button
          onClick={() => fetchCalendars()}
          size="sm"
          variant="outline"
          className="w-full h-6 text-[10px]"
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          再試行
        </Button>
      </div>
    )
  }

  if (calendars.length === 0) {
    return compact ? null : (
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
