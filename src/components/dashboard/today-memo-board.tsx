"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import type { IdealGoalWithItems, Project } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { WISHLIST_REFRESH_EVENT } from "@/lib/calendar-constants"
import { WishlistCard } from "@/components/wishlist/wishlist-card"
import {
  broadcastCalendarSync,
  broadcastEventCompletion,
  invalidateCalendarCache,
  broadcastCalendarOptimisticEvent,
  broadcastCalendarOptimisticEventRemoval,
} from "@/hooks/useCalendarEvents"
import { useCalendars } from "@/hooks/useCalendars"
import { cn } from "@/lib/utils"
import { fetchWishlistItems, invalidateWishlistItemsCache } from "@/lib/wishlist-cache"

type MemoItem = IdealGoalWithItems

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

interface TodayMemoBoardProps {
  projects: Project[]
  selectedSpaceId?: string | null
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
  scheduleFocusMemoId = null,
  scheduleFocusRequestKey = null,
  onClearScheduleFocus,
}: TodayMemoBoardProps) {
  const [items, setItems] = useState<MemoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { calendars } = useCalendars()

  const projectById = useMemo(
    () => new Map(projects.map(p => [p.id, p])),
    [projects],
  )
  const targetCalendar = useMemo(() => {
    const writableCalendars = calendars.filter(c => c.access_level === "owner" || c.access_level === "writer")
    return (
      writableCalendars.find(c => c.selected && c.is_primary) ??
      writableCalendars.find(c => c.selected) ??
      writableCalendars.find(c => c.is_primary) ??
      writableCalendars[0] ??
      calendars.find(c => c.is_primary) ??
      calendars[0] ??
      null
    )
  }, [calendars])

  const fetchItems = useCallback(async () => {
    try {
      const nextItems = await fetchWishlistItems({ spaceId: selectedSpaceId })
      setItems(nextItems as MemoItem[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "メモの取得に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }, [selectedSpaceId])

  useEffect(() => { void fetchItems() }, [fetchItems])

  // 他画面（メモ画面 / カレンダー削除）からの更新通知で再取得
  useEffect(() => {
    const handler = () => {
      invalidateWishlistItemsCache()
      void fetchItems()
    }
    window.addEventListener(WISHLIST_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WISHLIST_REFRESH_EVENT, handler)
  }, [fetchItems])

  // メモ→カレンダーの D&D ドロップ受信ハンドラを window に登録
  // （CalendarDayView は別ツリーなので props で渡せない）
  useEffect(() => {
    const handler = async (memoId: string, startTime: Date, durationMinutes: number) => {
      const target = items.find(it => it.id === memoId)
      if (!target) return
      const prev = items
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
        window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
        if (scheduleFocusMemoId === memoId) onClearScheduleFocus?.()
        void fetchItems()
      } catch (e) {
        // ロールバック: 楽観イベント削除＋メモ一覧復元
        broadcastCalendarOptimisticEventRemoval(tempId)
        broadcastCalendarSync()
        setItems(prev)
        setError(e instanceof Error ? e.message : "カレンダー追加に失敗しました")
      }
    }
    window.__focusmapMemoDropHandler = handler
    return () => {
      if (window.__focusmapMemoDropHandler === handler) {
        window.__focusmapMemoDropHandler = undefined
      }
    }
  }, [items, fetchItems, targetCalendar, scheduleFocusMemoId, onClearScheduleFocus])

  // 今日するメモのフィルタ + 並び替え（scheduled_at 昇順、未設定は末尾）
  const todayItems = useMemo(() => {
    const now = Date.now()
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    const endMs = startMs + 24 * 60 * 60 * 1000
    const filtered = items.filter(item => {
      if (item.is_completed || item.memo_status === "completed") return false
      if (item.is_today) return true
      if (item.scheduled_at) {
        const ms = new Date(item.scheduled_at).getTime()
        return !Number.isNaN(ms) && ms >= startMs && ms < endMs
      }
      return false
    })
    return filtered.sort((a, b) => {
      const sa = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity
      const sb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity
      if (sa === sb) return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      return sa - sb
    })
    void now
  }, [items])

  const focusedItem = useMemo(() => {
    if (!scheduleFocusMemoId) return null
    return items.find(item => item.id === scheduleFocusMemoId) ?? null
  }, [items, scheduleFocusMemoId])

  const visibleItems = useMemo(() => {
    if (!focusedItem) return todayItems
    return [
      focusedItem,
      ...todayItems.filter(item => item.id !== focusedItem.id),
    ]
  }, [focusedItem, todayItems])

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
      window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
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
    try {
      const res = await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("削除失敗")
      invalidateWishlistItemsCache()
      window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : "削除に失敗しました")
    }
  }, [items])

  const handleToggleToday = useCallback(async (item: MemoItem, isTodayColumn: boolean) => {
    if (!isTodayColumn) {
      await handleUpdate(item.id, { is_today: true } as Partial<MemoItem>)
      return
    }

    const prev = items
    setItems(curr => curr.map(it => it.id === item.id
      ? { ...it, is_today: false, scheduled_at: null, google_event_id: null, memo_status: "unsorted", updated_at: new Date().toISOString() }
      : it))
    try {
      if (item.scheduled_at || item.google_event_id) {
        const res = await fetch(`/api/wishlist/${item.id}/unschedule`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ calendar_id: targetCalendar?.google_calendar_id ?? "primary" }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error) throw new Error(data.error || "更新失敗")
        invalidateWishlistItemsCache()
      } else {
        await handleUpdate(item.id, { is_today: false } as Partial<MemoItem>)
      }
      invalidateCalendarCache()
      broadcastCalendarSync()
      window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : "メモの更新に失敗しました")
    }
  }, [handleUpdate, items, targetCalendar])

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
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <h2 className="text-sm font-semibold">今日するメモ</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {visibleItems.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {focusedItem
            ? "強調中のメモを右のカレンダーへドラッグして、別の日程に入れ直せます。"
            : "所要時間を選んで、右のカレンダーにドラッグして予定に追加できます。"}
        </p>
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

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {visibleItems.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>今日するメモはありません。</p>
            <p className="text-xs">メモ画面で Sun ボタンを押すか、メモを今日カラムにドラッグしてください。</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visibleItems.map(item => {
              const isFocused = item.id === scheduleFocusMemoId
              return (
                <div
                  key={`${item.id}-${isFocused ? scheduleFocusRequestKey ?? "focus" : "normal"}`}
                  className={cn(
                    "rounded-lg transition-shadow",
                    isFocused && "ring-2 ring-primary/60 ring-offset-2 ring-offset-background",
                  )}
                >
                  <WishlistCard
                    item={item}
                    onUpdate={handleUpdate}
                    onDelete={handleDelete}
                    onClick={() => { /* TODO: 詳細シートを Today タブにも統合する場合はここで開く */ }}
                    project={item.project_id ? projectById.get(item.project_id) ?? null : null}
                    onToggleToday={handleToggleToday}
                    nativeMemoDrag
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
