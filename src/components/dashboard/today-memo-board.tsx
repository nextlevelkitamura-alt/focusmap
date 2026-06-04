"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type TouchEvent, type WheelEvent } from "react"
import { CalendarDays, Loader2, Plus } from "lucide-react"
import type { IdealGoalWithItems, Project } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import {
  CALENDAR_EVENT_MEMO_DRAG_MIME,
  SCHEDULED_MEMO_DRAG_MIME,
  SCHEDULED_MEMO_INDEX_EVENT,
  WISHLIST_REFRESH_EVENT,
} from "@/lib/calendar-constants"
import { WishlistCard } from "@/components/wishlist/wishlist-card"
import { WishlistCardDetail } from "@/components/wishlist/wishlist-card-detail"
import {
  broadcastCalendarSync,
  broadcastEventCompletion,
  invalidateCalendarCache,
  broadcastCalendarOptimisticEvent,
  broadcastCalendarOptimisticEventRemoval,
} from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { fetchWishlistItems, invalidateWishlistItemsCache } from "@/lib/wishlist-cache"
import {
  broadcastCalendarEventToMemoConverted,
  confirmCalendarEventMemoDeleteScope,
  convertCalendarEventToMemo,
  type CalendarEventMemoPayload,
} from "@/lib/calendar-event-to-memo"

type ColumnKey = "today" | "unsorted" | "scheduled" | "mapped" | "completed"
type MemoItem = IdealGoalWithItems & {
  mindmap_link_count?: number | null
  mindmap_linked_at?: string | null
  mindmap_task_ids?: string[] | null
}
type ScheduledMemoIndexEntry = {
  memoId: string
  title: string
}
type ScheduledMemoDragPayload = {
  memoId?: string
  googleEventId?: string
  calendarId?: string
  title?: string
}
type CalendarEventMemoDragPayload = CalendarEventMemoPayload

declare global {
  interface Window {
    __focusmapScheduledMemoIndex?: Record<string, ScheduledMemoIndexEntry>
    __focusmapScheduledMemoDrag?: ScheduledMemoDragPayload | null
    __focusmapScheduledMemoDropHandler?: (payload: ScheduledMemoDragPayload) => void | Promise<void>
    __focusmapCalendarEventMemoDrag?: CalendarEventMemoDragPayload | null
    __focusmapCalendarEventMemoDropHandler?: (payload: CalendarEventMemoDragPayload) => void | Promise<void>
  }
}

const COLUMN_ORDER: ColumnKey[] = ["today", "unsorted", "scheduled", "mapped", "completed"]
const COLUMN_LABEL: Record<ColumnKey, string> = {
  today: "今日する",
  unsorted: "未予定",
  scheduled: "予定済み",
  mapped: "マップ追加済み",
  completed: "完了",
}
const COLUMN_EMPTY_TEXT: Record<ColumnKey, string> = {
  today: "今日するメモはありません。",
  unsorted: "未予定のメモはありません。",
  scheduled: "予定済みのメモはありません。",
  mapped: "マップ追加済みのメモはありません。",
  completed: "完了したメモはありません。",
}
const WHEEL_GESTURE_IDLE_MS = 180
const WHEEL_INERTIA_SUPPRESS_MS = 600
const WHEEL_NEW_GESTURE_DELTA = 16
const WHEEL_NEW_GESTURE_RATIO = 1.35
const TODAY_MEMO_REFRESH_SOURCE = "today-memo-board"

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function getTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function extractMindmapTaskIds(item: MemoItem | null | undefined): string[] {
  const payload = readRecord(item?.ai_source_payload)
  const links = Array.isArray(payload.mindmap_links) ? payload.mindmap_links : []
  return Array.from(new Set([
    ...(Array.isArray(item?.mindmap_task_ids) ? item.mindmap_task_ids : []),
    ...links
      .map(link => readRecord(link).task_id)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
  ]))
}

function hasMindmapLinks(item: MemoItem | null | undefined): boolean {
  return (item?.mindmap_link_count ?? 0) > 0 || extractMindmapTaskIds(item).length > 0
}

function getManualColumn(item: MemoItem | null | undefined): ColumnKey | null {
  const column = readRecord(item?.ai_source_payload).manual_column
  return column === "mapped" || column === "today" || column === "scheduled" || column === "completed" || column === "unsorted"
    ? column
    : null
}

function getColumn(item: MemoItem, todayStart: number, todayEnd: number): ColumnKey {
  if (item.is_completed || item.memo_status === "completed") return "completed"
  const sched = item.scheduled_at ? new Date(item.scheduled_at).getTime() : null
  const isScheduledToday = sched != null && !Number.isNaN(sched) && sched >= todayStart && sched < todayEnd
  if (item.is_today || isScheduledToday) return "today"
  if (item.google_event_id || item.scheduled_at || item.memo_status === "scheduled") return "scheduled"
  if (hasMindmapLinks(item) || getManualColumn(item) === "mapped") return "mapped"
  return "unsorted"
}

function sortMemoItemsForColumn(items: MemoItem[], column: ColumnKey) {
  return [...items].sort((a, b) => {
    if (column === "today") {
      const sa = getTimestamp(a.scheduled_at)
      const sb = getTimestamp(b.scheduled_at)
      if (sa === 0 && sb !== 0) return 1
      if (sa !== 0 && sb === 0) return -1
      return sa - sb || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
    }
    if (column === "scheduled") {
      return getTimestamp(a.scheduled_at) - getTimestamp(b.scheduled_at)
        || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
    }
    if (column === "mapped") {
      return getTimestamp(b.mindmap_linked_at) - getTimestamp(a.mindmap_linked_at)
        || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
        || getTimestamp(b.created_at) - getTimestamp(a.created_at)
    }
    if (column === "completed") {
      return getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
        || getTimestamp(b.created_at) - getTimestamp(a.created_at)
    }
    return getTimestamp(b.created_at) - getTimestamp(a.created_at)
      || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
  })
}

function toTokyoDateString(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date()
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(safeDate)
  const year = parts.find(part => part.type === "year")?.value
  const month = parts.find(part => part.type === "month")?.value
  const day = parts.find(part => part.type === "day")?.value
  return year && month && day ? `${year}-${month}-${day}` : safeDate.toISOString().slice(0, 10)
}

function isWritableCalendar(accessLevel: string | null | undefined) {
  return accessLevel === "owner" || accessLevel === "writer"
}

function isRetryableRequestError(error: unknown) {
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError") return true
  return /Failed to fetch|NetworkError|Load failed/i.test(error.message)
}

async function createWishlistMemo(payload: Record<string, unknown>) {
  const maxRetries = 2
  const baseDelayMs = 300
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || data.error) {
        throw new Error(data.error || "メモの作成に失敗しました")
      }
      if (!data.item) {
        throw new Error("作成結果を取得できませんでした")
      }

      return data.item as MemoItem
    } catch (err) {
      if (attempt < maxRetries && isRetryableRequestError(err)) {
        await new Promise(resolve => {
          const delayMs = baseDelayMs * Math.pow(2, attempt)
          window.setTimeout(resolve, delayMs)
        })
        attempt += 1
        continue
      }
      throw err
    }
  }

  throw new Error("メモの作成に失敗しました")
}

function readScheduledMemoPayload(event: DragEvent<HTMLElement>): ScheduledMemoDragPayload | null {
  const raw = event.dataTransfer.getData(SCHEDULED_MEMO_DRAG_MIME)
  if (raw) {
    try {
      return JSON.parse(raw) as ScheduledMemoDragPayload
    } catch {
      // Fall through to text/plain/window fallback.
    }
  }

  const plain = event.dataTransfer.getData("text/plain")
  if (plain.startsWith("__focusmap_scheduled_memo__")) {
    try {
      return JSON.parse(plain.slice("__focusmap_scheduled_memo__".length)) as ScheduledMemoDragPayload
    } catch {
      // Fall through to window fallback.
    }
  }

  return window.__focusmapScheduledMemoDrag ?? null
}

function readCalendarEventMemoPayload(event: DragEvent<HTMLElement>): CalendarEventMemoDragPayload | null {
  const raw = event.dataTransfer.getData(CALENDAR_EVENT_MEMO_DRAG_MIME)
  if (raw) {
    try {
      return JSON.parse(raw) as CalendarEventMemoDragPayload
    } catch {
      // Fall through to text/plain/window fallback.
    }
  }

  const plain = event.dataTransfer.getData("text/plain")
  if (plain.startsWith("__focusmap_calendar_event_memo__")) {
    try {
      return JSON.parse(plain.slice("__focusmap_calendar_event_memo__".length)) as CalendarEventMemoDragPayload
    } catch {
      // Fall through to window fallback.
    }
  }

  return window.__focusmapCalendarEventMemoDrag ?? null
}

function dispatchWishlistRefresh() {
  window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT, {
    detail: { source: TODAY_MEMO_REFRESH_SOURCE },
  }))
}

function buildMemoCalendarEvent(item: MemoItem, calendarId: string, calendarColor?: string | null): CalendarEvent | null {
  if (!item.scheduled_at || !item.google_event_id) return null
  const startTime = new Date(item.scheduled_at)
  if (Number.isNaN(startTime.getTime())) return null
  const durationMinutes = Math.max(1, item.duration_minutes ?? 30)
  const nowIso = new Date().toISOString()
  return {
    id: `memo-${item.id}-${item.google_event_id}`,
    user_id: item.user_id,
    google_event_id: item.google_event_id,
    calendar_id: calendarId,
    title: item.title,
    description: item.description ?? "",
    start_time: startTime.toISOString(),
    end_time: new Date(startTime.getTime() + durationMinutes * 60_000).toISOString(),
    is_all_day: false,
    timezone: "Asia/Tokyo",
    synced_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
    background_color: calendarColor ?? "#F59E0B",
    sync_status: "confirmed",
  }
}

interface TodayMemoBoardProps {
  projects: Project[]
  selectedSpaceId?: string | null
  selectedProjectId?: string | null
  scheduleFocusMemoId?: string | null
  scheduleFocusRequestKey?: number | null
  onClearScheduleFocus?: () => void
}

/**
 * Today タブの中央ペイン：今日するメモ（is_today=true OR scheduled_at が今日）を
 * 縦並びで表示し、ネイティブ D&D で右カレンダーに配置できるようにする。
 *
 * データ取得・更新は wishlist-view と同じパターン（fetch + 楽観更新）。
 * 他ビュー（メモ画面など）と同期するため WISHLIST_REFRESH_EVENT を listen する。
 */
export function TodayMemoBoard({
  projects,
  selectedSpaceId = null,
  selectedProjectId = null,
  scheduleFocusMemoId = null,
  scheduleFocusRequestKey = null,
  onClearScheduleFocus,
}: TodayMemoBoardProps) {
  const [items, setItems] = useState<MemoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeColumn, setActiveColumn] = useState<ColumnKey>("today")
  const activeColumnRef = useRef<ColumnKey>("today")
  const wheelLockRef = useRef(false)
  const wheelLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastWheelAbsDeltaRef = useRef(0)
  const lastWheelMoveAtRef = useRef(0)
  const touchStartColumnIndexRef = useRef<number | null>(null)
  const touchStartXRef = useRef<number | null>(null)
  const dropzoneRef = useRef<HTMLDivElement | null>(null)
  const { calendars } = useCalendars()
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null)
  const [scheduledMemoDragOver, setScheduledMemoDragOver] = useState(false)
  const [calendarEventMemoDragOver, setCalendarEventMemoDragOver] = useState(false)
  const [pendingMemoIds, setPendingMemoIds] = useState<Set<string>>(() => new Set())
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createTitle, setCreateTitle] = useState("")
  const [createDescription, setCreateDescription] = useState("")
  const [isCreatingMemo, setIsCreatingMemo] = useState(false)
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null)

  const projectById = useMemo(
    () => new Map(projects.map(p => [p.id, p])),
    [projects],
  )
  const writableCalendars = useMemo(
    () => calendars.filter(calendar => isWritableCalendar(calendar.access_level)),
    [calendars],
  )
  const defaultTargetCalendar = useMemo(() => {
    return (
      writableCalendars.find(c => c.selected && c.is_primary) ??
      writableCalendars.find(c => c.selected) ??
      writableCalendars.find(c => c.is_primary) ??
      writableCalendars[0] ??
      calendars.find(c => c.is_primary) ??
      calendars[0] ??
      null
    )
  }, [calendars, writableCalendars])
  const targetCalendar = useMemo(() => {
    return writableCalendars.find(calendar => calendar.google_calendar_id === selectedCalendarId)
      ?? defaultTargetCalendar
  }, [defaultTargetCalendar, selectedCalendarId, writableCalendars])
  const selectedItem = useMemo(
    () => items.find(item => item.id === selectedMemoId) ?? null,
    [items, selectedMemoId],
  )
  const tagOptions = useMemo(() => {
    const tags = new Set<string>()
    items.forEach(item => {
      if (item.category) tags.add(item.category)
      item.tags?.forEach(tag => tags.add(tag))
    })
    return Array.from(tags)
  }, [items])

  useEffect(() => {
    if (!selectedCalendarId) return
    if (writableCalendars.some(calendar => calendar.google_calendar_id === selectedCalendarId)) return
    setSelectedCalendarId(null)
  }, [selectedCalendarId, writableCalendars])

  const fetchItems = useCallback(async () => {
    try {
      const nextItems = await fetchWishlistItems({
        spaceId: selectedSpaceId,
        projectId: selectedProjectId,
      })
      setItems(nextItems as MemoItem[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "メモの取得に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }, [selectedProjectId, selectedSpaceId])

  useEffect(() => { void fetchItems() }, [fetchItems])

  // 他画面（メモ画面 / カレンダー削除）からの更新通知で再取得
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail
      if (detail?.source === TODAY_MEMO_REFRESH_SOURCE) return
      invalidateWishlistItemsCache()
      void fetchItems()
    }
    window.addEventListener(WISHLIST_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WISHLIST_REFRESH_EVENT, handler)
  }, [fetchItems])

  const setMemoPending = useCallback((memoId: string, pending: boolean) => {
    setPendingMemoIds(prev => {
      const next = new Set(prev)
      if (pending) next.add(memoId)
      else next.delete(memoId)
      return next
    })
  }, [])

  const scheduledMemoIndex = useMemo(() => {
    return items.reduce((acc, item) => {
      if (item.google_event_id) {
        acc[item.google_event_id] = {
          memoId: item.id,
          title: item.title,
        }
      }
      return acc
    }, {} as Record<string, ScheduledMemoIndexEntry>)
  }, [items])

  useEffect(() => {
    window.__focusmapScheduledMemoIndex = scheduledMemoIndex
    window.dispatchEvent(new CustomEvent(SCHEDULED_MEMO_INDEX_EVENT, { detail: scheduledMemoIndex }))
  }, [scheduledMemoIndex])

  useEffect(() => {
    return () => {
      window.__focusmapScheduledMemoIndex = {}
      window.__focusmapScheduledMemoDrag = null
      window.__focusmapCalendarEventMemoDrag = null
      window.__focusmapCalendarEventMemoDropHandler = undefined
      window.dispatchEvent(new CustomEvent(SCHEDULED_MEMO_INDEX_EVENT, { detail: {} }))
    }
  }, [])

  // メモ→カレンダーの D&D ドロップ受信ハンドラを window に登録
  // （CalendarDayView は別ツリーなので props で渡せない）
  useEffect(() => {
    const handler = async (memoId: string, startTime: Date, durationMinutes: number) => {
      const target = items.find(it => it.id === memoId)
      if (!target) return
      const prev = items
      setMemoPending(memoId, true)
      // 楽観更新: メモ一覧から消す
      setItems(curr => curr.map(it => it.id === memoId
        ? { ...it, scheduled_at: startTime.toISOString(), duration_minutes: durationMinutes, memo_status: "scheduled", is_today: false }
        : it))

      // 楽観更新: カレンダーにも即座に予定枠を表示
      const tempId = `optimistic-memo-${memoId}-${Date.now()}`
      const nowIso = new Date().toISOString()
      const calendarId = targetCalendar?.google_calendar_id ?? "primary"
      const calendarColor = targetCalendar?.background_color ?? "#F59E0B"
      if (target.google_event_id) {
        broadcastCalendarOptimisticEventRemoval(target.google_event_id, target.google_event_id)
      }
      const optimisticEvent: CalendarEvent = {
        id: tempId,
        user_id: target.user_id,
        google_event_id: "",
        calendar_id: calendarId,
        title: target.title,
        description: target.description ?? "",
        start_time: startTime.toISOString(),
        end_time: new Date(startTime.getTime() + durationMinutes * 60_000).toISOString(),
        is_all_day: false,
        timezone: "Asia/Tokyo",
        synced_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        background_color: calendarColor,
        sync_status: "pending",
      }
      // 全 useCalendarEvents インスタンス（DesktopTodayPanel 含む）に即時反映
      broadcastCalendarOptimisticEvent(optimisticEvent)

      try {
        const res = await fetch(`/api/wishlist/${memoId}/calendar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduled_at: startTime.toISOString(),
            duration_minutes: durationMinutes,
            title: target.title,
            description: target.description ?? "",
            calendar_id: calendarId,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error) throw new Error(data.error || "カレンダー追加に失敗しました")
        invalidateWishlistItemsCache()
        if (data.item) {
          setItems(curr => curr.map(it => it.id === memoId ? (data.item as MemoItem) : it))
        }
        // 本物の google_event_id で再 broadcast → 同じ id の楽観イベントが置き換わる
        broadcastCalendarOptimisticEvent({
          ...optimisticEvent,
          google_event_id: data.google_event_id ?? optimisticEvent.google_event_id,
          calendar_id: data.calendar_id ?? calendarId,
          updated_at: new Date().toISOString(),
          sync_status: "confirmed",
        })
        invalidateCalendarCache()
        broadcastCalendarSync()
        dispatchWishlistRefresh()
        if (scheduleFocusMemoId === memoId) onClearScheduleFocus?.()
      } catch (e) {
        // ロールバック: 楽観イベント削除＋メモ一覧復元
        broadcastCalendarOptimisticEventRemoval(tempId)
        broadcastCalendarSync()
        setItems(prev)
        setError(e instanceof Error ? e.message : "カレンダー追加に失敗しました")
      } finally {
        setMemoPending(memoId, false)
      }
    }
    window.__focusmapMemoDropHandler = handler
    return () => {
      if (window.__focusmapMemoDropHandler === handler) {
        window.__focusmapMemoDropHandler = undefined
      }
    }
  }, [items, targetCalendar, scheduleFocusMemoId, onClearScheduleFocus, setMemoPending])

  const columnSections = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    const endMs = startMs + 24 * 60 * 60 * 1000

    return COLUMN_ORDER.reduce((acc, column) => {
      const filtered = items.filter(item => getColumn(item, startMs, endMs) === column)
      acc[column] = sortMemoItemsForColumn(filtered, column)
      return acc
    }, {} as Record<ColumnKey, MemoItem[]>)
  }, [items])

  useEffect(() => {
    activeColumnRef.current = activeColumn
  }, [activeColumn])

  useEffect(() => {
    return () => {
      if (wheelLockTimerRef.current) clearTimeout(wheelLockTimerRef.current)
    }
  }, [])

  const scrollToColumn = useCallback((column: ColumnKey) => {
    activeColumnRef.current = column
    setActiveColumn(column)
  }, [])

  const scrollToColumnIndex = useCallback((index: number) => {
    const column = COLUMN_ORDER[Math.max(0, Math.min(COLUMN_ORDER.length - 1, index))]
    if (column) scrollToColumn(column)
  }, [scrollToColumn])

  const keepWheelGestureLocked = useCallback(() => {
    if (wheelLockTimerRef.current) clearTimeout(wheelLockTimerRef.current)
    wheelLockTimerRef.current = setTimeout(() => {
      wheelLockRef.current = false
      wheelLockTimerRef.current = null
    }, WHEEL_GESTURE_IDLE_MS)
  }, [])

  const handleColumnsWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.shiftKey
        ? event.deltaY
        : 0
    const absDelta = Math.abs(horizontalDelta)
    if (absDelta < 8) return

    event.preventDefault()

    const now = event.timeStamp || performance.now()
    if (wheelLockRef.current) {
      const isNewGesture =
        now - lastWheelMoveAtRef.current > 90 &&
        absDelta >= WHEEL_NEW_GESTURE_DELTA &&
        absDelta >= Math.max(WHEEL_NEW_GESTURE_DELTA, lastWheelAbsDeltaRef.current * WHEEL_NEW_GESTURE_RATIO)
      lastWheelAbsDeltaRef.current = absDelta
      if (!isNewGesture) {
        keepWheelGestureLocked()
        return
      }
      wheelLockRef.current = false
    } else if (
      now - lastWheelMoveAtRef.current < WHEEL_INERTIA_SUPPRESS_MS &&
      absDelta < WHEEL_NEW_GESTURE_DELTA
    ) {
      lastWheelAbsDeltaRef.current = absDelta
      return
    }

    const direction = horizontalDelta > 0 ? 1 : -1
    const currentIndex = Math.max(0, COLUMN_ORDER.indexOf(activeColumnRef.current))
    const nextIndex = Math.max(0, Math.min(COLUMN_ORDER.length - 1, currentIndex + direction))
    if (nextIndex === currentIndex) return

    wheelLockRef.current = true
    lastWheelAbsDeltaRef.current = absDelta
    lastWheelMoveAtRef.current = now
    scrollToColumnIndex(nextIndex)
    keepWheelGestureLocked()
  }, [keepWheelGestureLocked, scrollToColumnIndex])

  const handleColumnsTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    touchStartColumnIndexRef.current = Math.max(0, COLUMN_ORDER.indexOf(activeColumnRef.current))
    touchStartXRef.current = event.touches[0]?.clientX ?? null
  }, [])

  const handleColumnsTouchEnd = useCallback((event: TouchEvent<HTMLDivElement>) => {
    const startIndex = touchStartColumnIndexRef.current
    const startX = touchStartXRef.current
    touchStartColumnIndexRef.current = null
    touchStartXRef.current = null
    const endX = event.changedTouches[0]?.clientX ?? null
    if (startIndex === null || startX === null || endX === null) return

    const deltaX = endX - startX
    if (Math.abs(deltaX) < 40) return
    scrollToColumnIndex(startIndex + (deltaX < 0 ? 1 : -1))
  }, [scrollToColumnIndex])

  useEffect(() => {
    if (scheduleFocusMemoId) {
      scrollToColumn("today")
    }
  }, [scheduleFocusMemoId, scheduleFocusRequestKey, scrollToColumn])

  const visibleItemsByColumn = useMemo(() => {
    if (!scheduleFocusMemoId) return columnSections
    const focusedItem = items.find(item => item.id === scheduleFocusMemoId) ?? null
    if (!focusedItem) return columnSections
    return {
      ...columnSections,
      today: [
        focusedItem,
        ...columnSections.today.filter(item => item.id !== focusedItem.id),
      ],
    }
  }, [columnSections, items, scheduleFocusMemoId])

  const canNativeDragColumn = (column: ColumnKey) => column !== "completed"

  const openCreateDialog = useCallback(() => {
    setCreateTitle("")
    setCreateDescription("")
    setError(null)
    setCreateDialogOpen(true)
  }, [])

  const handleCreateMemo = useCallback(async () => {
    const title = createTitle.trim() || "新しいメモ"
    const description = createDescription.trim()
    setIsCreatingMemo(true)
    setError(null)
    try {
      const item = await createWishlistMemo({
        title,
        project_id: selectedProjectId,
        description,
        category: "アイデア",
        tags: ["アイデア"],
        memo_status: "unsorted",
        is_today: true,
        duration_minutes: 30,
      }) as MemoItem
      invalidateWishlistItemsCache()
      setItems(curr => curr.some(existing => existing.id === item.id) ? curr : [item, ...curr])
      setCreateDialogOpen(false)
      setCreateTitle("")
      setCreateDescription("")
      scrollToColumn("today")
      dispatchWishlistRefresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "メモの作成に失敗しました")
    } finally {
      setIsCreatingMemo(false)
    }
  }, [createDescription, createTitle, scrollToColumn, selectedProjectId])

  // 楽観更新付き PATCH（wishlist-view と同等の最小版）
  const syncLinkedCalendarCompletion = useCallback(async (item: MemoItem, isCompleted: boolean) => {
    if (!item.google_event_id) return
    const response = await fetch("/api/calendar/events/complete", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        google_event_id: item.google_event_id,
        calendar_id: targetCalendar?.google_calendar_id ?? "primary",
        completed_date: toTokyoDateString(item.scheduled_at),
        start_time: item.scheduled_at ?? new Date().toISOString(),
        is_completed: isCompleted,
      }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || data.success === false) {
      throw new Error(data.error || "カレンダー完了状態の更新に失敗しました")
    }
  }, [targetCalendar])

  const handleUpdate = useCallback(async (id: string, updates: Partial<MemoItem>) => {
    const prev = items
    const target = items.find(it => it.id === id)
    const currentCompleted = !!target && (target.is_completed || target.memo_status === "completed")
    const nextCompleted = typeof updates.is_completed === "boolean" ? updates.is_completed : null
    const shouldSyncCalendarCompletion =
      !!target?.google_event_id &&
      nextCompleted !== null &&
      nextCompleted !== currentCompleted

    setItems(curr => curr.map(it => it.id === id ? { ...it, ...updates, updated_at: new Date().toISOString() } : it))
    try {
      if (target && shouldSyncCalendarCompletion) {
        broadcastEventCompletion(target.google_event_id!, nextCompleted!, target.google_event_id!)
        await syncLinkedCalendarCompletion(target, nextCompleted!)
      }

      const res = await fetch(`/api/wishlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || "更新失敗")
      invalidateWishlistItemsCache()
      if (data.item) {
        setItems(curr => curr.map(it => it.id === id ? (data.item as MemoItem) : it))
      }
      if (shouldSyncCalendarCompletion) {
        invalidateCalendarCache()
        broadcastCalendarSync()
      }
      // 他画面（メモ画面）にも反映
      dispatchWishlistRefresh()
    } catch (e) {
      if (target && shouldSyncCalendarCompletion) {
        broadcastEventCompletion(target.google_event_id!, currentCompleted, target.google_event_id!)
        syncLinkedCalendarCompletion(target, currentCompleted).catch(err => {
          console.warn("[TodayMemoBoard] Failed to rollback linked calendar completion:", err)
        })
      }
      setItems(prev)
      setError(e instanceof Error ? e.message : "メモの更新に失敗しました")
    }
  }, [items, syncLinkedCalendarCompletion])

  const handleDelete = useCallback(async (id: string) => {
    const prev = items
    setItems(curr => curr.filter(it => it.id !== id))
    if (selectedMemoId === id) setSelectedMemoId(null)
    try {
      const res = await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("削除失敗")
      invalidateWishlistItemsCache()
      dispatchWishlistRefresh()
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : "削除に失敗しました")
    }
  }, [items, selectedMemoId])

  const handleCalendarAdd = useCallback(async (item: MemoItem, calendarIdOverride?: string) => {
    const optimisticEventId = `optimistic-today-memo-${item.id}`
    const startTime = item.scheduled_at ? new Date(item.scheduled_at) : null
    const durationMinutes = item.duration_minutes ?? 60
    const calendarId = calendarIdOverride ?? targetCalendar?.google_calendar_id ?? "primary"
    const calendarColor = calendars.find(calendar => calendar.google_calendar_id === calendarId)?.background_color
      ?? targetCalendar?.background_color
      ?? "#F59E0B"

    if (startTime && !Number.isNaN(startTime.getTime())) {
      if (item.google_event_id) {
        broadcastCalendarOptimisticEventRemoval(item.google_event_id, item.google_event_id, calendarId)
      }
      const nowIso = new Date().toISOString()
      broadcastCalendarOptimisticEvent({
        id: optimisticEventId,
        user_id: item.user_id,
        google_event_id: "",
        calendar_id: calendarId,
        title: item.title,
        description: item.description ?? "",
        start_time: startTime.toISOString(),
        end_time: new Date(startTime.getTime() + durationMinutes * 60_000).toISOString(),
        is_all_day: false,
        timezone: "Asia/Tokyo",
        synced_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
        background_color: calendarColor,
        sync_status: "pending",
      })
    }

    try {
      const res = await fetch(`/api/wishlist/${item.id}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: item.scheduled_at,
          duration_minutes: item.duration_minutes,
          title: item.title,
          description: item.description ?? "",
          calendar_id: calendarId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        throw new Error(data.error || "カレンダー追加に失敗しました")
      }
      invalidateWishlistItemsCache()
      if (data.item) {
        setItems(curr => curr.map(existing => existing.id === item.id ? (data.item as MemoItem) : existing))
      } else {
        await handleUpdate(item.id, {
          google_event_id: data.google_event_id ?? item.google_event_id,
          memo_status: "scheduled",
          is_today: false,
        } as Partial<MemoItem>)
      }
      invalidateCalendarCache()
      broadcastCalendarSync()
      dispatchWishlistRefresh()
    } catch (e) {
      broadcastCalendarOptimisticEventRemoval(optimisticEventId)
      broadcastCalendarSync()
      setError(e instanceof Error ? e.message : "カレンダー追加に失敗しました")
      throw e
    }
  }, [calendars, handleUpdate, targetCalendar])

  const handleUnscheduleMemo = useCallback(async (item: MemoItem, calendarIdOverride?: string) => {
    const prev = items
    const calendarId = calendarIdOverride ?? targetCalendar?.google_calendar_id ?? "primary"
    const calendarColor = calendars.find(calendar => calendar.google_calendar_id === calendarId)?.background_color
      ?? targetCalendar?.background_color
      ?? "#F59E0B"
    setMemoPending(item.id, true)
    setItems(curr => curr.map(it => it.id === item.id
      ? { ...it, is_today: false, scheduled_at: null, google_event_id: null, memo_status: "unsorted", updated_at: new Date().toISOString() }
      : it))
    if (item.google_event_id) {
      broadcastCalendarOptimisticEventRemoval(item.google_event_id, item.google_event_id, calendarId)
    }
    try {
      const res = await fetch(`/api/wishlist/${item.id}/unschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendar_id: calendarId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || "更新失敗")
      if (data.item) {
        setItems(curr => curr.map(existing => existing.id === item.id ? (data.item as MemoItem) : existing))
        invalidateWishlistItemsCache()
      }
      invalidateCalendarCache()
      broadcastCalendarSync()
      dispatchWishlistRefresh()
    } catch (e) {
      setItems(prev)
      const restoredEvent = buildMemoCalendarEvent(item, calendarId, calendarColor)
      if (restoredEvent) {
        broadcastCalendarOptimisticEvent(restoredEvent)
      }
      invalidateCalendarCache()
      broadcastCalendarSync()
      setError(e instanceof Error ? e.message : "メモの更新に失敗しました")
    } finally {
      setMemoPending(item.id, false)
    }
  }, [calendars, items, setMemoPending, targetCalendar])

  const handleToggleToday = useCallback(async (item: MemoItem, isTodayColumn: boolean) => {
    if (!isTodayColumn) {
      await handleUpdate(item.id, { is_today: true } as Partial<MemoItem>)
      return
    }

    await handleUnscheduleMemo(item)
  }, [handleUnscheduleMemo, handleUpdate])

  const isScheduledMemoDragEvent = useCallback((event: DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer.types).includes(SCHEDULED_MEMO_DRAG_MIME)
      || !!window.__focusmapScheduledMemoDrag
  }, [])

  const isCalendarEventMemoDragEvent = useCallback((event: DragEvent<HTMLElement>) => {
    return Array.from(event.dataTransfer.types).includes(CALENDAR_EVENT_MEMO_DRAG_MIME)
      || !!window.__focusmapCalendarEventMemoDrag
  }, [])

  const findScheduledMemoItem = useCallback((payload: ScheduledMemoDragPayload | null) => {
    if (!payload) return null
    if (payload.memoId) {
      const byId = items.find(item => item.id === payload.memoId)
      if (byId) return byId
    }
    if (payload.googleEventId) {
      return items.find(item => item.google_event_id === payload.googleEventId) ?? null
    }
    return null
  }, [items])

  const handleScheduledMemoDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isScheduledMemoDragEvent(event) && !isCalendarEventMemoDragEvent(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setScheduledMemoDragOver(isScheduledMemoDragEvent(event))
    setCalendarEventMemoDragOver(isCalendarEventMemoDragEvent(event))
  }, [isCalendarEventMemoDragEvent, isScheduledMemoDragEvent])

  const handleScheduledMemoDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setScheduledMemoDragOver(false)
    setCalendarEventMemoDragOver(false)
  }, [])

  const createMemoFromCalendarEvent = useCallback(async (payload: CalendarEventMemoDragPayload) => {
    const deleteScope = confirmCalendarEventMemoDeleteScope(payload)
    if (!deleteScope) return

    const tempMemoId = `calendar-event-memo-${payload.googleEventId}-${Date.now()}`
    setMemoPending(tempMemoId, true)
    broadcastCalendarOptimisticEventRemoval(payload.eventId, payload.googleEventId, payload.calendarId)

    try {
      const data = await convertCalendarEventToMemo(payload, {
        projectId: selectedProjectId,
        deleteScope,
      })

      invalidateWishlistItemsCache()
      invalidateCalendarCache()
      if (data.item) {
        setItems(curr => curr.some(item => item.id === data.item.id)
          ? curr
          : [data.item as MemoItem, ...curr])
      }
      scrollToColumn("unsorted")
      broadcastCalendarSync()
      broadcastCalendarEventToMemoConverted(payload)
      dispatchWishlistRefresh()
    } catch (e) {
      broadcastCalendarSync()
      setError(e instanceof Error ? e.message : "予定をメモにできませんでした")
    } finally {
      setMemoPending(tempMemoId, false)
    }
  }, [scrollToColumn, selectedProjectId, setMemoPending])

  const handleScheduledMemoDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!isScheduledMemoDragEvent(event) && !isCalendarEventMemoDragEvent(event)) return
    event.preventDefault()
    const calendarPayload = isCalendarEventMemoDragEvent(event)
      ? readCalendarEventMemoPayload(event)
      : null
    const scheduledPayload = !calendarPayload && isScheduledMemoDragEvent(event)
      ? readScheduledMemoPayload(event)
      : null
    window.__focusmapScheduledMemoDrag = null
    window.__focusmapCalendarEventMemoDrag = null
    setScheduledMemoDragOver(false)
    setCalendarEventMemoDragOver(false)
    if (calendarPayload) {
      void createMemoFromCalendarEvent(calendarPayload)
      return
    }
    const item = findScheduledMemoItem(scheduledPayload)
    if (!item) {
      setError("予定をメモにする情報を取得できませんでした")
      return
    }
    scrollToColumn("unsorted")
    void handleUnscheduleMemo(item, scheduledPayload?.calendarId)
  }, [createMemoFromCalendarEvent, findScheduledMemoItem, handleUnscheduleMemo, isCalendarEventMemoDragEvent, isScheduledMemoDragEvent, scrollToColumn])

  useLayoutEffect(() => {
    const handler = async (payload: ScheduledMemoDragPayload) => {
      const item = findScheduledMemoItem(payload)
      window.__focusmapScheduledMemoDrag = null
      setScheduledMemoDragOver(false)
      setCalendarEventMemoDragOver(false)
      if (!item) {
        setError("予定をメモにする情報を取得できませんでした")
        return
      }
      scrollToColumn("unsorted")
      await handleUnscheduleMemo(item, payload.calendarId)
    }
    window.__focusmapScheduledMemoDropHandler = handler
    return () => {
      if (window.__focusmapScheduledMemoDropHandler === handler) {
        window.__focusmapScheduledMemoDropHandler = undefined
      }
    }
  }, [findScheduledMemoItem, handleUnscheduleMemo, scrollToColumn])

  useLayoutEffect(() => {
    const handler = async (payload: CalendarEventMemoDragPayload) => {
      window.__focusmapCalendarEventMemoDrag = null
      setScheduledMemoDragOver(false)
      setCalendarEventMemoDragOver(false)
      await createMemoFromCalendarEvent(payload)
    }
    window.__focusmapCalendarEventMemoDropHandler = handler
    return () => {
      if (window.__focusmapCalendarEventMemoDropHandler === handler) {
        window.__focusmapCalendarEventMemoDropHandler = undefined
      }
    }
  }, [createMemoFromCalendarEvent])

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const hasScheduledPayload = !!window.__focusmapScheduledMemoDrag
      const hasCalendarPayload = !!window.__focusmapCalendarEventMemoDrag
      if (!hasScheduledPayload && !hasCalendarPayload) {
        setScheduledMemoDragOver(false)
        setCalendarEventMemoDragOver(false)
        return
      }

      const rect = dropzoneRef.current?.getBoundingClientRect()
      if (!rect) return
      const isInside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom

      setScheduledMemoDragOver(isInside && hasScheduledPayload)
      setCalendarEventMemoDragOver(isInside && hasCalendarPayload)
    }
    const clear = () => {
      setScheduledMemoDragOver(false)
      setCalendarEventMemoDragOver(false)
    }
    window.addEventListener("mousemove", handlePointerMove)
    window.addEventListener("mouseup", clear)
    return () => {
      window.removeEventListener("mousemove", handlePointerMove)
      window.removeEventListener("mouseup", clear)
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
        <div className="h-7 w-36 animate-pulse rounded-md bg-muted/70" />
        <div className="grid gap-3">
          {[0, 1, 2].map(index => (
            <div key={index} className="rounded-md border bg-background p-3">
              <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-muted/60" />
              <div className="h-12 animate-pulse rounded bg-muted/30" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={dropzoneRef}
      data-scheduled-memo-dropzone="true"
      className={cn(
        "relative flex h-full flex-col overflow-hidden bg-background",
        (scheduledMemoDragOver || calendarEventMemoDragOver) && "ring-2 ring-primary/60 ring-inset",
      )}
      onDragOver={handleScheduledMemoDragOver}
      onDragLeave={handleScheduledMemoDragLeave}
      onDrop={handleScheduledMemoDrop}
    >
      <div className="shrink-0 border-b px-3 py-1.5">
        <div className="flex min-h-8 items-center gap-2">
          <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {COLUMN_ORDER.map(column => (
              <button
                key={column}
                type="button"
                onClick={() => scrollToColumn(column)}
                className={cn(
                  "min-h-7 shrink-0 rounded-md border px-2 text-[11px] transition-colors",
                  activeColumn === column
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
                aria-pressed={activeColumn === column}
              >
                {COLUMN_LABEL[column]}
                <span className={cn(
                  "ml-1 rounded px-1 tabular-nums",
                  activeColumn === column ? "bg-primary/15" : "bg-muted",
                )}>
                  {visibleItemsByColumn[column].length}
                </span>
              </button>
            ))}
          </div>
          {writableCalendars.length > 0 && (
            <label className="flex max-w-[180px] shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
              <CalendarDays className="h-3 w-3 shrink-0" />
              <select
                value={targetCalendar?.google_calendar_id ?? ""}
                onChange={event => setSelectedCalendarId(event.target.value || null)}
                className="min-w-0 max-w-[132px] bg-transparent text-[11px] text-foreground outline-none"
                aria-label="予定を追加するカレンダー"
              >
                {writableCalendars.map(calendar => (
                  <option key={calendar.id} value={calendar.google_calendar_id}>
                    {calendar.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={openCreateDialog}
            className="h-8 w-8 shrink-0 rounded-md"
            aria-label="今日するメモを追加"
            title="今日するメモを追加"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline"
          >閉じる</button>
        </div>
      )}

      {(scheduledMemoDragOver || calendarEventMemoDragOver) && (
        <>
          <div className="pointer-events-none absolute inset-0 z-20 bg-primary/[0.03]" />
          <div className="pointer-events-none absolute bottom-3 right-0 top-3 z-30 w-2 rounded-l-full bg-primary shadow-[0_0_24px_rgba(59,130,246,0.55)]" />
          <div className="pointer-events-none absolute right-3 top-1/2 z-30 -translate-y-1/2 rounded-md border border-primary/50 bg-background/95 px-3 py-2 text-center text-xs font-medium text-primary shadow-lg">
            <div className="text-[10px] text-muted-foreground">カレンダー境界</div>
            <div>ドロップで予定をメモにする</div>
          </div>
        </>
      )}

      <div
        onWheel={handleColumnsWheel}
        onTouchStart={handleColumnsTouchStart}
        onTouchEnd={handleColumnsTouchEnd}
        className="min-h-0 flex-1 overflow-hidden"
        style={{ overscrollBehaviorX: "contain" }}
      >
        <div
          className="flex h-full transition-transform duration-220 ease-out"
          style={{ transform: `translateX(-${COLUMN_ORDER.indexOf(activeColumn) * 100}%)` }}
        >
          {COLUMN_ORDER.map(column => {
            const sectionItems = visibleItemsByColumn[column]
            return (
              <section
                key={column}
                className="h-full w-full shrink-0 overflow-y-auto px-3 py-3"
                aria-label={COLUMN_LABEL[column]}
              >
                {sectionItems.length === 0 ? (
                  <div className="flex min-h-[36vh] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                    <p>{COLUMN_EMPTY_TEXT[column]}</p>
                    {column === "today" && (
                      <p className="max-w-xs text-xs">メモ画面で Sun ボタンを押すか、メモを今日カラムにドラッグしてください。</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {sectionItems.map(item => {
                      const isFocused = column === "today" && item.id === scheduleFocusMemoId
                      const isPending = pendingMemoIds.has(item.id)
                      return (
                        <div
                          key={`${column}-${item.id}-${isFocused ? scheduleFocusRequestKey ?? "focus" : "normal"}`}
                          className={cn(
                            "relative rounded-lg transition-all",
                            isFocused && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
                            isPending && "scale-[0.995] opacity-80",
                          )}
                        >
                          <WishlistCard
                            item={item}
                            onUpdate={handleUpdate}
                            onDelete={handleDelete}
                            onClick={() => setSelectedMemoId(item.id)}
                            project={item.project_id ? projectById.get(item.project_id) ?? null : null}
                            onToggleToday={handleToggleToday}
                            nativeMemoDrag={canNativeDragColumn(column)}
                          />
                          {isPending && (
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-background/45 text-[11px] font-medium text-foreground backdrop-blur-[1px]">
                              <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/90 px-2 py-1 shadow-sm">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                反映中
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>今日するメモを追加</DialogTitle>
            <DialogDescription>
              追加したメモは今日するカラムに入ります。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-1">
            <Input
              value={createTitle}
              onChange={event => setCreateTitle(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void handleCreateMemo()
                }
              }}
              placeholder="メモのタイトル"
              autoFocus
            />
            <textarea
              value={createDescription}
              onChange={event => setCreateDescription(event.target.value)}
              placeholder="詳細メモ"
              rows={4}
              className="min-h-24 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
              disabled={isCreatingMemo}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={handleCreateMemo}
              disabled={isCreatingMemo}
            >
              {isCreatingMemo && <Loader2 className="h-4 w-4 animate-spin" />}
              追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <WishlistCardDetail
        item={selectedItem}
        open={!!selectedItem}
        onOpenChange={open => {
          if (!open) setSelectedMemoId(null)
        }}
        onUpdate={async (id, updates) => {
          await handleUpdate(id, updates as Partial<MemoItem>)
        }}
        onCalendarAdd={async (item, calendarId) => {
          await handleCalendarAdd(item as MemoItem, calendarId)
        }}
        onSaved={() => setSelectedMemoId(null)}
        tagOptions={tagOptions}
        projects={projects}
        calendars={calendars}
        onMemoChanged={() => {
          invalidateWishlistItemsCache()
          void fetchItems()
          dispatchWishlistRefresh()
        }}
      />
    </div>
  )
}
