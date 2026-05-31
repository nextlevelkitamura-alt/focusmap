"use client"

import { useMemo } from "react"
import type { CSSProperties } from "react"
import { endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns"
import type { Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { isJapaneseHoliday } from "@/lib/japanese-holidays"
import { buildTimeBlocksForDay, getAllDayEventsForDay } from "@/lib/today-range-blocks"
import { cn } from "@/lib/utils"

const MAX_VISIBLE_ENTRIES = 4
const MONTH_ENTRY_FONT_SIZE = 8
const MONTH_ENTRY_LINE_HEIGHT = 12
const MONTH_DAY_NUMBER_FONT_SIZE = 8

interface TodayMonthCalendarProps {
  selectedDate: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
  eventsLoading: boolean
  onDateSelect: (date: Date) => void
}

interface MonthEntry {
  id: string
  title: string
  color?: string
}

function addDays(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  d.setHours(0, 0, 0, 0)
  return d
}

function isHexColor(value?: string): value is string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "")
}

function entryStyle(color?: string): CSSProperties {
  if (!isHexColor(color)) {
    return {
      borderLeftColor: "#8fd77a",
      backgroundColor: "rgba(63, 70, 65, 0.72)",
      fontSize: MONTH_ENTRY_FONT_SIZE,
      lineHeight: `${MONTH_ENTRY_LINE_HEIGHT}px`,
      textOverflow: "clip",
    }
  }
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return {
    borderLeftColor: color,
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.24)`,
    fontSize: MONTH_ENTRY_FONT_SIZE,
    lineHeight: `${MONTH_ENTRY_LINE_HEIGHT}px`,
    textOverflow: "clip",
  }
}

function buildMonthDays(selectedDate: Date): Date[] {
  const start = startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 })
  const days: Date[] = []
  let cursor = start
  while (cursor <= end) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

export function TodayMonthCalendar({
  selectedDate,
  events,
  tasks,
  calendarColorMap,
  eventsLoading,
  onDateSelect,
}: TodayMonthCalendarProps) {
  const days = useMemo(() => buildMonthDays(selectedDate), [selectedDate])
  const today = useMemo(() => {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date
  }, [])
  const rows = Math.ceil(days.length / 7)
  const entriesByDay = useMemo(() => {
    const map = new Map<string, MonthEntry[]>()

    for (const day of days) {
      const key = format(day, "yyyy-MM-dd")
      const allDayEntries = getAllDayEventsForDay({ date: day, events, calendarColorMap }).map((event): MonthEntry => ({
        id: `all-day-${event.id}`,
        title: event.title,
        color: event.background_color,
      }))
      const timedEntries = buildTimeBlocksForDay({ date: day, events, tasks, calendarColorMap }).map((item): MonthEntry => ({
        id: `${item.source}-${item.id}`,
        title: item.title,
        color: item.color,
      }))

      map.set(key, [...allDayEntries, ...timedEntries])
    }

    return map
  }, [calendarColorMap, days, events, tasks])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background px-1 pb-1 pt-0.5">
      <div className="grid flex-shrink-0 grid-cols-7 border-b border-border/30 bg-background/95">
        {["月", "火", "水", "木", "金", "土", "日"].map((label) => (
          <div
            key={label}
            className={cn(
              "py-1.5 text-center text-[10px] font-semibold",
              label === "日" ? "text-red-300/90" : "text-muted-foreground",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      {eventsLoading && Array.from(entriesByDay.values()).every((entries) => entries.length === 0) ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">読み込み中...</div>
      ) : (
        <div
          className="grid min-h-0 flex-1 grid-cols-7 overflow-hidden border-l border-border/20"
          style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd")
            const entries = entriesByDay.get(key) ?? []
            const visibleEntries = entries.slice(0, MAX_VISIBLE_ENTRIES)
            const overflowCount = Math.max(entries.length - visibleEntries.length, 0)
            const isSunday = day.getDay() === 0
            const isHoliday = isJapaneseHoliday(day)
            const isCurrentMonth = isSameMonth(day, selectedDate)
            const isToday = isSameDay(day, today)

            return (
              <div
                key={key}
                role="button"
                tabIndex={0}
                onClick={() => onDateSelect(day)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    onDateSelect(day)
                  }
                }}
                className={cn(
                  "min-w-0 overflow-hidden border-b border-r border-border/20 px-[5px] pb-1 pt-1 text-left outline-none active:bg-muted/30",
                  !isCurrentMonth && "opacity-35",
                  isToday && "bg-white/[0.035] ring-1 ring-inset ring-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24),0_0_12px_rgba(255,255,255,0.16)]",
                )}
                style={{ contain: "paint" }}
              >
                <div className="mb-0.5 flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      "grid h-3.5 min-w-3.5 place-items-center rounded px-0.5 font-bold",
                      isSunday || isHoliday ? "text-red-300" : "text-muted-foreground",
                      isToday && "bg-white/15 text-white",
                    )}
                    style={{ fontSize: MONTH_DAY_NUMBER_FONT_SIZE, lineHeight: "10px" }}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {visibleEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="block h-3 w-full max-w-full overflow-hidden whitespace-nowrap rounded-[2px] border-l px-[4px] font-medium text-foreground/80"
                      style={entryStyle(entry.color)}
                    >
                      {entry.title}
                    </div>
                  ))}
                  {overflowCount > 0 && (
                    <div
                      className="block h-3 w-full max-w-full overflow-hidden whitespace-nowrap rounded-[2px] bg-muted/55 px-[4px] font-semibold text-muted-foreground"
                      style={{
                        fontSize: MONTH_ENTRY_FONT_SIZE,
                        lineHeight: `${MONTH_ENTRY_LINE_HEIGHT}px`,
                        textOverflow: "clip",
                      }}
                    >
                      +{overflowCount}件
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
