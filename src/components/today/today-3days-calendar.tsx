"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { ChevronRight, X } from "lucide-react"
import type { Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import type { TimeBlock } from "@/lib/time-block"
import { buildTimeBlocksForDay } from "@/lib/today-range-blocks"
import { cn } from "@/lib/utils"

const START_HOUR = 0
const END_HOUR = 24
const DEFAULT_SCROLL_HOUR = 10
const HOUR_HEIGHT = 56
const SCROLL_LABEL_OFFSET = 12
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_HEIGHT
const GRID_COLUMNS = "48px repeat(3, minmax(0, 1fr))"
const CARD_LINE_HEIGHT = 12
const CARD_VERTICAL_PADDING = 8
const CARD_TEXT_SAFE_BUFFER = 10
const CHIP_TITLE_GAP = 12

interface Today3DaysCalendarProps {
  selectedDate: Date
  events: CalendarEvent[]
  tasks: Task[]
  calendarColorMap?: Map<string, string>
  eventsLoading: boolean
  getInitialScrollTop?: () => number | undefined
  onScrollPositionChange?: (scrollTop: number) => void
  onDateSelect?: (date: Date) => void
  onItemTap?: (item: TimeBlock) => void
}

interface OverflowGroup {
  date: Date
  hidden: TimeBlock[]
  start: Date
  end: Date
}

interface ConflictLayoutItem {
  item: TimeBlock
  column: number
  totalColumns: number
}

interface ConflictCluster {
  visible: ConflictLayoutItem[]
  hidden: TimeBlock[]
  start: Date
  end: Date
}

function startOfLocalDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function minutesFromDisplayDayStart(date: Date, displayDay: Date): number {
  const diffMs = date.getTime() - startOfLocalDay(displayDay).getTime()
  return Math.round(diffMs / 60000)
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function topForDate(date: Date, displayDay: Date): number {
  const min = minutesFromDisplayDayStart(date, displayDay)
  return ((clamp(min, START_HOUR * 60, END_HOUR * 60) - START_HOUR * 60) / 60) * HOUR_HEIGHT
}

function topForStart(item: TimeBlock): number {
  return topForDate(item.startTime, item.startTime)
}

function topForEnd(item: TimeBlock): number {
  return topForDate(item.endTime, item.startTime)
}

function heightFor(item: TimeBlock): number {
  const start = topForStart(item)
  const end = topForEnd(item)
  return Math.max(end - start, 58)
}

function isHexColor(value?: string): value is string {
  return /^#[0-9a-fA-F]{6}$/.test(value ?? "")
}

function eventStyle(color?: string): CSSProperties {
  if (!isHexColor(color)) {
    return {
      borderLeftColor: "#8fd77a",
      backgroundColor: "rgba(63, 70, 65, 0.78)",
    }
  }
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return {
    borderLeftColor: color,
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.24)`,
  }
}

function visualBottomFor(item: TimeBlock): number {
  return topForStart(item) + heightFor(item) + 4
}

function visuallyOverlaps(a: TimeBlock, b: TimeBlock): boolean {
  return topForStart(a) < visualBottomFor(b) && visualBottomFor(a) > topForStart(b)
}

function firstAvailableColumn(item: TimeBlock, columns: TimeBlock[][]): number {
  for (let column = 0; column < columns.length; column += 1) {
    if (!columns[column].some((existing) => visuallyOverlaps(item, existing))) return column
  }
  return columns.length
}

function buildConflictClusters(items: TimeBlock[]): ConflictCluster[] {
  const sorted = [...items].sort((a, b) => {
    const start = a.startTime.getTime() - b.startTime.getTime()
    if (start !== 0) return start
    return (b.endTime.getTime() - b.startTime.getTime()) - (a.endTime.getTime() - a.startTime.getTime())
  })
  const groups: TimeBlock[][] = []
  let current: TimeBlock[] = []
  let clusterEnd = 0

  for (const item of sorted) {
    const start = topForStart(item)
    const end = visualBottomFor(item)
    if (current.length === 0 || start < clusterEnd) {
      current.push(item)
      clusterEnd = Math.max(clusterEnd, end)
    } else {
      groups.push(current)
      current = [item]
      clusterEnd = end
    }
  }
  if (current.length > 0) groups.push(current)

  return groups.map((group) => {
    const columns: TimeBlock[][] = []
    const assignments = group.map((item) => {
      const column = firstAvailableColumn(item, columns)
      if (!columns[column]) columns[column] = []
      columns[column].push(item)
      return { item, column }
    })
    const totalColumns = Math.min(columns.length, 2)

    return {
      visible: assignments
        .filter((assignment) => assignment.column < 2)
        .map((assignment) => ({ ...assignment, totalColumns })),
      hidden: assignments
        .filter((assignment) => assignment.column >= 2)
        .map((assignment) => assignment.item),
      start: new Date(Math.min(...group.map((item) => item.startTime.getTime()))),
      end: new Date(Math.max(...group.map((item) => item.endTime.getTime()))),
    }
  })
}

function addDays(date: Date, amount: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + amount)
  d.setHours(0, 0, 0, 0)
  return d
}

function overlapsVisibleRange(item: TimeBlock): boolean {
  const start = minutesFromDisplayDayStart(item.startTime, item.startTime)
  const end = minutesFromDisplayDayStart(item.endTime, item.startTime)
  return end > START_HOUR * 60 && start < END_HOUR * 60
}

function eventPositionStyle(layout: ConflictLayoutItem): CSSProperties {
  const top = topForStart(layout.item)
  const height = heightFor(layout.item)

  if (layout.totalColumns <= 1) {
    return {
      top,
      height,
      left: 4,
      width: "calc(100% - 8px)",
    }
  }

  return {
    top,
    height,
    left: layout.column === 0 ? 4 : "calc(50% + 2px)",
    width: "calc(50% - 6px)",
  }
}

function overflowChipStyle(cluster: ConflictCluster, chipTop: number): CSSProperties {
  const anchor = cluster.visible.find((layout) => layout.column === 1) ?? cluster.visible[0]
  const anchorTop = anchor ? topForStart(anchor.item) : chipTop
  const anchorHeight = anchor ? heightFor(anchor.item) : 58
  const titleBottom = anchor
    ? anchorTop + 4 + titleLineCount(anchor.item) * CARD_LINE_HEIGHT + CHIP_TITLE_GAP
    : chipTop
  const top = clamp(titleBottom, anchorTop + 12, anchorTop + anchorHeight + 6)

  if (!anchor || anchor.totalColumns <= 1) {
    return {
      top,
      right: 4,
    }
  }

  return {
    top,
    left: "calc(100% - 31px)",
  }
}

function titleLineCount(item: TimeBlock): number {
  return Math.max(
    1,
    Math.min(4, Math.floor((heightFor(item) - CARD_VERTICAL_PADDING - CARD_TEXT_SAFE_BUFFER) / CARD_LINE_HEIGHT)),
  )
}

export function Today3DaysCalendar({
  selectedDate,
  events,
  tasks,
  calendarColorMap,
  eventsLoading,
  getInitialScrollTop,
  onScrollPositionChange,
  onDateSelect,
  onItemTap,
}: Today3DaysCalendarProps) {
  const [overflowGroup, setOverflowGroup] = useState<OverflowGroup | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const days = useMemo(() => [0, 1, 2].map((i) => addDays(selectedDate, i)), [selectedDate])
  const dayBlocks = useMemo(
    () => days.map((date) => buildTimeBlocksForDay({ date, events, tasks, calendarColorMap }).filter(overlapsVisibleRange)),
    [calendarColorMap, days, events, tasks],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        const scrollTo = getInitialScrollTop?.() ?? DEFAULT_SCROLL_HOUR * HOUR_HEIGHT - SCROLL_LABEL_OFFSET
        scrollContainerRef.current.scrollTop = Math.max(0, scrollTo)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [getInitialScrollTop])

  return (
    <div
      ref={scrollContainerRef}
      className="relative flex-1 min-h-0 overflow-auto no-scrollbar bg-background"
      onScroll={() => {
        if (scrollContainerRef.current) {
          onScrollPositionChange?.(scrollContainerRef.current.scrollTop)
        }
      }}
    >
      <div className="sticky top-0 z-40 h-0 overflow-visible">
        <div
          className="grid h-8 border-b border-border/40 bg-background shadow-[0_1px_0_rgba(255,255,255,0.04)]"
          style={{ gridTemplateColumns: GRID_COLUMNS }}
        >
          <div className="border-r border-border/30 bg-background" />
          {days.map((day) => {
            const isSunday = day.getDay() === 0
            return (
              <button
                type="button"
                key={day.toISOString()}
                onClick={() => onDateSelect?.(day)}
                className={cn(
                  "border-r border-border/30 bg-background px-1.5 text-center text-[11px] font-semibold active:bg-muted/30",
                  isSunday ? "text-red-300/90" : "text-muted-foreground",
                )}
                aria-label={`${format(day, "M/d(E)", { locale: ja })}をDayで表示`}
              >
                {format(day, "M/d(E)", { locale: ja })}
              </button>
            )
          })}
        </div>
      </div>

      {eventsLoading && dayBlocks.every((items) => items.length === 0) ? (
        <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: GRID_COLUMNS, height: TOTAL_HEIGHT }}>
          <div className="relative border-r border-border/30 bg-background/90 pointer-events-none select-none" aria-hidden="true">
            {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index).map((hour) => (
              <div
                key={hour}
                className="absolute flex w-full justify-end pr-2 text-[10px] font-medium text-muted-foreground/70"
                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT - 6 }}
              >
                {hour !== 0 && `${hour}:00`}
              </div>
            ))}
          </div>

          {days.map((day, dayIndex) => {
            const clusters = buildConflictClusters(dayBlocks[dayIndex])
            return (
              <div key={day.toISOString()} className="relative border-r border-border/30">
                {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
                  <div
                    key={index}
                    className="absolute left-0 right-0 border-t border-border/20"
                    style={{ top: index * HOUR_HEIGHT }}
                  />
                ))}

                {Array.from({ length: END_HOUR - START_HOUR }, (_, index) => (
                  <div
                    key={`half-${index}`}
                    className="absolute left-0 right-0 border-t border-dashed border-border/10"
                    style={{ top: index * HOUR_HEIGHT + HOUR_HEIGHT / 2 }}
                  />
                ))}

                {clusters.map((cluster, clusterIndex) => {
                  const hasHidden = cluster.hidden.length > 0
                  const hiddenStart = hasHidden
                    ? new Date(Math.min(...cluster.hidden.map((item) => item.startTime.getTime())))
                    : cluster.start
                  const hiddenEnd = hasHidden
                    ? new Date(Math.max(...cluster.hidden.map((item) => item.endTime.getTime())))
                    : cluster.end
                  const clusterTop = topForDate(cluster.start, cluster.start)
                  const clusterHeight = Math.max(topForDate(cluster.end, cluster.start) - clusterTop, 30)
                  const chipTop = clamp(topForDate(hiddenStart, cluster.start), clusterTop + 3, clusterTop + Math.max(3, clusterHeight - 28))
                  return (
                    <Fragment key={`${day.toISOString()}-${clusterIndex}-${cluster.start.getTime()}`}>
                      {cluster.visible.map((layout) => (
                        <button
                          key={`${layout.item.source}-${layout.item.id}`}
                          type="button"
                          onClick={() => onItemTap?.(layout.item)}
                          className="absolute z-10 flex min-w-0 items-start justify-start overflow-hidden rounded-md border-l-[3px] text-left align-top shadow-sm active:opacity-80"
                          style={{
                            ...eventStyle(layout.item.color),
                            ...eventPositionStyle(layout),
                            paddingLeft: 4,
                            paddingRight: 4,
                            paddingTop: 4,
                            paddingBottom: 4,
                          }}
                        >
                          <span
                            className="m-0 block w-full min-w-0 self-start overflow-hidden whitespace-normal text-left text-[10px] font-semibold leading-[12px] text-foreground"
                            style={{
                              display: "-webkit-box",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              WebkitBoxOrient: "vertical",
                              WebkitLineClamp: titleLineCount(layout.item),
                            }}
                          >
                            {layout.item.title}
                          </span>
                        </button>
                      ))}
                      {hasHidden && (
                        <button
                          type="button"
                          onClick={() => setOverflowGroup({ date: day, hidden: cluster.hidden, start: hiddenStart, end: hiddenEnd })}
                          className="absolute z-20 grid h-7 w-7 place-items-center rounded-full border border-primary/45 bg-background/95 text-[10px] font-bold text-primary shadow-lg active:scale-95"
                          style={overflowChipStyle(cluster, chipTop)}
                          aria-label={`${cluster.hidden.length}件の重なっている予定を表示`}
                        >
                          +{cluster.hidden.length}
                        </button>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      {overflowGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/58 px-4 backdrop-blur-[2px]">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="閉じる"
            onClick={() => setOverflowGroup(null)}
          />
          <div className="relative w-full max-w-[340px] rounded-2xl border border-border/70 bg-background/95 p-4 shadow-2xl">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-primary">
                  {format(overflowGroup.date, "M/d(E)", { locale: ja })} {format(overflowGroup.start, "HH:mm")} - {format(overflowGroup.end, "HH:mm")}
                </div>
                <div className="mt-0.5 text-base font-bold">他の予定</div>
              </div>
              <button
                type="button"
                onClick={() => setOverflowGroup(null)}
                className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              {overflowGroup.hidden.map((item) => (
                <button
                  key={`${item.source}-${item.id}`}
                  type="button"
                  onClick={() => {
                    setOverflowGroup(null)
                    onItemTap?.(item)
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-left active:bg-muted/45"
                >
                  <span className="h-10 w-1 rounded-full" style={{ backgroundColor: item.color || "#8fd77a" }} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-muted-foreground">
                      {format(item.startTime, "HH:mm")} - {format(item.endTime, "HH:mm")}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-semibold text-foreground">
                      {item.title}
                    </span>
                    {(item.originalEvent?.description || item.originalTask?.memo) && (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {item.originalEvent?.description || item.originalTask?.memo}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
