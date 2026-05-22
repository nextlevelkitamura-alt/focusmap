"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd"
import { TODAY_DURATION_DEFAULT, WISHLIST_REFRESH_EVENT } from "@/lib/calendar-constants"
import { Calendar, Check, ChevronDown, Clock, Filter, Loader2, Mic, Plus, RefreshCw, Settings, Sparkles, Square, X } from "lucide-react"
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { DateTimePicker } from "@/components/ui/date-time-picker"
import { DurationWheelPicker, formatDuration } from "@/components/ui/duration-wheel-picker"
import { VoiceWaveform } from "@/components/ui/voice-waveform"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useTagColors } from "@/hooks/useTagColors"
import { useCalendars } from "@/hooks/useCalendars"
import { useUndoRedo } from "@/hooks/useUndoRedo"
import {
  broadcastCalendarOptimisticEvent,
  broadcastCalendarOptimisticEventRemoval,
  broadcastCalendarSync,
  CALENDAR_EVENT_TIME_UPDATE_EVENT,
  invalidateCalendarCache,
} from "@/hooks/useCalendarEvents"
import { IdealGoalWithItems, Project } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { cn } from "@/lib/utils"
import { getTagColor } from "@/lib/color-utils"
import { WishlistCard } from "./wishlist-card"
import { WishlistCardDetail } from "./wishlist-card-detail"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"

type MemoStatus = "unsorted" | "organized" | "time_candidates" | "scheduled" | "completed"
type ColumnKey = "unsorted" | "today" | "scheduled" | "completed"
type MemoItem = IdealGoalWithItems

interface TodayRemovalDialogState {
  item: MemoItem
  scheduledDate: Date | undefined
  durationMinutes: number
  isSaving: boolean
}

interface MemoSuggestion {
  title: string
  project_id?: string | null
  category: string
  tags: string[]
  tag_suggestions?: string[]
  memo_status: MemoStatus
  description: string
  scheduled_at: string | null
  duration_minutes: number | null
  duration_input?: string
  date_input?: string
  time_input?: string
  time_candidates: Array<{ label: string; scheduled_at: string; duration_minutes: number; reason: string }>
  subtask_suggestions: Array<{ title: string; estimated_minutes: number; reason: string }>
}

const ANALYZE_STATUS_MESSAGES = [
  "AIで整理しています...",
  "モデルに送信しました。結果を待っています...",
  "内容を構造化しています...",
  "もう少しで生成結果を表示します...",
]

const DURATION_OPTIONS = [
  { label: "未設定", minutes: null },
  { label: "5分", minutes: 5 },
  { label: "15分", minutes: 15 },
  { label: "30分", minutes: 30 },
  { label: "60分", minutes: 60 },
]

const STATUS_LABEL: Record<MemoStatus | "all", string> = {
  all: "すべて",
  unsorted: "未予定",
  organized: "未予定",
  time_candidates: "未予定",
  scheduled: "予定済み",
  completed: "完了",
}

function getStatus(item: MemoItem): MemoStatus {
  if (item.is_completed || item.memo_status === "completed") return "completed"
  if (item.google_event_id || item.scheduled_at || item.memo_status === "scheduled") return "scheduled"
  return "unsorted"
}

// Asia/Tokyo の本日 0:00 / 翌日 0:00 を返す（UTC ミリ秒）
function getTodayRangeJST(now: number = Date.now()): { start: number; end: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
  })
  const ymd = fmt.format(new Date(now)) // "YYYY-MM-DD"
  // JST は UTC+9。"YYYY-MM-DDT00:00:00+09:00" → UTC ms。
  const start = new Date(`${ymd}T00:00:00+09:00`).getTime()
  const end = start + 24 * 60 * 60 * 1000
  return { start, end }
}

function getColumn(item: MemoItem, todayStart: number, todayEnd: number): ColumnKey {
  if (item.is_completed || item.memo_status === "completed") return "completed"
  const sched = item.scheduled_at ? new Date(item.scheduled_at).getTime() : null
  const isScheduledToday = sched != null && !Number.isNaN(sched) && sched >= todayStart && sched < todayEnd
  if (item.is_today || isScheduledToday) return "today"
  if (item.google_event_id || item.scheduled_at || item.memo_status === "scheduled") return "scheduled"
  return "unsorted"
}

function getTimestamp(value: string | null | undefined) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function sortMemoItemsForSection(items: MemoItem[], section: ColumnKey) {
  return [...items].sort((a, b) => {
    if (section === "today") {
      // scheduled_at 昇順、無いものは末尾
      const sa = getTimestamp(a.scheduled_at)
      const sb = getTimestamp(b.scheduled_at)
      if (sa === 0 && sb !== 0) return 1
      if (sa !== 0 && sb === 0) return -1
      return sa - sb || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
    }
    if (section === "scheduled") {
      return getTimestamp(a.scheduled_at) - getTimestamp(b.scheduled_at)
        || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
    }
    if (section === "completed") {
      return getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
        || getTimestamp(b.created_at) - getTimestamp(a.created_at)
    }
    return getTimestamp(b.created_at) - getTimestamp(a.created_at)
      || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
  })
}

function formatCandidate(candidate: MemoSuggestion["time_candidates"][number]) {
  const date = new Date(candidate.scheduled_at)
  if (Number.isNaN(date.getTime())) return candidate.label
  const day = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
  const time = date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" })
  return `${date.getMonth() + 1}/${date.getDate()}(${day}) ${time}`
}

function formatTimeInput(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

function formatDateValue(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-")
}

function buildDateOptions(selectedValue: string) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const options = Array.from({ length: 21 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() + index)
    const value = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-")
    const prefix = index === 0 ? "今日" : index === 1 ? "明日" : index === 2 ? "明後日" : ""
    return {
      value,
      label: prefix ? `${prefix} ${formatter.format(date)}` : formatter.format(date),
    }
  })
  if (selectedValue && !options.some(option => option.value === selectedValue)) {
    const date = new Date(`${selectedValue}T00:00:00`)
    options.unshift({
      value: selectedValue,
      label: Number.isNaN(date.getTime()) ? selectedValue : formatter.format(date),
    })
  }
  return options
}

function buildTimeOptions(selectedValue: string) {
  const options = Array.from({ length: 96 }, (_, index) => {
    const minutes = index * 15
    const hour = Math.floor(minutes / 60)
    const minute = minutes % 60
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
    return { value, label: value }
  })
  if (selectedValue && !options.some(option => option.value === selectedValue)) {
    options.unshift({ value: selectedValue, label: selectedValue })
  }
  return options
}

function combineDateTime(dateValue: string, timeValue: string) {
  if (!dateValue) return null
  const [year, month, day] = dateValue.split("-").map(Number)
  const [hour = 9, minute = 0] = (timeValue || "09:00").split(":").map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function buildMemoUpdatePayload(item: MemoItem): Record<string, unknown> {
  return {
    title: item.title,
    project_id: item.project_id,
    description: item.description,
    cover_image_url: item.cover_image_url,
    cover_image_path: item.cover_image_path,
    category: item.category,
    color: item.color,
    status: item.status,
    display_order: item.display_order,
    duration_months: item.duration_months,
    start_date: item.start_date,
    target_date: item.target_date,
    total_daily_minutes: item.total_daily_minutes,
    cost_total: item.cost_total,
    cost_monthly: item.cost_monthly,
    ai_summary: item.ai_summary,
    scheduled_at: item.scheduled_at,
    duration_minutes: item.duration_minutes,
    google_event_id: item.google_event_id,
    is_completed: item.is_completed,
    is_today: item.is_today,
    tags: item.tags ?? [],
    memo_status: item.memo_status,
    ai_source_payload: item.ai_source_payload,
  }
}

function buildMemoCreatePayload(item: MemoItem): Record<string, unknown> {
  return {
    ...buildMemoUpdatePayload(item),
    id: item.id,
    created_at: item.created_at,
    updated_at: item.updated_at,
    ideal_items: item.ideal_items ?? [],
  }
}

export function WishlistView({
  projects = [],
  selectedProjectId = null,
  selectedSpaceId = null,
  onOpenTodayMemoSchedule,
  isCalendarSplitVisible = false,
  onToggleCalendarSplit,
  compactComposer = false,
  mindmapMemoFocus = null,
}: {
  projects?: Project[]
  selectedProjectId?: string | null
  selectedSpaceId?: string | null
  onOpenTodayMemoSchedule?: (payload: { memoId: string; date: Date }) => void
  isCalendarSplitVisible?: boolean
  onToggleCalendarSplit?: () => void
  compactComposer?: boolean
  mindmapMemoFocus?: { taskId: string; requestKey: number } | null
}) {
  const [items, setItems] = useState<MemoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<MemoItem | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [intakeText, setIntakeText] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analyzeStartedAt, setAnalyzeStartedAt] = useState<number | null>(null)
  const [analyzeElapsedSeconds, setAnalyzeElapsedSeconds] = useState(0)
  const [intakeError, setIntakeError] = useState<string | null>(null)
  const [selectedAiModel, setSelectedAiModel] = useState("gemini-2.5-flash-lite")
  const [suggestion, setSuggestion] = useState<MemoSuggestion | null>(null)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [isSavingSuggestion, setIsSavingSuggestion] = useState(false)
  const [statusFilter, setStatusFilter] = useState<MemoStatus | "all">("all")
  const [tagFilter, setTagFilter] = useState<string | "all">("all")
  const [filterOpen, setFilterOpen] = useState(false)
  const [isCheckingVisibleAi, setIsCheckingVisibleAi] = useState(false)
  const [todayRemovalDialog, setTodayRemovalDialog] = useState<TodayRemovalDialogState | null>(null)
  const [linkedMemoFocus, setLinkedMemoFocus] = useState<{
    taskId: string
    taskTitle: string
    items: MemoItem[]
    isLoading: boolean
    error: string | null
  } | null>(null)
  const itemSaveQueues = useRef(new Map<string, Promise<void>>())
  const itemUpdateVersions = useRef(new Map<string, number>())
  const { tags: managedTags, tagColors, refreshTags } = useTagColors()
  const { calendars } = useCalendars()
  const { getBySourceId: getMemoAiTask } = useMemoAiTasks()
  const { pushAction } = useUndoRedo()

  // メモから AI エージェント（Claude / Codex）を起動
  // title/description は source_ideal_goal_id から task-runner が再取得する。
  // ここで両方を連結すると、最終プロンプトで二重送信になる。
  const launchAiForMemo = useCallback(async (item: MemoItem, executor: 'claude' | 'codex' | 'codex_app' = 'claude') => {
    const project = item.project_id ? projects.find(p => p.id === item.project_id) : null
    const repoPath = project?.repo_path
    // codex_app は repo_path 任意（Codex.app 側でユーザーが選べる）
    // claude / codex (headless) は必須
    if (!repoPath && executor !== 'codex_app') {
      throw new Error("プロジェクトにリポジトリパスが未設定です。設定→プロジェクトから登録してください")
    }

    const prompt = item.description?.trim() || item.title

    const res = await fetch("/api/ai-tasks/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        cwd: repoPath ?? null,
        approval_type: "auto",
        source_ideal_goal_id: item.id,
        scheduled_at: new Date().toISOString(),
        executor,
      }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `起動失敗 (${res.status})`)
    }
  }, [projects])

  // 既存呼び出し向けエイリアス（後方互換 / 詳細画面で使用）
  const launchClaudeForMemo = useCallback((item: MemoItem) => launchAiForMemo(item, 'claude'), [launchAiForMemo])
  const launchCodexForMemo = useCallback((item: MemoItem) => launchAiForMemo(item, 'codex'), [launchAiForMemo])
  const launchCodexAppForMemo = useCallback((item: MemoItem) => launchAiForMemo(item, 'codex_app'), [launchAiForMemo])

  // 一覧カードの Codex ボタン: Codex Web を新規タブで開く + タイトル/本文をクリップボードへ
  const openInCodexWebForMemo = useCallback(async (item: MemoItem) => {
    const title = item.title.trim()
    const desc = (item.description ?? "").trim()
    const clip = desc ? `${title}\n\n${desc}` : title
    let copied = false
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clip)
        copied = true
      }
    } catch {
      copied = false
    }
    window.open("https://chatgpt.com/codex", "_blank", "noopener,noreferrer")
    if (!copied) {
      throw new Error("クリップボードコピー失敗。手動でコピーしてください")
    }
  }, [])
  const handleTranscribed = useCallback((text: string) => {
    setIntakeText(prev => prev.trim() ? `${prev.trim()}\n${text}` : text)
  }, [])
  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    permissionState,
    analyserRef,
    startRecording,
    stopRecording,
  } = useVoiceRecorder(handleTranscribed)

  useEffect(() => {
    if (!isAnalyzing || !analyzeStartedAt) {
      setAnalyzeElapsedSeconds(0)
      return
    }
    const interval = window.setInterval(() => {
      setAnalyzeElapsedSeconds(Math.floor((Date.now() - analyzeStartedAt) / 1000))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [analyzeStartedAt, isAnalyzing])

  const fetchItems = useCallback(async () => {
    const params = new URLSearchParams()
    if (selectedSpaceId) params.set("space_id", selectedSpaceId)
    const res = await fetch(`/api/wishlist${params.size ? `?${params.toString()}` : ""}`)
    const { items } = await res.json()
    setItems(items ?? [])
  }, [selectedSpaceId])

  useEffect(() => {
    fetchItems().finally(() => setIsLoading(false))
  }, [fetchItems])

  // 他画面（Today タブ / カレンダー削除）からの更新通知で再取得
  useEffect(() => {
    const handler = () => { void fetchItems() }
    window.addEventListener(WISHLIST_REFRESH_EVENT, handler)
    return () => window.removeEventListener(WISHLIST_REFRESH_EVENT, handler)
  }, [fetchItems])

  useEffect(() => {
    if (typeof window === "undefined") return

    const handler = (event: Event) => {
      const { eventId, startTime, endTime } = (event as CustomEvent<{
        eventId: string
        startTime: string
        endTime: string
      }>).detail
      if (!eventId || !startTime || !endTime) return

      const durationMinutes = Math.max(
        1,
        Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000),
      )
      const applyCalendarTime = (item: MemoItem): MemoItem =>
        item.google_event_id === eventId
          ? {
              ...item,
              scheduled_at: startTime,
              duration_minutes: durationMinutes,
              memo_status: "scheduled",
              updated_at: new Date().toISOString(),
            }
          : item

      setItems(prev => prev.map(applyCalendarTime))
      setSelectedItem(prev => prev ? applyCalendarTime(prev) : prev)
    }

    window.addEventListener(CALENDAR_EVENT_TIME_UPDATE_EVENT, handler)
    return () => window.removeEventListener(CALENDAR_EVENT_TIME_UPDATE_EVENT, handler)
  }, [])

  useEffect(() => {
    async function loadAiModel() {
      try {
        const res = await fetch("/api/ai/context")
        const data = await res.json()
        const savedModel = typeof data.preferences?.ai_ingest_model === "string"
          ? data.preferences.ai_ingest_model
          : "gemini-2.5-flash-lite"
        setSelectedAiModel(
          savedModel === "gemini-3.0-flash" || savedModel === "gemini-3.1-flash-lite"
            ? "gemini-2.5-flash-lite"
            : savedModel,
        )
      } catch {
        setSelectedAiModel("gemini-2.5-flash-lite")
      }
    }
    loadAiModel()
  }, [])

  const allTags = useMemo(() => {
    const set = new Set<string>(managedTags.map(tag => tag.name))
    for (const item of items) {
      if (item.category) set.add(item.category)
      for (const tag of item.tags ?? []) set.add(tag)
    }
    return [...set].slice(0, 12)
  }, [items, managedTags])

  const projectById = useMemo(() => new Map(projects.map(project => [project.id, project])), [projects])

  const linkedMemoIds = useMemo(() => {
    if (!linkedMemoFocus) return null
    return new Set(linkedMemoFocus.items.map(item => item.id))
  }, [linkedMemoFocus])

  const filteredItems = useMemo(() => {
    const sourceItems = linkedMemoIds
      ? items.filter(item => linkedMemoIds.has(item.id))
      : items
    if (linkedMemoIds) return sourceItems
    return sourceItems.filter(item => {
      if (selectedProjectId && item.project_id !== selectedProjectId) return false
      const status = getStatus(item)
      if (statusFilter !== "all" && status !== statusFilter) return false
      if (tagFilter !== "all" && item.category !== tagFilter && !(item.tags ?? []).includes(tagFilter)) return false
      return true
    })
  }, [items, linkedMemoIds, selectedProjectId, statusFilter, tagFilter])

  const visibleAiTaskIds = useMemo(() => {
    const ids = new Set<string>()
    for (const item of filteredItems) {
      const task = getMemoAiTask(item.id)
      if (task?.id) ids.add(task.id)
    }
    return [...ids]
  }, [filteredItems, getMemoAiTask])

  const checkVisibleAiProgress = useCallback(async () => {
    if (isCheckingVisibleAi || visibleAiTaskIds.length === 0) return
    setIsCheckingVisibleAi(true)
    setIntakeError(null)
    try {
      for (let index = 0; index < visibleAiTaskIds.length; index += 3) {
        const batch = visibleAiTaskIds.slice(index, index + 3)
        await Promise.all(batch.map(async taskId => {
          const res = await fetch(`/api/ai-tasks/${taskId}/progress-check`, { method: "POST" })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error || `AI状況更新に失敗しました (${res.status})`)
          }
        }))
      }
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "AI状況更新に失敗しました")
    } finally {
      setIsCheckingVisibleAi(false)
    }
  }, [isCheckingVisibleAi, visibleAiTaskIds])

  // 今日の範囲を 1 分単位で再評価（日跨ぎでも自動で再判定）
  const [nowMinuteKey, setNowMinuteKey] = useState(() => Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const id = window.setInterval(() => setNowMinuteKey(Math.floor(Date.now() / 60_000)), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const todayRange = useMemo(() => getTodayRangeJST(nowMinuteKey * 60_000), [nowMinuteKey])

  const todayItems = useMemo(() => {
    return sortMemoItemsForSection(
      filteredItems.filter(item => getColumn(item, todayRange.start, todayRange.end) === "today"),
      "today",
    )
  }, [filteredItems, todayRange])

  const scheduledItems = useMemo(() => {
    return sortMemoItemsForSection(
      filteredItems.filter(item => getColumn(item, todayRange.start, todayRange.end) === "scheduled"),
      "scheduled",
    )
  }, [filteredItems, todayRange])

  const unscheduledItems = useMemo(() => {
    return sortMemoItemsForSection(
      filteredItems.filter(item => getColumn(item, todayRange.start, todayRange.end) === "unsorted"),
      "unsorted",
    )
  }, [filteredItems, todayRange])

  const completedItems = useMemo(() => {
    return sortMemoItemsForSection(
      filteredItems.filter(item => getColumn(item, todayRange.start, todayRange.end) === "completed"),
      "completed",
    )
  }, [filteredItems, todayRange])

  const targetCalendarId = useMemo(() => {
    const writableCalendars = calendars.filter(calendar => calendar.access_level === "owner" || calendar.access_level === "writer")
    return (
      writableCalendars.find(calendar => calendar.selected && calendar.is_primary)?.google_calendar_id ??
      writableCalendars.find(calendar => calendar.selected)?.google_calendar_id ??
      calendars.find(calendar => calendar.is_primary)?.google_calendar_id ??
      writableCalendars[0]?.google_calendar_id ??
      calendars[0]?.google_calendar_id ??
      "primary"
    )
  }, [calendars])

  const enqueueItemSave = useCallback((id: string, operation: () => Promise<void>) => {
    const previous = itemSaveQueues.current.get(id) ?? Promise.resolve()
    const save = previous.catch(() => undefined).then(operation)
    const tracked = save.finally(() => {
      if (itemSaveQueues.current.get(id) === tracked) {
        itemSaveQueues.current.delete(id)
      }
    })
    itemSaveQueues.current.set(id, tracked)
    return tracked
  }, [])

  const patchMemoItem = useCallback(async (id: string, updates: Record<string, unknown>) => {
    const res = await fetch(`/api/wishlist/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      throw new Error(data.error || "メモの更新に失敗しました")
    }
    if (!data.item) {
      throw new Error("更新結果を取得できませんでした")
    }
    return data.item as MemoItem
  }, [])

  const restoreMemoItem = useCallback(async (item: MemoItem) => {
    const res = await fetch("/api/wishlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildMemoCreatePayload(item)),
    })
    const data = await res.json()
    if (!res.ok || data.error) {
      throw new Error(data.error || "メモの復元に失敗しました")
    }
    if (!data.item) {
      throw new Error("復元結果を取得できませんでした")
    }
    return data.item as MemoItem
  }, [])

  const removeMemoItemFromServer = useCallback(async (id: string) => {
    const res = await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error || "メモの削除に失敗しました")
    }
  }, [])

  const handleUpdate = useCallback(async (id: string, updates: Record<string, unknown>) => {
    if (Object.keys(updates).length > 0) {
      const previousItem = items.find(item => item.id === id) ?? null
      const updateVersion = (itemUpdateVersions.current.get(id) ?? 0) + 1
      itemUpdateVersions.current.set(id, updateVersion)
      const isLatestUpdate = () => itemUpdateVersions.current.get(id) === updateVersion
      const previousItems = items
      const previousSelectedItem = selectedItem
      const optimisticUpdate = (item: MemoItem): MemoItem => ({
        ...item,
        ...updates,
        updated_at: new Date().toISOString(),
      })
      setItems(prev => prev.map(existing => existing.id === id ? optimisticUpdate(existing) : existing))
      setSelectedItem(prev => prev?.id === id ? optimisticUpdate(prev) : prev)
      setIntakeError(null)
      await enqueueItemSave(id, async () => {
        try {
          const item = await patchMemoItem(id, updates)
          if (!isLatestUpdate()) return
          setItems(prev => prev.map(existing => existing.id === id ? item : existing))
          setSelectedItem(prev => prev?.id === id ? item : prev)
          if ("category" in updates || "tags" in updates) {
            await refreshTags()
          }
          if (previousItem) {
            pushAction({
              description: `「${previousItem.title}」を変更`,
              undo: async () => {
                const restored = await patchMemoItem(id, buildMemoUpdatePayload(previousItem))
                setItems(prev => prev.map(existing => existing.id === id ? restored : existing))
                setSelectedItem(prev => prev?.id === id ? restored : prev)
                if ("category" in updates || "tags" in updates) await refreshTags()
              },
              redo: async () => {
                const redone = await patchMemoItem(id, buildMemoUpdatePayload(item))
                setItems(prev => prev.map(existing => existing.id === id ? redone : existing))
                setSelectedItem(prev => prev?.id === id ? redone : prev)
                if ("category" in updates || "tags" in updates) await refreshTags()
              },
            })
          }
        } catch (err) {
          if (isLatestUpdate()) {
            setItems(previousItems)
            setSelectedItem(previousSelectedItem)
            setIntakeError(err instanceof Error ? err.message : "メモの更新に失敗しました")
          }
          throw err
        }
      })
      return
    }
    await fetchItems()
  }, [enqueueItemSave, fetchItems, items, patchMemoItem, pushAction, refreshTags, selectedItem])

  const handleDelete = useCallback(async (id: string) => {
    const deletedItem = items.find(item => item.id === id)
    if (!deletedItem) return
    const deletedIndex = items.findIndex(item => item.id === id)
    const previousSelectedItem = selectedItem
    setItems(prev => prev.filter(item => item.id !== id))
    if (selectedItem?.id === id) setDetailOpen(false)
    setIntakeError(null)
    try {
      await removeMemoItemFromServer(id)
      pushAction({
        description: `「${deletedItem.title}」を削除`,
        undo: async () => {
          const restored = await restoreMemoItem(deletedItem)
          setItems(prev => {
            if (prev.some(item => item.id === restored.id)) return prev
            const next = [...prev]
            next.splice(Math.min(deletedIndex, next.length), 0, restored)
            return next
          })
          if (previousSelectedItem?.id === id) {
            setSelectedItem(restored)
            setDetailOpen(true)
          }
          await refreshTags()
        },
        redo: async () => {
          setItems(prev => prev.filter(item => item.id !== id))
          setSelectedItem(prev => prev?.id === id ? null : prev)
          setDetailOpen(prev => previousSelectedItem?.id === id ? false : prev)
          await removeMemoItemFromServer(id)
        },
      })
      await refreshTags()
    } catch (err) {
      setItems(prev => {
        if (prev.some(item => item.id === deletedItem.id)) return prev
        const next = [...prev]
        next.splice(Math.min(deletedIndex, next.length), 0, deletedItem)
        return next
      })
      if (previousSelectedItem?.id === id) {
        setSelectedItem(previousSelectedItem)
        setDetailOpen(true)
      }
      setIntakeError(err instanceof Error ? err.message : "メモの削除に失敗しました")
    }
  }, [items, pushAction, refreshTags, removeMemoItemFromServer, restoreMemoItem, selectedItem])

  const handleCreate = async () => {
    setIntakeError(null)
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "新しいメモ",
          project_id: selectedProjectId,
          description: "",
          category: "アイデア",
          tags: ["アイデア"],
          memo_status: "unsorted",
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "メモの作成に失敗しました")
      }
      if (!data.item) {
        throw new Error("作成結果を取得できませんでした")
      }
      const item = data.item as MemoItem
      setItems(prev => [item, ...prev])
      setSelectedItem(item)
      setStatusFilter("all")
      setTagFilter("all")
      await refreshTags()
      setDetailOpen(true)
      pushAction({
        description: `「${item.title}」を追加`,
        undo: async () => {
          setItems(prev => prev.filter(existing => existing.id !== item.id))
          setSelectedItem(prev => prev?.id === item.id ? null : prev)
          setDetailOpen(false)
          await removeMemoItemFromServer(item.id)
          await refreshTags()
        },
        redo: async () => {
          const restored = await restoreMemoItem(item)
          setItems(prev => prev.some(existing => existing.id === restored.id) ? prev : [restored, ...prev])
          setSelectedItem(restored)
          setDetailOpen(true)
          await refreshTags()
        },
      })
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "メモの作成に失敗しました")
    }
  }

  const handleQuickAdd = async () => {
    const text = intakeText.trim()
    if (!text || isAnalyzing || isTranscribing) return
    const [firstLine, ...rest] = text.split("\n")
    const title = firstLine.trim().slice(0, 80) || "新しいメモ"
    const description = rest.join("\n").trim() || (text.length > title.length ? text : "")
    setIntakeError(null)
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          project_id: selectedProjectId,
          description,
          category: "アイデア",
          tags: ["アイデア"],
          memo_status: "unsorted",
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "メモの追加に失敗しました")
      }
      if (!data.item) {
        throw new Error("追加結果を取得できませんでした")
      }
      const item = data.item as MemoItem
      setItems(prev => [item, ...prev])
      setIntakeText("")
      setStatusFilter("all")
      setTagFilter("all")
      await refreshTags()
      pushAction({
        description: `「${item.title}」を追加`,
        undo: async () => {
          setItems(prev => prev.filter(existing => existing.id !== item.id))
          await removeMemoItemFromServer(item.id)
          await refreshTags()
        },
        redo: async () => {
          const restored = await restoreMemoItem(item)
          setItems(prev => prev.some(existing => existing.id === restored.id) ? prev : [restored, ...prev])
          await refreshTags()
        },
      })
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "メモの追加に失敗しました")
    }
  }

  const handleAnalyze = async () => {
    if (!intakeText.trim() || isAnalyzing) return
    setIntakeError(null)
    setIsAnalyzing(true)
    setAnalyzeStartedAt(Date.now())
    try {
      const res = await fetch("/api/ai-ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: intakeText, model: selectedAiModel }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setIntakeError(data.error || "整理に失敗しました")
        return
      }
      const suggestedCategory = typeof data.suggestion?.category === "string" && allTags.includes(data.suggestion.category)
        ? data.suggestion.category
        : ""
      setSuggestion({
        ...data.suggestion,
        project_id: selectedProjectId,
        category: suggestedCategory,
        tags: [],
        tag_suggestions: allTags,
      })
      setSuggestionOpen(true)
    } finally {
      setIsAnalyzing(false)
      setAnalyzeStartedAt(null)
    }
  }

  const handleVoiceToggle = async () => {
    if (isTranscribing) return
    if (isRecording) {
      stopRecording()
      return
    }
    await startRecording()
  }

  const handleOpenMicrophoneSettings = async () => {
    await fetch("/api/system/microphone-settings", { method: "POST" }).catch(() => null)
  }

  const saveSuggestion = async (calendarCandidate?: MemoSuggestion["time_candidates"][number], addToCalendar = false) => {
    if (!suggestion?.title.trim() || isSavingSuggestion) return
    setIntakeError(null)
    setIsSavingSuggestion(true)
    const scheduledAt = calendarCandidate?.scheduled_at ?? suggestion.scheduled_at
    const durationMinutes = calendarCandidate?.duration_minutes ?? suggestion.duration_minutes
    try {
      const res = await fetch("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suggestion.title,
          project_id: suggestion.project_id ?? selectedProjectId,
          category: suggestion.category,
          tags: suggestion.tags,
          description: suggestion.description,
          time_candidates: suggestion.time_candidates,
          subtask_suggestions: suggestion.subtask_suggestions,
          scheduled_at: scheduledAt,
          duration_minutes: durationMinutes,
          memo_status: scheduledAt ? "time_candidates" : "unsorted",
          ai_source_payload: { suggestion, intakeText },
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || "メモの保存に失敗しました")
      }
      if (!data.item) {
        throw new Error("保存結果を取得できませんでした")
      }
      const item = data.item as MemoItem
      setItems(prev => [item, ...prev])
      setStatusFilter("all")
      setTagFilter("all")
      await refreshTags()
      if (addToCalendar && item.scheduled_at && item.duration_minutes) {
        await handleCalendarAdd(item)
      }
      setSuggestion(null)
      setSuggestionOpen(false)
      setIntakeText("")
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "メモの保存に失敗しました")
    } finally {
      setIsSavingSuggestion(false)
    }
  }

  const handleCalendarAdd = useCallback(async (item: MemoItem) => {
    const optimisticEventId = `optimistic-wishlist-${item.id}`
    const startTime = item.scheduled_at ? new Date(item.scheduled_at) : null
    const durationMinutes = item.duration_minutes ?? 60
    const calendarId = targetCalendarId

    if (startTime && !Number.isNaN(startTime.getTime())) {
      if (item.google_event_id) {
        broadcastCalendarOptimisticEventRemoval(item.google_event_id, item.google_event_id)
      }
      const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)
      const now = new Date().toISOString()
      const optimisticEvent: CalendarEvent = {
        id: optimisticEventId,
        user_id: item.user_id ?? "",
        google_event_id: "",
        calendar_id: calendarId,
        title: item.title,
        description: item.description ?? undefined,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        is_all_day: false,
        timezone: "Asia/Tokyo",
        synced_at: now,
        created_at: now,
        updated_at: now,
      }
      broadcastCalendarOptimisticEvent(optimisticEvent)
    }

    try {
      const res = await fetch(`/api/wishlist/${item.id}/calendar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: item.scheduled_at,
          duration_minutes: item.duration_minutes,
          title: item.title,
          description: item.description,
          calendar_id: calendarId,
        }),
      })
      if (!res.ok) {
        broadcastCalendarOptimisticEventRemoval(optimisticEventId)
        broadcastCalendarSync()
        const { error } = await res.json()
        setIntakeError(`カレンダー登録に失敗しました: ${error}`)
        return false
      }
      const { google_event_id, item: updatedItem } = await res.json()
      if (updatedItem) {
        setItems(prev => prev.map(existing => existing.id === item.id ? updatedItem : existing))
        setSelectedItem(prev => prev?.id === item.id ? updatedItem : prev)
      } else {
        await handleUpdate(item.id, { google_event_id, memo_status: "scheduled", is_today: false })
      }
    } catch (err) {
      broadcastCalendarOptimisticEventRemoval(optimisticEventId)
      broadcastCalendarSync()
      setIntakeError(`カレンダー登録に失敗しました: ${err instanceof Error ? err.message : "通信エラー"}`)
      return false
    }
    invalidateCalendarCache()
    broadcastCalendarSync()
    return true
  }, [handleUpdate, targetCalendarId])

  const handleMemoCalendarDrop = useCallback(async (memoId: string, startTime: Date, durationMinutes: number) => {
    const target = items.find(item => item.id === memoId)
    if (!target || target.is_completed || target.memo_status === "completed") return
    if (Number.isNaN(startTime.getTime())) {
      setIntakeError("カレンダー登録に失敗しました: 日時を取得できませんでした")
      return
    }

    const nextDuration = durationMinutes > 0 ? durationMinutes : TODAY_DURATION_DEFAULT
    const scheduledAt = startTime.toISOString()
    const previousItems = items
    const previousSelectedItem = selectedItem
    const now = new Date().toISOString()
    const scheduleItem = (item: MemoItem): MemoItem => ({
      ...item,
      scheduled_at: scheduledAt,
      duration_minutes: nextDuration,
      memo_status: "scheduled",
      is_today: false,
      updated_at: now,
    })
    const itemForSchedule = scheduleItem(target)

    setItems(prev => prev.map(item => item.id === memoId ? scheduleItem(item) : item))
    setSelectedItem(prev => prev?.id === memoId ? scheduleItem(prev) : prev)
    setIntakeError(null)

    const scheduled = await handleCalendarAdd(itemForSchedule)
    if (!scheduled) {
      setItems(previousItems)
      setSelectedItem(previousSelectedItem)
      return
    }

    window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
  }, [handleCalendarAdd, items, selectedItem])

  useEffect(() => {
    if (!isCalendarSplitVisible) return
    const handler = (memoId: string, startTime: Date, durationMinutes: number) => {
      return handleMemoCalendarDrop(memoId, startTime, durationMinutes)
    }
    window.__focusmapMemoDropHandler = handler
    return () => {
      if (window.__focusmapMemoDropHandler === handler) {
        window.__focusmapMemoDropHandler = undefined
      }
    }
  }, [handleMemoCalendarDrop, isCalendarSplitVisible])

  const openTodayRemovalDialog = useCallback((item: MemoItem) => {
    const scheduledDate = item.scheduled_at ? new Date(item.scheduled_at) : new Date()
    if (Number.isNaN(scheduledDate.getTime())) {
      scheduledDate.setTime(Date.now())
    }
    if (!item.scheduled_at) {
      scheduledDate.setHours(9, 0, 0, 0)
    }
    setTodayRemovalDialog({
      item,
      scheduledDate,
      durationMinutes: item.duration_minutes ?? 30,
      isSaving: false,
    })
  }, [])

  const handleToggleTodayFromCard = useCallback(async (item: MemoItem, isTodayColumn: boolean) => {
    if (isTodayColumn) {
      openTodayRemovalDialog(item)
      return
    }
    await handleUpdate(item.id, { is_today: true })
  }, [handleUpdate, openTodayRemovalDialog])

  const handleUnscheduleMemo = useCallback(async (item: MemoItem) => {
    const previousItem = item
    const previousSelectedItem = selectedItem?.id === item.id ? selectedItem : null
    const clearedItem = (target: MemoItem): MemoItem => ({
      ...target,
      scheduled_at: null,
      google_event_id: null,
      memo_status: "unsorted",
      is_today: false,
      updated_at: new Date().toISOString(),
    })

    setItems(prev => prev.map(existing => existing.id === item.id ? clearedItem(existing) : existing))
    setSelectedItem(prev => prev?.id === item.id ? clearedItem(prev) : prev)
    setIntakeError(null)

    try {
      let data: { item?: MemoItem; error?: string } = {}
      let lastError: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await fetch(`/api/wishlist/${item.id}/unschedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ calendar_id: targetCalendarId }),
          })
          data = await res.json().catch(() => ({}))
          if (!res.ok || data.error) {
            throw new Error(data.error || "予定の解除に失敗しました")
          }
          lastError = null
          break
        } catch (err) {
          lastError = err
          if (attempt === 0) {
            await new Promise(resolve => window.setTimeout(resolve, 350))
          }
        }
      }
      if (lastError) {
        throw lastError
      }
      if (data.item) {
        const updatedItem = data.item as MemoItem
        setItems(prev => prev.map(existing => existing.id === item.id ? updatedItem : existing))
        setSelectedItem(prev => prev?.id === item.id ? updatedItem : prev)
      }
      invalidateCalendarCache()
      broadcastCalendarSync()
      window.dispatchEvent(new CustomEvent(WISHLIST_REFRESH_EVENT))
    } catch (err) {
      setItems(prev => prev.map(existing => existing.id === item.id ? previousItem : existing))
      setSelectedItem(prev => prev?.id === item.id ? previousSelectedItem ?? previousItem : prev)
      const message = err instanceof Error ? err.message : "予定の解除に失敗しました"
      setIntakeError(`予定の解除に失敗したため、元の状態に戻しました。${message}`)
      throw err
    }
  }, [selectedItem, targetCalendarId])

  const handleDialogUnschedule = useCallback(() => {
    if (!todayRemovalDialog) return
    const item = todayRemovalDialog.item
    setTodayRemovalDialog(null)
    void handleUnscheduleMemo(item).catch(() => undefined)
  }, [handleUnscheduleMemo, todayRemovalDialog])

  const handleDialogOpenTodaySchedule = useCallback(() => {
    if (!todayRemovalDialog) return
    const date = todayRemovalDialog.scheduledDate ?? new Date()
    onOpenTodayMemoSchedule?.({ memoId: todayRemovalDialog.item.id, date })
    setTodayRemovalDialog(null)
  }, [onOpenTodayMemoSchedule, todayRemovalDialog])

  const handleDialogReschedule = useCallback(async () => {
    if (!todayRemovalDialog) return
    const scheduledDate = todayRemovalDialog.scheduledDate
    if (!scheduledDate) {
      setIntakeError("日付を選択してください")
      return
    }
    setTodayRemovalDialog(prev => prev ? { ...prev, isSaving: true } : prev)
    try {
      const itemForSchedule = {
        ...todayRemovalDialog.item,
        scheduled_at: scheduledDate.toISOString(),
        duration_minutes: todayRemovalDialog.durationMinutes,
        memo_status: "time_candidates",
        is_today: false,
      } as MemoItem
      const scheduled = await handleCalendarAdd(itemForSchedule)
      if (!scheduled) throw new Error("カレンダー登録に失敗しました")
      setTodayRemovalDialog(null)
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : "予定の変更に失敗しました")
      setTodayRemovalDialog(prev => prev ? { ...prev, isSaving: false } : prev)
    }
  }, [handleCalendarAdd, todayRemovalDialog])

  const openDetail = useCallback((item: MemoItem) => {
    setSelectedItem(item)
    setDetailOpen(true)
  }, [])

  useEffect(() => {
    if (!mindmapMemoFocus) return
    const focus = mindmapMemoFocus
    let cancelled = false
    setLinkedMemoFocus({
      taskId: focus.taskId,
      taskTitle: "",
      items: [],
      isLoading: true,
      error: null,
    })

    async function loadLinkedMemos() {
      try {
        const res = await fetch(`/api/mindmap/memo-links?task_id=${encodeURIComponent(focus.taskId)}`, {
          cache: "no-store",
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || "関連メモの取得に失敗しました")
        const linkedItems = Array.isArray(data.items) ? data.items as MemoItem[] : []
        if (cancelled) return
        setItems(prev => {
          const byId = new Map(prev.map(item => [item.id, item]))
          for (const item of linkedItems) byId.set(item.id, item)
          return [...byId.values()]
        })
        setLinkedMemoFocus({
          taskId: focus.taskId,
          taskTitle: typeof data.task?.title === "string" ? data.task.title : "",
          items: linkedItems,
          isLoading: false,
          error: null,
        })
        if (linkedItems[0]) openDetail(linkedItems[0])
      } catch (err) {
        if (cancelled) return
        setLinkedMemoFocus({
          taskId: focus.taskId,
          taskTitle: "",
          items: [],
          isLoading: false,
          error: err instanceof Error ? err.message : "関連メモの取得に失敗しました",
        })
      }
    }

    void loadLinkedMemos()
    return () => {
      cancelled = true
    }
  }, [mindmapMemoFocus, openDetail])

  // D&D: ドロップしたカラムキー（droppableId）からカラム遷移を判定し、更新を投げる
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const handleDragEnd = useCallback(async (result: DropResult) => {
    if (!result.destination) return
    const { source, destination, draggableId } = result
    if (source.droppableId === destination.droppableId) return // 同一カラム内は何もしない

    const item = itemById.get(draggableId)
    if (!item) return
    const to = destination.droppableId as ColumnKey

    // 「予定済み」へのドロップは時刻設定が必要なので、詳細シートを開いて促す
    if (to === "scheduled") {
      setIntakeError("予定済みにするには時刻を設定してください。詳細を開きました。")
      openDetail(item)
      return
    }

    let updates: Partial<MemoItem> | null = null
    if (to === "today") {
      // unsorted/scheduled/completed → today: is_today=true、completedからの復活は完了解除
      updates = source.droppableId === "completed"
        ? { is_completed: false, memo_status: "unsorted", is_today: true }
        : { is_today: true }
    } else if (to === "unsorted") {
      // today → unsorted: 確認ダイアログで、未予定へ戻すか別日に予定し直すかを選ぶ
      if (source.droppableId === "today") {
        openTodayRemovalDialog(item)
        return
      }
      // scheduled → unsorted: Google カレンダー予定も含めて予定情報を解除
      if (source.droppableId === "scheduled") {
        await handleUnscheduleMemo(item)
        return
      }
      // completed → unsorted: 完了解除し、予定情報も残さない
      updates = {
        is_completed: false,
        memo_status: "unsorted",
        is_today: false,
        scheduled_at: null,
        google_event_id: null,
      }
    } else if (to === "completed") {
      updates = { is_completed: true, memo_status: "completed", is_today: false }
    }

    if (updates) {
      await handleUpdate(item.id, updates as Record<string, unknown>)
    }
  }, [handleUnscheduleMemo, itemById, handleUpdate, openDetail, openTodayRemovalDialog])

  if (isLoading) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">読み込み中...</div>
  }

  const hasIntakeText = intakeText.trim().length > 0
  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + (tagFilter !== "all" ? 1 : 0)
  const primaryActionLabel = isAnalyzing
    ? "整理中"
    : isTranscribing
      ? "変換中"
      : isRecording
        ? "停止"
        : hasIntakeText
          ? "生成"
          : "音声"
  const PrimaryActionIcon = isAnalyzing || isTranscribing
    ? Loader2
    : isRecording
      ? Square
      : hasIntakeText
        ? Sparkles
        : Mic
  const handlePrimaryIntakeAction = async () => {
    if (isAnalyzing || isTranscribing) return
    if (hasIntakeText) {
      await handleAnalyze()
      return
    }
    await handleVoiceToggle()
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className={cn("shrink-0 border-b px-3 py-2", compactComposer ? "space-y-0 md:px-3" : "space-y-2 md:px-5")}>
        {compactComposer ? (
          <div className="flex items-center gap-2">
            <input
              value={intakeText}
              onChange={e => setIntakeText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleQuickAdd()
              }}
              placeholder="メモを入力"
              className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              disabled={isAnalyzing || isTranscribing}
            />
            <Button
              type="button"
              onClick={handleVoiceToggle}
              disabled={isTranscribing}
              variant={isRecording ? "destructive" : "outline"}
              className="h-10 shrink-0 gap-1.5 px-3"
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              <span>{isRecording ? "停止" : "音声"}</span>
            </Button>
            <Button
              type="button"
              onClick={handleQuickAdd}
              disabled={!hasIntakeText || isRecording || isAnalyzing || isTranscribing}
              className="h-10 shrink-0 gap-1 px-3"
            >
              <Plus className="h-4 w-4" />
              追加
            </Button>
          </div>
        ) : (
        <>
          <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">メモ</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">雑な入力を整理</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={checkVisibleAiProgress}
            disabled={isCheckingVisibleAi || visibleAiTaskIds.length === 0}
            className="min-h-[40px] shrink-0 gap-1.5 px-3"
            title="表示中メモのAI状況をまとめて更新"
          >
            <RefreshCw className={cn("h-4 w-4", isCheckingVisibleAi && "animate-spin")} />
            <span className="hidden sm:inline">AI状況</span>
            {visibleAiTaskIds.length > 0 && (
              <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                {visibleAiTaskIds.length}
              </span>
            )}
          </Button>
          {onToggleCalendarSplit && (
            <Button
              type="button"
              variant={isCalendarSplitVisible ? "default" : "outline"}
              size="icon"
              onClick={onToggleCalendarSplit}
              aria-pressed={isCalendarSplitVisible}
              aria-label={isCalendarSplitVisible ? "カレンダーを閉じる" : "カレンダーを表示"}
              className="hidden min-h-[40px] min-w-[40px] shrink-0 md:inline-flex"
              title={isCalendarSplitVisible ? "カレンダーを閉じる" : "カレンダーを表示"}
            >
              <Calendar className="h-4 w-4" />
            </Button>
          )}
          <Button
            type="button"
            variant={filterOpen ? "default" : "outline"}
            size="icon"
            onClick={() => setFilterOpen(open => !open)}
            aria-label={filterOpen ? "フィルターを閉じる" : "フィルターを開く"}
            className="relative min-h-[40px] min-w-[40px] shrink-0"
            title={filterOpen ? "フィルターを閉じる" : "フィルターを開く"}
          >
            <Filter className="h-4 w-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-background px-1.5 text-[10px] leading-4 text-foreground ring-1 ring-border">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button onClick={handleCreate} size="sm" className="min-h-[40px] shrink-0 gap-1 px-3">
            <Plus className="h-4 w-4" /> 追加
          </Button>
          </div>

          <div className="flex gap-2">
          <textarea
            value={intakeText}
            onChange={e => setIntakeText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAnalyze() }}
            placeholder="音声またはテキストで入力"
            rows={1}
            className="min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button
            type="button"
            onClick={handlePrimaryIntakeAction}
            disabled={isAnalyzing || isTranscribing}
            variant={isRecording ? "destructive" : hasIntakeText ? "default" : "outline"}
            className="min-h-[44px] min-w-[86px] shrink-0 gap-1 px-3"
          >
            <PrimaryActionIcon className={cn("h-4 w-4", (isAnalyzing || isTranscribing) && "animate-spin")} />
            <span>{primaryActionLabel}</span>
          </Button>
          </div>
          {isAnalyzing && (
          <div className="flex min-h-10 flex-wrap items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="font-medium text-foreground">
              {ANALYZE_STATUS_MESSAGES[Math.min(Math.floor(analyzeElapsedSeconds / 4), ANALYZE_STATUS_MESSAGES.length - 1)]}
            </span>
            <span>{analyzeElapsedSeconds}秒経過</span>
          </div>
          )}
          {intakeError && !isAnalyzing && (
          <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <span>{intakeError}</span>
            <button
              type="button"
              onClick={() => setIntakeError(null)}
              className="shrink-0 rounded px-2 py-1 hover:bg-destructive/10"
            >
              閉じる
            </button>
          </div>
          )}
          {(isRecording || isTranscribing || voiceError) && (
          <div className="flex min-h-8 flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
            {isRecording && (
              <>
                <span className="font-medium text-destructive">録音中</span>
                <VoiceWaveform analyserRef={analyserRef} height={20} barCount={20} />
              </>
            )}
            {isTranscribing && (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>文字起こし中...</span>
              </>
            )}
            {voiceError && <span className="min-w-0 flex-1 text-destructive">{voiceError}</span>}
            {permissionState === "prompt" && !voiceError && (
              <span>許可ダイアログが出たらマイクを許可してください</span>
            )}
            {permissionState === "denied" && (
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenMicrophoneSettings}
                  className="h-8 gap-1 text-xs"
                >
                  <Settings className="h-3.5 w-3.5" /> 設定を開く
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.location.reload()}
                  className="h-8 gap-1 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 再読み込み
                </Button>
              </div>
            )}
          </div>
          )}
          <div className={cn(!filterOpen && "hidden")}>
          <FilterBar
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            tags={allTags}
            tagColors={tagColors}
            onStatusChange={setStatusFilter}
            onTagChange={setTagFilter}
          />
          </div>
        </>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto px-4 py-4 pb-24 md:px-6">
          {linkedMemoFocus && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {linkedMemoFocus.taskTitle ? `「${linkedMemoFocus.taskTitle}」の関連メモ` : "関連メモ"}
                </div>
                <div className="text-muted-foreground">
                  {linkedMemoFocus.isLoading
                    ? "読み込み中..."
                    : linkedMemoFocus.error
                      ? linkedMemoFocus.error
                      : `${linkedMemoFocus.items.length}件`}
                </div>
              </div>
              <button
                type="button"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setLinkedMemoFocus(null)}
                aria-label="関連メモ表示を閉じる"
                title="関連メモ表示を閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {linkedMemoFocus?.isLoading ? (
            <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              関連メモを読み込み中...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>{linkedMemoFocus ? "このノードに紐付くメモはありません" : "メモはまだありません"}</p>
              {!linkedMemoFocus && (
                <Button variant="outline" onClick={handleCreate} className="min-h-[44px]">
                  <Plus className="mr-1 h-4 w-4" /> 追加
                </Button>
              )}
            </div>
          ) : linkedMemoFocus ? (
            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="mx-auto max-w-2xl">
                <MemoSection
                  columnKey="unsorted"
                  title="関連メモ"
                  count={filteredItems.length}
                  items={filteredItems}
                  emptyText="関連メモはありません"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                  projectById={projectById}
                  tagColors={tagColors}
                  getAiTask={getMemoAiTask}
                  onOpenCodex={openInCodexWebForMemo}
                  onToggleToday={handleToggleTodayFromCard}
                  nativeMemoDrag={isCalendarSplitVisible}
                />
              </div>
            </DragDropContext>
          ) : (
            <DragDropContext onDragEnd={handleDragEnd}>
            <div className="mx-auto overflow-x-auto pb-2">
              <div className="grid min-w-0 max-w-7xl gap-4 md:min-w-[72rem] md:grid-cols-5">
                <MemoSection
                  columnKey="unsorted"
                  title="未予定"
                  count={unscheduledItems.length}
                  items={unscheduledItems}
                  emptyText="未予定のメモはありません"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                  projectById={projectById}
                  tagColors={tagColors}
                  getAiTask={getMemoAiTask}
                  onOpenCodex={openInCodexWebForMemo}
                  onToggleToday={handleToggleTodayFromCard}
                  nativeMemoDrag={isCalendarSplitVisible}
                  className="md:col-span-2"
                  listClassName="sm:grid-cols-2"
                />
                <MemoSection
                  columnKey="today"
                  title="今日する"
                  count={todayItems.length}
                  items={todayItems}
                  emptyText="今日するメモはありません"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                  projectById={projectById}
                  tagColors={tagColors}
                  getAiTask={getMemoAiTask}
                  onOpenCodex={openInCodexWebForMemo}
                  onToggleToday={handleToggleTodayFromCard}
                  nativeMemoDrag={isCalendarSplitVisible}
                />
                <MemoSection
                  columnKey="scheduled"
                  title="予定済み"
                  count={scheduledItems.length}
                  items={scheduledItems}
                  emptyText="予定済みのメモはありません"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                  projectById={projectById}
                  tagColors={tagColors}
                  getAiTask={getMemoAiTask}
                  onOpenCodex={openInCodexWebForMemo}
                  onToggleToday={handleToggleTodayFromCard}
                  nativeMemoDrag={false}
                />
                <MemoSection
                  columnKey="completed"
                  title="完了"
                  count={completedItems.length}
                  items={completedItems}
                  emptyText="完了したメモはありません"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                  projectById={projectById}
                  tagColors={tagColors}
                  getAiTask={getMemoAiTask}
                  onOpenCodex={openInCodexWebForMemo}
                  onToggleToday={handleToggleTodayFromCard}
                  nativeMemoDrag={false}
                />
              </div>
            </div>
            </DragDropContext>
          )}
        </div>
      </div>

      <SuggestionSheet
        suggestion={suggestion}
        open={suggestionOpen}
        onOpenChange={setSuggestionOpen}
        onChange={setSuggestion}
        onSave={saveSuggestion}
        registeredTags={allTags}
        tagColors={tagColors}
        projects={projects}
        isSaving={isSavingSuggestion}
      />

      <WishlistCardDetail
        item={selectedItem}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={handleUpdate}
        onCalendarAdd={async item => { await handleCalendarAdd(item) }}
        onSaved={() => setDetailOpen(false)}
        tagOptions={allTags}
        projects={projects}
        tagColors={tagColors}
        onLaunchClaude={launchClaudeForMemo}
        onLaunchCodex={launchCodexForMemo}
        onLaunchCodexApp={launchCodexAppForMemo}
        onMemoChanged={fetchItems}
      />

      <TodayRemovalDialog
        state={todayRemovalDialog}
        onChange={updates => setTodayRemovalDialog(prev => prev ? { ...prev, ...updates } : prev)}
        onOpenChange={open => {
          if (!open && !todayRemovalDialog?.isSaving) setTodayRemovalDialog(null)
        }}
        onUnschedule={handleDialogUnschedule}
        onOpenTodaySchedule={handleDialogOpenTodaySchedule}
        onReschedule={handleDialogReschedule}
      />
    </div>
  )
}

function TodayRemovalDialog({
  state,
  onChange,
  onOpenChange,
  onUnschedule,
  onOpenTodaySchedule,
  onReschedule,
}: {
  state: TodayRemovalDialogState | null
  onChange: (updates: Partial<TodayRemovalDialogState>) => void
  onOpenChange: (open: boolean) => void
  onUnschedule: () => void
  onOpenTodaySchedule: () => void
  onReschedule: () => Promise<void>
}) {
  if (!state) return null

  const scheduledLabel = state.scheduledDate
    ? state.scheduledDate.toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "日時を選択"

  return (
    <Dialog open={!!state} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>今日するから外しますか？</DialogTitle>
          <DialogDescription>
            「{state.item.title}」を未予定へ戻すか、Todayのカレンダーにドラッグして別日に入れ直せます。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Button type="button" variant="secondary" disabled={state.isSaving} onClick={onUnschedule} className="min-h-[44px] justify-start">
            未予定に戻す
          </Button>
          <Button type="button" variant="outline" disabled={state.isSaving} onClick={onOpenTodaySchedule} className="min-h-[44px] justify-start">
            <Calendar className="mr-1 h-4 w-4" />
            ドラッグで予定し直す
          </Button>

          <div className="rounded-lg border bg-muted/20 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">日時を指定</div>
            <div className="grid gap-2 sm:grid-cols-2">
              <DateTimePicker
                date={state.scheduledDate}
                setDate={date => onChange({ scheduledDate: date })}
                trigger={
                  <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start">
                    <Calendar className="mr-2 h-4 w-4" />
                    {scheduledLabel}
                  </Button>
                }
              />
              <DurationWheelPicker
                duration={state.durationMinutes}
                onDurationChange={durationMinutes => onChange({ durationMinutes })}
                trigger={
                  <Button type="button" variant="outline" className="min-h-[44px] w-full justify-start">
                    <Clock className="mr-2 h-4 w-4" />
                    {formatDuration(state.durationMinutes)}
                  </Button>
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={state.isSaving} onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="button" disabled={state.isSaving || !state.scheduledDate} onClick={onReschedule}>
            {state.isSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Calendar className="mr-1 h-4 w-4" />}
            この日時で予定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function MemoSection({
  columnKey,
  title,
  count,
  items,
  emptyText,
  onUpdate,
  onDelete,
  onOpen,
  projectById,
  tagColors,
  className,
  listClassName,
  getAiTask,
  onOpenCodex,
  onToggleToday,
  nativeMemoDrag = false,
}: {
  columnKey: ColumnKey
  title: string
  count: number
  items: MemoItem[]
  emptyText: string
  onUpdate: (id: string, updates: Record<string, unknown>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onOpen: (item: MemoItem) => void
  projectById: Map<string, Project>
  tagColors: Record<string, string>
  className?: string
  listClassName?: string
  getAiTask: (sourceId: string) => import("@/types/ai-task").AiTask | null
  onOpenCodex: (item: MemoItem) => Promise<void>
  onToggleToday: (item: MemoItem, isTodayColumn: boolean) => Promise<void>
  nativeMemoDrag?: boolean
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{count}</span>
      </div>
      <Droppable droppableId={columnKey}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={cn(
              "rounded-lg transition-colors",
              snapshot.isDraggingOver && "bg-primary/5 ring-1 ring-primary/30",
            )}
          >
            {items.length === 0 ? (
              <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              <div className={cn("grid gap-3", listClassName)}>
                {items.map((item, index) => (
                  <Draggable key={item.id} draggableId={item.id} index={index}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                        className={cn(
                          "rounded-lg transition-shadow",
                          dragSnapshot.isDragging && "opacity-80 shadow-xl ring-2 ring-primary/40",
                        )}
                      >
                        <WishlistCard
                          item={item}
                          onUpdate={onUpdate}
                          onDelete={onDelete}
                          onClick={() => onOpen(item)}
                          project={item.project_id ? projectById.get(item.project_id) ?? null : null}
                          tagColors={tagColors}
                          aiTask={getAiTask(item.id)}
                          onOpenCodex={() => onOpenCodex(item)}
                          onToggleToday={onToggleToday}
                          nativeMemoDrag={nativeMemoDrag}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  )
}

function FilterBar({
  statusFilter,
  tagFilter,
  tags,
  tagColors,
  onStatusChange,
  onTagChange,
}: {
  statusFilter: MemoStatus | "all"
  tagFilter: string | "all"
  tags: string[]
  tagColors: Record<string, string>
  onStatusChange: (status: MemoStatus | "all") => void
  onTagChange: (tag: string | "all") => void
}) {
  const statusOptions: Array<MemoStatus | "all"> = ["all", "unsorted", "scheduled", "completed"]
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex shrink-0 items-center gap-1 border-r pr-2">
        {statusOptions.map(status => (
          <button
            key={status}
            onClick={() => onStatusChange(status)}
            className={cn(
              "min-h-8 shrink-0 rounded-full border px-2.5 text-[11px]",
              statusFilter === status ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          onClick={() => onTagChange("all")}
          className={cn(
            "min-h-8 shrink-0 rounded-full border px-2.5 text-[11px]",
            tagFilter === "all" ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground",
          )}
        >
          タグすべて
        </button>
        {tags.map(tag => {
          const color = getTagColor(tag, tagColors)
          return (
            <button
              key={tag}
              onClick={() => onTagChange(tag)}
              className="min-h-8 shrink-0 rounded-full border px-2.5 text-[11px]"
              style={{
                borderColor: color,
                backgroundColor: tagFilter === tag ? color : `${color}22`,
                color: tagFilter === tag ? "#fff" : color,
              }}
            >
              {tag}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SuggestionSheet({
  suggestion,
  open,
  onOpenChange,
  onChange,
  onSave,
  registeredTags,
  tagColors,
  projects,
  isSaving,
}: {
  suggestion: MemoSuggestion | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChange: (suggestion: MemoSuggestion | null) => void
  onSave: (candidate?: MemoSuggestion["time_candidates"][number], addToCalendar?: boolean) => Promise<void>
  registeredTags: string[]
  tagColors: Record<string, string>
  projects: Project[]
  isSaving: boolean
}) {
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState<number | null>(null)
  const [newTagText, setNewTagText] = useState("")

  if (!suggestion) return null

  const update = (updates: Partial<MemoSuggestion>) => onChange({ ...suggestion, ...updates })
  const selectedCandidate = selectedCandidateIndex === null ? undefined : suggestion.time_candidates[selectedCandidateIndex]
  const canCalendar = !!(selectedCandidate?.scheduled_at || suggestion.scheduled_at) && !!suggestion.duration_minutes
  const selectedTags = Array.from(new Set([suggestion.category, ...suggestion.tags].filter(Boolean)))
  const registeredTagOptions = registeredTags.filter(tag => !selectedTags.includes(tag)).slice(0, 8)
  const durationText = suggestion.duration_input ?? (suggestion.duration_minutes ? String(suggestion.duration_minutes) : "")
  const dateValue = suggestion.date_input ?? formatDateValue(suggestion.scheduled_at)
  const timeValue = suggestion.time_input ?? formatTimeInput(suggestion.scheduled_at)
  const dateOptions = buildDateOptions(dateValue)
  const timeOptions = buildTimeOptions(timeValue)

  const setTags = (tags: string[]) => {
    const nextTags = Array.from(new Set(tags.map(tag => tag.trim()).filter(Boolean))).slice(0, 6)
    update({
      category: nextTags[0] ?? "",
      tags: nextTags.slice(1),
    })
  }

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed || selectedTags.includes(trimmed)) return
    setTags([...selectedTags, trimmed])
  }

  const removeTag = (tag: string) => {
    setTags(selectedTags.filter(selectedTag => selectedTag !== tag))
  }

  const handleAddNewTag = () => {
    addTag(newTagText)
    setNewTagText("")
  }

  const handleScheduleChange = (nextDateValue: string, nextTimeValue: string) => {
    update({
      date_input: nextDateValue,
      time_input: nextTimeValue,
      scheduled_at: combineDateTime(nextDateValue, nextTimeValue),
      memo_status: nextDateValue ? "time_candidates" : suggestion.memo_status,
    })
  }

  const handleDurationTextChange = (value: string) => {
    const normalized = value.replace(/[^\d]/g, "")
    if (!normalized) {
      update({ duration_input: "", duration_minutes: null })
      return
    }
    const minutes = Number(normalized)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      update({ duration_input: normalized, duration_minutes: null })
      return
    }
    update({ duration_input: normalized, duration_minutes: Math.min(minutes, 720) })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl border-border/70 bg-background/95 shadow-2xl backdrop-blur md:left-1/2 md:max-w-2xl md:-translate-x-1/2">
        <SheetHeader>
          <SheetTitle className="text-left">生成結果</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">メモの見出し</label>
            <Input
              value={suggestion.title}
              onChange={e => update({ title: e.target.value })}
              placeholder="見出し"
              className="min-h-[50px] rounded-xl border-border/80 bg-muted/20 px-4 text-base font-semibold shadow-none"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">プロジェクト</label>
            <div className="relative">
              <select
                value={suggestion.project_id ?? ""}
                onChange={e => update({ project_id: e.target.value || null })}
                className="min-h-[48px] w-full appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 pr-10 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-primary/20"
                aria-label="プロジェクト"
              >
                <option value="">プロジェクト未設定</option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>{project.title}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">メモ</label>
            <textarea
              value={suggestion.description}
              onChange={e => update({ description: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-xl border border-border/80 bg-muted/20 px-4 py-3 text-sm leading-6 outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">タグ</label>
            <div className="flex flex-wrap gap-1.5">
              {selectedTags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="min-h-9 rounded-full border px-3 text-xs transition-colors"
                  style={{
                    borderColor: getTagColor(tag, tagColors),
                    backgroundColor: `${getTagColor(tag, tagColors)}22`,
                    color: getTagColor(tag, tagColors),
                  }}
                >
                  {tag} ×
                </button>
              ))}
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <div className="relative">
                <select
                  value=""
                  onChange={e => {
                    addTag(e.target.value)
                    e.target.value = ""
                  }}
                  className="min-h-[48px] w-full appearance-none rounded-xl border border-border/80 bg-muted/20 px-4 pr-10 text-sm outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-primary/20"
                  aria-label="登録タグを選択"
                >
                  <option value="">登録タグから選択</option>
                  {registeredTagOptions.map(tag => (
                    <option key={tag} value={tag}>
                      {tag}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <Input
                value={newTagText}
                onChange={e => setNewTagText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") handleAddNewTag()
                }}
                placeholder="新しいタグ"
                className="min-h-[48px] rounded-xl bg-muted/20"
              />
              <Button type="button" variant="outline" onClick={handleAddNewTag} className="min-h-[48px] rounded-xl px-4">
                <Plus className="mr-1 h-4 w-4" />
                追加
              </Button>
            </div>
            {registeredTagOptions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {registeredTagOptions.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addTag(tag)}
                    className="min-h-9 rounded-full border px-3 text-xs transition-colors"
                    style={{
                      borderColor: `${getTagColor(tag, tagColors)}88`,
                      backgroundColor: `${getTagColor(tag, tagColors)}14`,
                      color: getTagColor(tag, tagColors),
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">所要時間</label>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_OPTIONS.map(option => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => {
                    update({
                      duration_input: option.minutes ? String(option.minutes) : "",
                      duration_minutes: option.minutes,
                    })
                  }}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs transition-colors",
                    suggestion.duration_minutes === option.minutes || (!suggestion.duration_minutes && option.minutes === null)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex min-h-[52px] items-center rounded-xl border border-border/80 bg-muted/20 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-primary/20">
                <Input
                  type="text"
                  inputMode="numeric"
                  value={durationText}
                  onChange={e => handleDurationTextChange(e.target.value)}
                  placeholder="未設定"
                  className="h-12 border-0 bg-transparent px-4 text-center text-base font-semibold shadow-none focus-visible:ring-0"
                  aria-label="所要時間"
                />
                <span className="pr-3 text-sm text-muted-foreground">分</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className="text-xs text-muted-foreground">日付</span>
              <div className="relative flex min-h-[52px] items-center rounded-xl border border-border/80 bg-muted/20 px-3 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-primary/20">
                <Calendar className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <select
                  value={dateValue}
                  onChange={e => handleScheduleChange(e.target.value, timeValue || "09:00")}
                  className="h-12 min-w-0 flex-1 appearance-none bg-transparent pr-7 text-sm font-medium outline-none"
                  aria-label="日付"
                >
                  <option value="">未設定</option>
                  {dateOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
            <label className="space-y-2">
              <span className="text-xs text-muted-foreground">時刻</span>
              <div className="relative flex min-h-[52px] items-center rounded-xl border border-border/80 bg-muted/20 px-3 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-primary/20">
                <Clock className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                <select
                  value={timeValue}
                  onChange={e => handleScheduleChange(dateValue, e.target.value)}
                  disabled={!dateValue}
                  className="h-12 min-w-0 flex-1 appearance-none bg-transparent pr-7 text-sm font-medium outline-none disabled:text-muted-foreground"
                  aria-label="時刻"
                >
                  <option value="">未設定</option>
                  {timeOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-muted-foreground" />
              </div>
            </label>
          </div>
          {suggestion.time_candidates.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">時間候補</p>
              <div className="grid gap-2">
                {suggestion.time_candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.scheduled_at}-${index}`}
                    onClick={() => {
                      setSelectedCandidateIndex(index)
                      update({
                        scheduled_at: candidate.scheduled_at,
                        date_input: formatDateValue(candidate.scheduled_at),
                        time_input: formatTimeInput(candidate.scheduled_at),
                        duration_minutes: candidate.duration_minutes,
                        memo_status: "time_candidates",
                      })
                    }}
                    className={cn(
                      "min-h-[44px] rounded-md border px-3 py-2 text-left text-sm",
                      selectedCandidateIndex === index && "border-primary bg-primary/10",
                    )}
                  >
                    <span className="font-medium">{formatCandidate(candidate)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{candidate.duration_minutes}分</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {suggestion.subtask_suggestions.length > 0 && (
            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">サブタスク候補 {suggestion.subtask_suggestions.length}件</summary>
              <div className="mt-2 space-y-2">
                {suggestion.subtask_suggestions.map(sub => (
                  <div key={sub.title} className="text-sm text-muted-foreground">
                    {sub.title} {sub.estimated_minutes ? `/${sub.estimated_minutes}分` : ""}
                  </div>
                ))}
              </div>
            </details>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={isSaving || !suggestion.title.trim()} onClick={() => onSave(selectedCandidate, false)} className="min-h-[44px]">
              {isSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
              {isSaving ? "保存中..." : "メモに保存"}
            </Button>
            <Button
              variant="outline"
              disabled={isSaving || !suggestion.title.trim() || !canCalendar}
              onClick={() => onSave(selectedCandidate, true)}
              className="min-h-[44px]"
            >
              <Calendar className="mr-1 h-4 w-4" /> カレンダーに入れる
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
