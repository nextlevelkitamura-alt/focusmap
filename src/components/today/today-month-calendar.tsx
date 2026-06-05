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
const MOBILE_MAX_VISIBLE_ENTRIES = 4
const MOBILE_MAX_VISIBLE_ENTRIES_DENSE = 4
const MONTH_ENTRY_FONT_SIZE = 8
const MONTH_ENTRY_LINE_HEIGHT = 12
const MONTH_DAY_NUMBER_FONT_SIZE = 8
const MOBILE_MONTH_ENTRY_FONT_SIZE = 9
const MOBILE_MONTH_ENTRY_LINE_HEIGHT = 14
const MOBILE_MONTH_DAY_NUMBER_FONT_SIZE = 10

interface TodayMonthCalendarProps {
  selectedDate: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
  eventsLoading: boolean
  onDateSelect: (date: Date) => void
  variant?: "default" | "mobile"
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

function entryStyle(color?: string, variant: "default" | "mobile" = "default"): CSSProperties {
  const isMobile = variant === "mobile"

  if (!isHexColor(color)) {
    return {
      borderLeftColor: "#8fd77a",
      backgroundColor: isMobile ? "rgba(25, 74, 68, 0.82)" : "rgba(63, 70, 65, 0.72)",
      color: isMobile ? "#eef8f4" : undefined,
      fontSize: isMobile ? MOBILE_MONTH_ENTRY_FONT_SIZE : MONTH_ENTRY_FONT_SIZE,
      lineHeight: `${isMobile ? MOBILE_MONTH_ENTRY_LINE_HEIGHT : MONTH_ENTRY_LINE_HEIGHT}px`,
      textOverflow: "clip",
    }
  }
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return {
    borderLeftColor: color,
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${isMobile ? 0.34 : 0.24})`,
    color: isMobile ? "#f4fbf7" : undefined,
    fontSize: isMobile ? MOBILE_MONTH_ENTRY_FONT_SIZE : MONTH_ENTRY_FONT_SIZE,
    lineHeight: `${isMobile ? MOBILE_MONTH_ENTRY_LINE_HEIGHT : MONTH_ENTRY_LINE_HEIGHT}px`,
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
  variant = "default",
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
  const isMobile = variant === "mobile"
  const visibleEntryLimit = isMobile
    ? rows <= 5
      ? MOBILE_MAX_VISIBLE_ENTRIES
      : MOBILE_MAX_VISIBLE_ENTRIES_DENSE
    : MAX_VISIBLE_ENTRIES

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        isMobile ? "bg-[#050708] text-neutral-100" : "bg-background px-1 pb-1 pt-0.5",
      )}
    >
      <div
        className={cn(
          "grid flex-shrink-0 grid-cols-7 border-b",
          isMobile ? "h-8 border-white/15 bg-[#090b0d]" : "border-border/30 bg-background/95",
        )}
      >
        {["月", "火", "水", "木", "金", "土", "日"].map((label) => (
          <div
            key={label}
            className={cn(
              "text-center font-semibold",
              isMobile ? "grid place-items-center text-[10px]" : "py-1.5 text-[10px]",
              label === "日"
                ? isMobile
                  ? "text-[#ff7373]"
                  : "text-red-300/90"
                : isMobile
                  ? "text-neutral-400"
                  : "text-muted-foreground",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      {eventsLoading && Array.from(entriesByDay.values()).every((entries) => entries.length === 0) ? (
        <div className={cn("flex flex-1 items-center justify-center text-sm", isMobile ? "text-neutral-400" : "text-muted-foreground")}>読み込み中...</div>
      ) : (
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-7 overflow-hidden border-l",
            isMobile ? "border-white/15" : "border-border/20",
          )}
          style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
        >
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd")
            const entries = entriesByDay.get(key) ?? []
            const visibleEntries = entries.slice(0, visibleEntryLimit)
            const overflowCount = Math.max(entries.length - visibleEntries.length, 0)
            const isSunday = day.getDay() === 0
            const isHoliday = isJapaneseHoliday(day)
            const isCurrentMonth = isSameMonth(day, selectedDate)
            const isToday = isSameDay(day, today)
            const isSelected = isSameDay(day, selectedDate)

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
                  "min-w-0 overflow-hidden border-b border-r text-left outline-none",
                  isMobile
                    ? "border-white/15 px-[2px] pb-1 pt-1 active:bg-white/[0.06]"
                    : "border-border/20 px-[5px] pb-1 pt-1 active:bg-muted/30",
                  !isCurrentMonth && (isMobile ? "opacity-38" : "opacity-35"),
                  isMobile && isSelected && "bg-white/[0.035] ring-1 ring-inset ring-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_0_14px_rgba(255,255,255,0.12)]",
                  !isMobile && isToday && "bg-white/[0.035] ring-1 ring-inset ring-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.24),0_0_12px_rgba(255,255,255,0.16)]",
                )}
                style={{ contain: "paint" }}
              >
                <div className="mb-0.5 flex items-start justify-between gap-1">
                  <span
                    className={cn(
                      "grid place-items-center font-bold",
                      isMobile ? "h-3.5 min-w-3.5 rounded-full px-0.5" : "h-3.5 min-w-3.5 rounded px-0.5",
                      isSunday || isHoliday
                        ? isMobile
                          ? "text-[#ff7373]"
                          : "text-red-300"
                        : isMobile
                          ? "text-neutral-100"
                          : "text-muted-foreground",
                      isMobile && isToday && !isSelected && "text-[#74cfb2]",
                      isMobile && isSelected && "bg-[#74cfb2] text-[#05100d]",
                      !isMobile && isToday && "bg-white/15 text-white",
                    )}
                    style={{
                      fontSize: isMobile ? MOBILE_MONTH_DAY_NUMBER_FONT_SIZE : MONTH_DAY_NUMBER_FONT_SIZE,
                      lineHeight: isMobile ? "10px" : "10px",
                    }}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                <div className="space-y-0.5">
                  {visibleEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "block w-full max-w-full overflow-hidden whitespace-nowrap border-l font-medium",
                        isMobile
                          ? "h-3.5 rounded-[2px] px-[2px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
                          : "h-3 rounded-[2px] px-[4px] text-foreground/80",
                      )}
                      style={entryStyle(entry.color, variant)}
                    >
                      {entry.title}
                    </div>
                  ))}
                  {overflowCount > 0 && (
                    <div
                      className={cn(
                        "block w-full max-w-full overflow-hidden whitespace-nowrap font-semibold",
                        isMobile
                          ? "h-3.5 rounded-[2px] px-[2px] text-neutral-300"
                          : "h-3 rounded-[2px] bg-muted/55 px-[4px] text-muted-foreground",
                      )}
                      style={{
                        backgroundColor: isMobile ? "transparent" : undefined,
                        fontSize: isMobile ? MOBILE_MONTH_ENTRY_FONT_SIZE : MONTH_ENTRY_FONT_SIZE,
                        lineHeight: `${isMobile ? MOBILE_MONTH_ENTRY_LINE_HEIGHT : MONTH_ENTRY_LINE_HEIGHT}px`,
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
