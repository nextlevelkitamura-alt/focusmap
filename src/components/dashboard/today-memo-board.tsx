"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import type { IdealGoalWithItems, Project } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { WISHLIST_REFRESH_EVENT } from "@/lib/calendar-constants"
import { WishlistCard } from "@/components/wishlist/wishlist-card"
import { broadcastCalendarSync, invalidateCalendarCache } from "@/hooks/useCalendarEvents"

declare global {
  interface Window {
    __focusmapAddOptimisticEvent?: (event: CalendarEvent) => void
    __focusmapRemoveOptimisticEvent?: (eventId: string, googleEventId?: string) => void
  }
}

type MemoItem = IdealGoalWithItems

interface TodayMemoBoardProps {
  projects: Project[]
}

/**
 * Today タブの中央ペイン：今日するメモ（is_today=true OR scheduled_at が今日）を
 * 縦並びで表示し、ネイティブ D&D で右カレンダーに配置できるようにする。
 *
 * データ取得・更新は wishlist-view と同じパターン（fetch + 楽観更新）。
 * 他ビュー（メモ画面など）と同期するため WISHLIST_REFRESH_EVENT を listen する。
 */
export function TodayMemoBoard({ projects }: TodayMemoBoardProps) {
  const [items, setItems] = useState<MemoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const projectById = useMemo(
    () => new Map(projects.map(p => [p.id, p])),
    [projects],
  )

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/wishlist")
      if (!res.ok) throw new Error(`取得失敗 (${res.status})`)
      const data = await res.json()
      setItems((data.items ?? []) as MemoItem[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "メモの取得に失敗しました")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void fetchItems() }, [fetchItems])

  // 他画面（メモ画面 / カレンダー削除）からの更新通知で再取得
  useEffect(() => {
    const handler = () => { void fetchItems() }
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
        ? { ...it, scheduled_at: startTime.toISOString(), duration_minutes: durationMinutes, memo_status: "scheduled" }
        : it))

      // 楽観更新: カレンダーにも即座に予定枠を表示
      const tempId = `optimistic-memo-${memoId}-${Date.now()}`
      const nowIso = new Date().toISOString()
      const optimisticEvent: CalendarEvent = {
        id: tempId,
        user_id: target.user_id,
        google_event_id: tempId,
        calendar_id: "primary",
        title: target.title,
        description: target.description ?? "",
        start_time: startTime.toISOString(),
        end_time: new Date(startTime.getTime() + durationMinutes * 60_000).toISOString(),
        is_all_day: false,
        timezone: "Asia/Tokyo",
        synced_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      }
      window.__focusmapAddOptimisticEvent?.(optimisticEvent)

      try {
        const res = await fetch(`/api/wishlist/${memoId}/calendar`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduled_at: startTime.toISOString(),
            duration_minutes: durationMinutes,
            title: target.title,
            description: target.description ?? "",
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.error) throw new Error(data.error || "カレンダー追加に失敗しました")
        // 楽観イベントは敢えて削除しない。useCalendarEvents の次回 refetch で
        // setEvents(全置換) されるとき自動的に本物イベントへ差し替わる。
        // 先に削除してしまうと refetch 完了までの数秒、何も表示されない時間が生じる。
        invalidateCalendarCache()
        broadcastCalendarSync()
        window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
        void fetchItems()
      } catch (e) {
        // ロールバック: 楽観イベント削除＋メモ一覧復元
        window.__focusmapRemoveOptimisticEvent?.(tempId)
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
  }, [items, fetchItems])

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

  // 楽観更新付き PATCH（wishlist-view と同等の最小版）
  const handleUpdate = useCallback(async (id: string, updates: Partial<MemoItem>) => {
    const prev = items
    setItems(curr => curr.map(it => it.id === id ? { ...it, ...updates, updated_at: new Date().toISOString() } : it))
    try {
      const res = await fetch(`/api/wishlist/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || "更新失敗")
      if (data.item) {
        setItems(curr => curr.map(it => it.id === id ? (data.item as MemoItem) : it))
      }
      // 他画面（メモ画面）にも反映
      window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : "メモの更新に失敗しました")
    }
  }, [items])

  const handleDelete = useCallback(async (id: string) => {
    const prev = items
    setItems(curr => curr.filter(it => it.id !== id))
    try {
      const res = await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("削除失敗")
      window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
    } catch (e) {
      setItems(prev)
      setError(e instanceof Error ? e.message : "削除に失敗しました")
    }
  }, [items])

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 読み込み中
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
            {todayItems.length}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          所要時間を選んで、右のカレンダーにドラッグして予定に追加できます。
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
        {todayItems.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>今日するメモはありません。</p>
            <p className="text-xs">メモ画面で Sun ボタンを押すか、メモを今日カラムにドラッグしてください。</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {todayItems.map(item => (
              <WishlistCard
                key={item.id}
                item={item}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onClick={() => { /* TODO: 詳細シートを Today タブにも統合する場合はここで開く */ }}
                project={item.project_id ? projectById.get(item.project_id) ?? null : null}
                nativeMemoDrag
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
