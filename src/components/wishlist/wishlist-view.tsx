"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react"
import {
  DragDropContext,
  Droppable,
  Draggable,
  useKeyboardSensor,
  useMouseSensor,
  type DragStart,
  type DropResult,
  type FluidDragActions,
  type PreDragActions,
  type Sensor,
  type SensorAPI,
} from "@hello-pangea/dnd"
import { LINKED_TASK_STATUS_EVENT, TODAY_DURATION_DEFAULT, WISHLIST_REFRESH_EVENT } from "@/lib/calendar-constants"
import { Calendar, Check, ChevronDown, Clock, Loader2, Mic, MoreHorizontal, Network, Plus, RefreshCw, Settings, Sparkles, Square, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { IdealGoalWithItems, Project, Space } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { cn } from "@/lib/utils"
import { colorToRgba, getTagColor } from "@/lib/color-utils"
import {
  appendCodexHandoffToken,
  beginCopyPromptForCodexHandoff,
  buildCodexOpenTarget,
  buildCodexHandoffToken,
  canUseLocalCodexOpenApi,
  copyPromptForCodexHandoff,
  type CodexPromptCopyAttempt,
  getCurrentMobilePlatform,
  isLikelyMobileDevice,
  launchCodexViaLocalApi,
  openCodexMobileTargetViaFocusmapNativeApp,
} from "@/lib/codex-app-launch"
import { buildImmediateMemoCodexPrompt, memoBodyForCodexExecution, type MemoCodexImageAttachment } from "@/lib/memo-codex-execution"
import { WishlistCard } from "./wishlist-card"
import { WishlistCardDetail } from "./wishlist-card-detail"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import { fetchWishlistItems, invalidateWishlistItemsCache } from "@/lib/wishlist-cache"
import { MemoToMindmapDialog } from "@/components/memo/memo-to-mindmap-dialog"
import { SpaceProjectSwitcher } from "@/components/dashboard/space-project-switcher"

type MemoStatus = "unsorted" | "organized" | "time_candidates" | "scheduled" | "completed"
type ColumnKey = "unsorted" | "mapped" | "today" | "scheduled" | "completed"
type MemoItem = IdealGoalWithItems & {
  mindmap_link_count?: number | null
  mindmap_linked_at?: string | null
  mindmap_task_ids?: string[] | null
}

type MemoAttachmentResponse = {
  attachments?: Array<MemoCodexImageAttachment & {
    id?: string
  }>
}

type LinkedStructuredItem = {
  id: string
  memoItemId: string
  sourceType: string
  sourceId: string
  title: string
  body: string | null
  actionType: "execution" | "research" | "decision"
  placementMode: string | null
}

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

const COLUMN_LABEL: Record<ColumnKey, string> = {
  unsorted: "未予定",
  mapped: "マップ追加済み",
  today: "今日する",
  scheduled: "予定済み",
  completed: "完了",
}

const MOBILE_COLUMN_ORDER: ColumnKey[] = ["unsorted", "today", "mapped", "scheduled", "completed"]
const SHOW_MEMO_TAG_FILTER_ENTRY = false
const SHOW_MEMO_MINDMAP_ENTRY = false
const POSTGRES_INTEGER_MIN = -2147483648
const POSTGRES_INTEGER_MAX = 2147483647
const CREATE_MEMO_TIMEOUT_MS = 15_000
const MEMO_TOUCH_DRAG_DELAY_MS = 420
const MEMO_TOUCH_SCROLL_CANCEL_PX = 10
const MEMO_HORIZONTAL_COLUMN_DRAG_PX = 76
const MEMO_COLUMN_AUTO_MOVE_HOLD_MS = 320
const MEMO_COLUMN_AUTO_MOVE_EDGE_PX = 72

type DragPoint = { x: number; y: number }
type MemoColumnDragState = {
  startPoint: DragPoint | null
  sourceColumn: ColumnKey | null
  autoTargetColumn: ColumnKey | null
}
type ColumnAutoMoveTimer = {
  target: ColumnKey
  timerId: ReturnType<typeof setTimeout>
}
type DelayedTouchPhase =
  | { type: "IDLE" }
  | { type: "PENDING"; actions: PreDragActions; point: DragPoint; timerId: number }
  | { type: "DRAGGING"; actions: FluidDragActions; hasMoved: boolean }

const idleTouchPhase: DelayedTouchPhase = { type: "IDLE" }

function getTouchPoint(event: TouchEvent): DragPoint | null {
  const touch = event.touches[0] ?? event.changedTouches[0]
  return touch ? { x: touch.clientX, y: touch.clientY } : null
}

function useDelayedMemoTouchSensor(api: SensorAPI) {
  const phaseRef = useRef<DelayedTouchPhase>(idleTouchPhase)
  const unbindRef = useRef<(() => void) | null>(null)

  const unbind = useCallback(() => {
    unbindRef.current?.()
    unbindRef.current = null
  }, [])

  const stop = useCallback(() => {
    const phase = phaseRef.current
    if (phase.type === "PENDING") {
      window.clearTimeout(phase.timerId)
    }
    phaseRef.current = idleTouchPhase
    unbind()
  }, [unbind])

  const cancel = useCallback(() => {
    const phase = phaseRef.current
    if (phase.type === "PENDING") phase.actions.abort()
    if (phase.type === "DRAGGING") phase.actions.cancel({ shouldBlockNextClick: true })
    stop()
  }, [stop])

  const startDragging = useCallback((actions: PreDragActions, point: DragPoint) => {
    const dragActions = actions.fluidLift(point)
    phaseRef.current = { type: "DRAGGING", actions: dragActions, hasMoved: false }
  }, [])

  const bindMoveEvents = useCallback(() => {
    const onTouchMove = (event: TouchEvent) => {
      const phase = phaseRef.current
      const point = getTouchPoint(event)
      if (!point || phase.type === "IDLE") return

      if (phase.type === "PENDING") {
        const dx = Math.abs(point.x - phase.point.x)
        const dy = Math.abs(point.y - phase.point.y)
        if (Math.max(dx, dy) >= MEMO_TOUCH_SCROLL_CANCEL_PX) {
          phase.actions.abort()
          stop()
        }
        return
      }

      event.preventDefault()
      phase.hasMoved = true
      phase.actions.move(point)
    }

    const onTouchEnd = (event: TouchEvent) => {
      const phase = phaseRef.current
      if (phase.type === "PENDING") {
        phase.actions.abort()
        stop()
        return
      }
      if (phase.type !== "DRAGGING") return

      event.preventDefault()
      phase.actions.drop({ shouldBlockNextClick: true })
      stop()
    }

    const onTouchCancel = (event: TouchEvent) => {
      if (phaseRef.current.type === "DRAGGING") event.preventDefault()
      cancel()
    }

    const onContextMenu = (event: Event) => {
      if (phaseRef.current.type !== "IDLE") event.preventDefault()
    }

    window.addEventListener("touchmove", onTouchMove, { passive: false })
    window.addEventListener("touchend", onTouchEnd, { passive: false })
    window.addEventListener("touchcancel", onTouchCancel, { passive: false })
    window.addEventListener("contextmenu", onContextMenu)

    unbindRef.current = () => {
      window.removeEventListener("touchmove", onTouchMove)
      window.removeEventListener("touchend", onTouchEnd)
      window.removeEventListener("touchcancel", onTouchCancel)
      window.removeEventListener("contextmenu", onContextMenu)
    }
  }, [cancel, stop])

  useEffect(() => {
    const onTouchStart = (event: TouchEvent) => {
      if (event.defaultPrevented || event.touches.length !== 1 || phaseRef.current.type !== "IDLE") return

      const draggableId = api.findClosestDraggableId(event)
      if (!draggableId) return

      const actions = api.tryGetLock(draggableId, cancel, { sourceEvent: event })
      if (!actions) return

      const point = getTouchPoint(event)
      if (!point) {
        actions.abort()
        return
      }

      unbind()
      const timerId = window.setTimeout(() => {
        const phase = phaseRef.current
        if (phase.type !== "PENDING") return
        startDragging(phase.actions, phase.point)
      }, MEMO_TOUCH_DRAG_DELAY_MS)

      phaseRef.current = { type: "PENDING", actions, point, timerId }
      bindMoveEvents()
    }

    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: false })
    return () => {
      window.removeEventListener("touchstart", onTouchStart, { capture: true })
      cancel()
    }
  }, [api, bindMoveEvents, cancel, startDragging, unbind])
}

function isPostgresInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= POSTGRES_INTEGER_MIN &&
    value <= POSTGRES_INTEGER_MAX
  )
}

function createClientMemoId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    const digit = char === "x" ? value : (value & 0x3) | 0x8
    return digit.toString(16)
  })
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toLinkedStructuredItem(raw: unknown): LinkedStructuredItem | null {
  const link = readRecord(raw)
  const memoItemRaw = Array.isArray(link.memo_items) ? link.memo_items[0] : link.memo_items
  const memoItem = readRecord(memoItemRaw)
  const metadata = readRecord(memoItem.metadata)
  const linkMetadata = readRecord(link.metadata)
  const id = typeof link.id === "string" ? link.id : ""
  const memoItemId = typeof memoItem.id === "string" ? memoItem.id : ""
  const title = typeof memoItem.title === "string" ? memoItem.title : ""
  if (!id || !memoItemId || !title) return null
  const actionType = metadata.action_type === "research" || metadata.action_type === "decision" || metadata.action_type === "execution"
    ? metadata.action_type
    : memoItem.item_kind === "reference"
      ? "research"
      : memoItem.item_kind === "decision"
        ? "decision"
        : "execution"
  return {
    id,
    memoItemId,
    sourceType: typeof memoItem.source_type === "string" ? memoItem.source_type : "",
    sourceId: typeof memoItem.source_id === "string" ? memoItem.source_id : "",
    title,
    body: typeof memoItem.body === "string" ? memoItem.body : null,
    actionType,
    placementMode: typeof linkMetadata.placement_mode === "string" ? linkMetadata.placement_mode : null,
  }
}

function actionLabel(actionType: LinkedStructuredItem["actionType"]) {
  if (actionType === "research") return "リサーチ"
  if (actionType === "decision") return "判断"
  return "実行"
}

function extractMindmapTaskIds(item: MemoItem | null | undefined): string[] {
  const payload = readRecord(item?.ai_source_payload)
  const links = Array.isArray(payload.mindmap_links) ? payload.mindmap_links : []
  return Array.from(new Set(
    [
      ...(Array.isArray(item?.mindmap_task_ids) ? item.mindmap_task_ids : []),
      ...links
      .map(link => readRecord(link).task_id)
      .filter((taskId): taskId is string => typeof taskId === "string" && taskId.length > 0),
    ]
  ))
}

function hasMindmapLinks(item: MemoItem | null | undefined): boolean {
  return (item?.mindmap_link_count ?? 0) > 0 || extractMindmapTaskIds(item).length > 0
}

function getManualColumn(item: MemoItem | null | undefined): ColumnKey | null {
  const payload = readRecord(item?.ai_source_payload)
  const column = payload.manual_column
  return column === "mapped" || column === "today" || column === "scheduled" || column === "completed" || column === "unsorted"
    ? column
    : null
}

function withManualColumnPayload(payload: unknown, column: ColumnKey) {
  return {
    ...readRecord(payload),
    manual_column: column,
    manual_column_assigned_at: new Date().toISOString(),
  }
}

function getMobileColumnCreateOverrides(column: ColumnKey, payload?: unknown): Record<string, unknown> {
  if (column === "today") {
    return {
      memo_status: "unsorted",
      is_today: true,
      is_completed: false,
      scheduled_at: null,
      google_event_id: null,
    }
  }
  if (column === "scheduled") {
    return {
      memo_status: "scheduled",
      is_today: false,
      is_completed: false,
      google_event_id: null,
      ai_source_payload: withManualColumnPayload(payload, column),
    }
  }
  if (column === "mapped") {
    return {
      memo_status: "organized",
      is_today: false,
      is_completed: false,
      scheduled_at: null,
      google_event_id: null,
      ai_source_payload: withManualColumnPayload(payload, column),
    }
  }
  if (column === "completed") {
    return {
      memo_status: "completed",
      is_today: false,
      is_completed: true,
      scheduled_at: null,
      google_event_id: null,
    }
  }
  return {
    memo_status: "unsorted",
    is_today: false,
    is_completed: false,
    scheduled_at: null,
    google_event_id: null,
  }
}

function buildOptimisticMemoItem({
  id,
  title,
  projectId,
  description,
  overrides,
}: {
  id: string
  title: string
  projectId?: string | null
  description: string
  overrides: Record<string, unknown>
}): MemoItem {
  const now = new Date().toISOString()
  const memoStatus = typeof overrides.memo_status === "string" ? overrides.memo_status : "unsorted"
  return {
    id,
    user_id: "local",
    title,
    project_id: projectId ?? null,
    description: description || null,
    cover_image_url: null,
    cover_image_path: null,
    category: null,
    color: "#6366f1",
    status: "memo",
    display_order: 0,
    duration_months: null,
    start_date: null,
    target_date: null,
    total_daily_minutes: 0,
    cost_total: null,
    cost_monthly: null,
    ai_summary: null,
    scheduled_at: typeof overrides.scheduled_at === "string" ? overrides.scheduled_at : null,
    duration_minutes: typeof overrides.duration_minutes === "number" ? overrides.duration_minutes : null,
    google_event_id: typeof overrides.google_event_id === "string" ? overrides.google_event_id : null,
    is_completed: typeof overrides.is_completed === "boolean" ? overrides.is_completed : false,
    is_today: typeof overrides.is_today === "boolean" ? overrides.is_today : false,
    tags: [],
    memo_status: memoStatus,
    ai_source_payload: overrides.ai_source_payload ?? null,
    created_at: now,
    updated_at: now,
    ideal_items: [],
  } as MemoItem
}

function getCompletionUpdate(updates: Record<string, unknown>): boolean | null {
  if (typeof updates.is_completed === "boolean") return updates.is_completed
  if (updates.memo_status === "completed") return true
  if (updates.memo_status === "unsorted" || updates.memo_status === "organized" || updates.memo_status === "scheduled" || updates.memo_status === "time_candidates") {
    return false
  }
  return null
}

function getMemoStatusForTaskStatus(item: MemoItem, taskStatus: string): MemoStatus {
  if (taskStatus === "done") return "completed"
  if (item.google_event_id || item.scheduled_at || item.memo_status === "scheduled") return "scheduled"
  return "organized"
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
  if (hasMindmapLinks(item) || getManualColumn(item) === "mapped") return "mapped"
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
    if (section === "mapped") {
      return getTimestamp(b.mindmap_linked_at) - getTimestamp(a.mindmap_linked_at)
        || getTimestamp(b.updated_at) - getTimestamp(a.updated_at)
        || getTimestamp(b.created_at) - getTimestamp(a.created_at)
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
  const payload = buildMemoUpdatePayload(item)
  if (item.user_id === "local" || !isPostgresInteger(payload.display_order)) {
    delete payload.display_order
  }

  return {
    ...payload,
    id: item.id,
    created_at: item.created_at,
    updated_at: item.updated_at,
    ideal_items: item.ideal_items ?? [],
  }
}

function deriveDraftMemoTitle(description: string) {
  return description
    .replace(/\s+/g, " ")
    .split(/[。.!！?？\n]/)
    .find(part => part.trim().length > 0)
    ?.trim()
    .slice(0, 80) || "無題"
}

function hasPersistableDraftMemoContent(item: MemoItem) {
  return Boolean(
    item.title.trim() ||
    item.description?.trim() ||
    item.category?.trim() ||
    (item.tags ?? []).some(tag => tag.trim()) ||
    item.scheduled_at ||
    item.google_event_id ||
    item.cover_image_url ||
    item.cover_image_path,
  )
}

function normalizeDraftMemoForCreate(item: MemoItem, force = false): MemoItem | null {
  const description = item.description?.trim() ?? ""
  const title = item.title.trim() || (description ? deriveDraftMemoTitle(description) : "")
  if (!force && !hasPersistableDraftMemoContent({ ...item, title, description })) return null
  return {
    ...item,
    title: title || "無題",
    description: description || null,
    category: item.category?.trim() || null,
    tags: Array.from(new Set((item.tags ?? []).map(tag => tag.trim()).filter(Boolean))),
  }
}

function isRetryableRequestError(error: unknown) {
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError") return true
  return /Failed to fetch|NetworkError|Load failed/i.test(error.message)
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function createWishlistMemo(payload: Record<string, unknown>) {
  const maxRetries = 2
  const baseDelayMs = 300
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      const res = await fetchWithTimeout("/api/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }, CREATE_MEMO_TIMEOUT_MS)
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

export function WishlistView({
  projects = [],
  spaces = [],
  selectedProjectId = null,
  selectedSpaceId = null,
  onOpenTodayMemoSchedule,
  isCalendarSplitVisible = false,
  onSelectSpace,
  onSelectProject,
  onProjectCreated,
  onProjectSaved,
  onProjectDeleted,
  onSpaceSaved,
  compactComposer = false,
  mindmapMemoFocus = null,
  onLinkedTaskStatusChange,
  onMindmapUpdated,
}: {
  projects?: Project[]
  spaces?: Space[]
  selectedProjectId?: string | null
  selectedSpaceId?: string | null
  onOpenTodayMemoSchedule?: (payload: { memoId: string; date: Date }) => void
  isCalendarSplitVisible?: boolean
  onToggleCalendarSplit?: () => void
  onSelectSpace?: (id: string | null) => void
  onSelectProject?: (id: string | null) => void
  onProjectCreated?: (project: Project) => void
  onProjectSaved?: (project: Project) => void
  onProjectDeleted?: (projectId: string) => void | Promise<void>
  onSpaceSaved?: (space: Space) => void
  compactComposer?: boolean
  mindmapMemoFocus?: { taskId: string; requestKey: number } | null
  onLinkedTaskStatusChange?: (taskId: string, status: string) => Promise<void> | void
  onMindmapUpdated?: () => Promise<void> | void
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
  const [selectedAiModel, setSelectedAiModel] = useState("gemini-3-flash-preview")
  const [suggestion, setSuggestion] = useState<MemoSuggestion | null>(null)
  const [suggestionOpen, setSuggestionOpen] = useState(false)
  const [isSavingSuggestion, setIsSavingSuggestion] = useState(false)
  const [tagFilter, setTagFilter] = useState<string | "all">("all")
  const [todayRemovalDialog, setTodayRemovalDialog] = useState<TodayRemovalDialogState | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedMemoIds, setSelectedMemoIds] = useState<Set<string>>(new Set())
  const [showMindmapDialog, setShowMindmapDialog] = useState(false)
  const [activeMobileColumn, setActiveMobileColumn] = useState<ColumnKey>("unsorted")
  const [isMobileMemoLayout, setIsMobileMemoLayout] = useState(false)
  const [linkedMemoFocus, setLinkedMemoFocus] = useState<{
    taskId: string
    taskTitle: string
    items: MemoItem[]
    structuredItems: LinkedStructuredItem[]
    isLoading: boolean
    error: string | null
  } | null>(null)
  const mobileColumnsRef = useRef<HTMLDivElement>(null)
  const latestDragPointRef = useRef<DragPoint | null>(null)
  const pointerStartPointRef = useRef<DragPoint | null>(null)
  const memoColumnDragRef = useRef<MemoColumnDragState | null>(null)
  const columnAutoMoveTimerRef = useRef<ColumnAutoMoveTimer | null>(null)
  const itemSaveQueues = useRef(new Map<string, Promise<void>>())
  const itemUpdateVersions = useRef(new Map<string, number>())
  const creatingMemoIdsRef = useRef(new Set<string>())
  const creatingMemoPromisesRef = useRef(new Map<string, Promise<void>>())
  const pendingCreateUpdatesRef = useRef(new Map<string, Record<string, unknown>>())
  const { tags: managedTags, tagColors, refreshTags } = useTagColors()
  const { calendars } = useCalendars()
  const { refresh: refreshMemoAiTasks } = useMemoAiTasks()
  const { pushAction } = useUndoRedo()
  const memoDndSensors = useMemo<Sensor[]>(() => [useMouseSensor, useKeyboardSensor, useDelayedMemoTouchSensor], [])

  const openCodexHandoff = useCallback(async (
    prompt: string,
    repoPath: string | null,
    copyAttempt?: CodexPromptCopyAttempt,
    clipboardImageUrl?: string | null,
  ) => {
    const preferMobile = isLikelyMobileDevice()
    if (canUseLocalCodexOpenApi() && !preferMobile) {
      try {
        await launchCodexViaLocalApi({ prompt, repoPath, originUrl: window.location.href, clipboardImageUrl })
        return
      } catch (error) {
        console.warn('[wishlist] local Codex open failed, falling back to browser handoff:', error)
      }
    }

    const activeCopyAttempt = copyAttempt ?? beginCopyPromptForCodexHandoff(prompt)
    const target = buildCodexOpenTarget(
      { prompt, repoPath, originUrl: window.location.href },
      { preferMobile, mobilePlatform: getCurrentMobilePlatform() },
    )
    const openedViaNativeApp = openCodexMobileTargetViaFocusmapNativeApp(
      target.url,
      prompt,
      "urls" in target ? target.urls : undefined,
      clipboardImageUrl,
    )
    if (!openedViaNativeApp) {
      window.location.href = target.url
    }
    const copied = await activeCopyAttempt.finished
    if (!copied && !openedViaNativeApp) {
      throw new Error("クリップボードコピー失敗。Codex側でメモ本文を手動貼り付けしてください")
    }
  }, [])

  const loadMemoCodexImages = useCallback(async (memoId: string): Promise<MemoCodexImageAttachment[]> => {
    try {
      const res = await fetch(`/api/wishlist/${memoId}/attachments`, { cache: "no-store" })
      const data = await res.json().catch(() => ({})) as MemoAttachmentResponse
      if (!res.ok || !Array.isArray(data.attachments)) return []
      return data.attachments
        .filter(attachment => attachment.file_type?.startsWith("image/") && attachment.file_url?.trim())
        .map(attachment => ({
          file_name: attachment.file_name,
          file_url: attachment.file_url,
          file_type: attachment.file_type,
          file_size: attachment.file_size,
        }))
    } catch {
      return []
    }
  }, [])

  const buildMemoCodexHandoffContent = useCallback(async (item: MemoItem) => {
    const images = await loadMemoCodexImages(item.id)
    return {
      prompt: buildImmediateMemoCodexPrompt(
        memoBodyForCodexExecution({ title: item.title, body: item.description }),
        images,
      ),
      clipboardImageUrl: images[0]?.file_url?.trim() || null,
    }
  }, [loadMemoCodexImages])

  // メモから AI エージェント（Claude / Codex）を起動
  // Codex の標準導線は manual handoff。Focusmap は追跡 task を作り、
  // prompt のコピーと Codex 起動だけを補助し、最終送信は Codex 側で人間が行う。
  const launchAiForMemo = useCallback(async (item: MemoItem, executor: 'claude' | 'codex' | 'codex_app' = 'claude') => {
    const project = item.project_id ? projects.find(p => p.id === item.project_id) : null
    const repoPath = project?.repo_path
    const isCodexManualHandoff = executor === 'codex' || executor === 'codex_app'
    if (!repoPath && executor === 'claude') {
      throw new Error("プロジェクトにリポジトリパスが未設定です。設定→プロジェクトから登録してください")
    }

    const handoffContent = isCodexManualHandoff ? await buildMemoCodexHandoffContent(item) : null
    const basePrompt = isCodexManualHandoff
      ? handoffContent?.prompt || memoBodyForCodexExecution({ title: item.title, body: item.description })
      : item.description?.trim() || item.title
    const scheduleExecutor = isCodexManualHandoff ? 'codex_app' : executor
    const handoffToken = isCodexManualHandoff ? buildCodexHandoffToken(item.id) : undefined
    const prompt = isCodexManualHandoff
      ? appendCodexHandoffToken(basePrompt, handoffToken)
      : basePrompt
    const copyAttempt = isCodexManualHandoff ? beginCopyPromptForCodexHandoff(prompt) : null

    const registerTask = async () => {
      const res = await fetch("/api/ai-tasks/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: prompt.length < 50_000,
        body: JSON.stringify({
          prompt,
          cwd: repoPath ?? null,
          approval_type: "auto",
          source_ideal_goal_id: item.id,
          scheduled_at: new Date().toISOString(),
          executor: scheduleExecutor,
          dispatch_mode: isCodexManualHandoff ? "manual" : "auto",
          codex_handoff_token: handoffToken,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `起動失敗 (${res.status})`)
      }
      await refreshMemoAiTasks()
    }

    if (isCodexManualHandoff) {
      const preferMobile = isLikelyMobileDevice()
      const registerTaskPromise = registerTask()
      if (preferMobile) {
        registerTaskPromise.catch(() => undefined)
        await openCodexHandoff(prompt, repoPath ?? null, copyAttempt ?? undefined, handoffContent?.clipboardImageUrl ?? null)
        await registerTaskPromise
        return
      }
      await registerTaskPromise
      await openCodexHandoff(prompt, repoPath ?? null, copyAttempt ?? undefined, handoffContent?.clipboardImageUrl ?? null)
      return
    }

    await registerTask()
  }, [buildMemoCodexHandoffContent, openCodexHandoff, projects, refreshMemoAiTasks])

  const launchCodexForMemo = useCallback((item: MemoItem) => launchAiForMemo(item, 'codex'), [launchAiForMemo])

  const copyCodexPromptForMemo = useCallback(async (item: MemoItem) => {
    const { prompt: text } = await buildMemoCodexHandoffContent(item)
    const copied = await copyPromptForCodexHandoff(text)
    if (copied) return
    throw new Error("クリップボードコピー失敗。手動でコピーしてください")
  }, [buildMemoCodexHandoffContent])

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
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 767px)")
    const update = () => setIsMobileMemoLayout(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    const setTouchPoint = (event: TouchEvent) => {
      const point = getTouchPoint(event)
      if (!point) return
      latestDragPointRef.current = point
    }
    const setTouchStartPoint = (event: TouchEvent) => {
      const point = getTouchPoint(event)
      if (!point) return
      pointerStartPointRef.current = point
      latestDragPointRef.current = point
    }
    const setMousePoint = (event: MouseEvent) => {
      latestDragPointRef.current = { x: event.clientX, y: event.clientY }
    }
    const setMouseStartPoint = (event: MouseEvent) => {
      const point = { x: event.clientX, y: event.clientY }
      pointerStartPointRef.current = point
      latestDragPointRef.current = point
    }

    window.addEventListener("touchstart", setTouchStartPoint, { capture: true, passive: true })
    window.addEventListener("touchmove", setTouchPoint, { capture: true, passive: true })
    window.addEventListener("touchend", setTouchPoint, { capture: true, passive: true })
    window.addEventListener("mousedown", setMouseStartPoint, { capture: true })
    window.addEventListener("mousemove", setMousePoint, { capture: true })
    window.addEventListener("mouseup", setMousePoint, { capture: true })
    return () => {
      window.removeEventListener("touchstart", setTouchStartPoint, { capture: true })
      window.removeEventListener("touchmove", setTouchPoint, { capture: true })
      window.removeEventListener("touchend", setTouchPoint, { capture: true })
      window.removeEventListener("mousedown", setMouseStartPoint, { capture: true })
      window.removeEventListener("mousemove", setMousePoint, { capture: true })
      window.removeEventListener("mouseup", setMousePoint, { capture: true })
    }
  }, [])

  const handleMobileColumnsScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    if (target.clientWidth <= 0) return
    const index = Math.max(
      0,
      Math.min(MOBILE_COLUMN_ORDER.length - 1, Math.round(target.scrollLeft / target.clientWidth)),
    )
    const column = MOBILE_COLUMN_ORDER[index]
    if (column) setActiveMobileColumn(column)
  }, [])

  const scrollToMobileColumn = useCallback((column: ColumnKey) => {
    setActiveMobileColumn(column)
    const index = MOBILE_COLUMN_ORDER.indexOf(column)
    const target = mobileColumnsRef.current
    if (!target || index < 0) return
    const left = target.clientWidth * index
    if (typeof target.scrollTo === "function") {
      target.scrollTo({ left, behavior: "smooth" })
    } else {
      target.scrollLeft = left
    }
  }, [])

  const clearColumnAutoMoveTimer = useCallback(() => {
    const timer = columnAutoMoveTimerRef.current
    if (!timer) return
    window.clearTimeout(timer.timerId)
    columnAutoMoveTimerRef.current = null
  }, [])

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

  const fetchItems = useCallback(async (options?: { force?: boolean }) => {
    const nextItems = await fetchWishlistItems({
      spaceId: selectedSpaceId,
      projectId: selectedProjectId,
      force: options?.force,
    })
    setItems(nextItems)
  }, [selectedProjectId, selectedSpaceId])

  useEffect(() => {
    fetchItems().finally(() => setIsLoading(false))
  }, [fetchItems])

  // 他画面（Today タブ / カレンダー削除）からの更新通知で再取得
  useEffect(() => {
    const handler = () => { void fetchItems({ force: true }) }
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
          : "gemini-3-flash-preview"
        setSelectedAiModel(
          savedModel === "gemini-3.0-flash" || savedModel === "gemini-3.1-flash-lite" || savedModel === "gemini-3.5-flash"
            ? "gemini-3-flash-preview"
            : savedModel,
        )
      } catch {
        setSelectedAiModel("gemini-3-flash-preview")
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
      if (tagFilter !== "all" && item.category !== tagFilter && !(item.tags ?? []).includes(tagFilter)) return false
      return true
    })
  }, [items, linkedMemoIds, selectedProjectId, tagFilter])

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

  const mappedItems = useMemo(() => {
    return sortMemoItemsForSection(
      filteredItems.filter(item => getColumn(item, todayRange.start, todayRange.end) === "mapped"),
      "mapped",
    )
  }, [filteredItems, todayRange])

  const completedItems = useMemo(() => {
    return sortMemoItemsForSection(
      filteredItems.filter(item => getColumn(item, todayRange.start, todayRange.end) === "completed"),
      "completed",
    )
  }, [filteredItems, todayRange])

  const mobileSections = useMemo(() => ({
    unsorted: {
      columnKey: "unsorted" as const,
      title: COLUMN_LABEL.unsorted,
      count: unscheduledItems.length,
      items: unscheduledItems,
      emptyText: "未予定のメモはありません",
    },
    today: {
      columnKey: "today" as const,
      title: COLUMN_LABEL.today,
      count: todayItems.length,
      items: todayItems,
      emptyText: "今日するメモはありません",
    },
    scheduled: {
      columnKey: "scheduled" as const,
      title: COLUMN_LABEL.scheduled,
      count: scheduledItems.length,
      items: scheduledItems,
      emptyText: "予定済みのメモはありません",
    },
    mapped: {
      columnKey: "mapped" as const,
      title: COLUMN_LABEL.mapped,
      count: mappedItems.length,
      items: mappedItems,
      emptyText: "マップ追加済みのメモはありません",
    },
    completed: {
      columnKey: "completed" as const,
      title: COLUMN_LABEL.completed,
      count: completedItems.length,
      items: completedItems,
      emptyText: "完了したメモはありません",
    },
  }), [completedItems, mappedItems, scheduledItems, todayItems, unscheduledItems])

  const selectedMemosProjectId = useMemo(() => {
    const ids = new Set(
      items
        .filter(item => selectedMemoIds.has(item.id))
        .map(item => item.project_id)
        .filter((projectId): projectId is string => !!projectId),
    )
    const selectedItemsCount = items.filter(item => selectedMemoIds.has(item.id)).length
    return ids.size === 1 && selectedItemsCount === selectedMemoIds.size ? [...ids][0] : null
  }, [items, selectedMemoIds])

  const visibleMemoIds = useMemo(() => filteredItems.map(item => item.id), [filteredItems])

  const toggleMemoSelection = useCallback((memoId: string) => {
    setSelectedMemoIds(prev => {
      const next = new Set(prev)
      if (next.has(memoId)) next.delete(memoId)
      else next.add(memoId)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedMemoIds(new Set())
  }, [])

  const toggleSelectVisibleMemos = useCallback(() => {
    setSelectedMemoIds(prev => {
      const visibleSet = new Set(visibleMemoIds)
      const allVisibleSelected = visibleMemoIds.length > 0 && visibleMemoIds.every(id => prev.has(id))
      if (allVisibleSelected) {
        const next = new Set(prev)
        for (const id of visibleSet) next.delete(id)
        return next
      }
      return new Set([...prev, ...visibleMemoIds])
    })
  }, [visibleMemoIds])

  useEffect(() => {
    setSelectedMemoIds(prev => {
      if (prev.size === 0) return prev
      const existingIds = new Set(items.map(item => item.id))
      const next = new Set([...prev].filter(id => existingIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [items])

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

  const setMemoCreating = useCallback((id: string, creating: boolean) => {
    if (creating) {
      creatingMemoIdsRef.current.add(id)
    } else {
      creatingMemoIdsRef.current.delete(id)
    }
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
    invalidateWishlistItemsCache()
    return data.item as MemoItem
  }, [])

  const createDraftMemoIfNeeded = useCallback(async (draftItem: MemoItem, options: { force?: boolean } = {}) => {
    const existingCreate = creatingMemoPromisesRef.current.get(draftItem.id)
    if (existingCreate) {
      await existingCreate
      return
    }

    const itemToCreate = normalizeDraftMemoForCreate(draftItem, options.force ?? false)
    if (!itemToCreate) return

    const pendingUpdates = pendingCreateUpdatesRef.current.get(draftItem.id) ?? {}
    pendingCreateUpdatesRef.current.set(draftItem.id, {
      ...pendingUpdates,
      title: itemToCreate.title,
      description: itemToCreate.description,
      category: itemToCreate.category,
      tags: itemToCreate.tags,
    })

    const createRequest = createWishlistMemo(buildMemoCreatePayload(itemToCreate))
    const trackedCreateRequest = createRequest.then(() => undefined)
    void trackedCreateRequest.catch(() => undefined)
    creatingMemoPromisesRef.current.set(draftItem.id, trackedCreateRequest)

    try {
      const item = await createRequest
      const updatesAfterCreate = pendingCreateUpdatesRef.current.get(draftItem.id) ?? null
      pendingCreateUpdatesRef.current.delete(draftItem.id)
      const nextItem = updatesAfterCreate
        ? { ...item, ...updatesAfterCreate, updated_at: new Date().toISOString() } as MemoItem
        : item
      invalidateWishlistItemsCache()
      setItems(prev => prev.map(existing => existing.id === draftItem.id ? nextItem : existing))
      setSelectedItem(prev => prev?.id === draftItem.id ? nextItem : prev)
      setMemoCreating(draftItem.id, false)

      if (updatesAfterCreate && Object.keys(updatesAfterCreate).length > 0) {
        try {
          const patched = await patchMemoItem(draftItem.id, updatesAfterCreate)
          setItems(prev => prev.map(existing => existing.id === draftItem.id ? patched : existing))
          setSelectedItem(prev => prev?.id === draftItem.id ? patched : prev)
        } catch (err) {
          setIntakeError(err instanceof Error ? err.message : "メモの更新に失敗しました")
        }
      }

      await refreshTags()
    } catch (err) {
      pendingCreateUpdatesRef.current.delete(draftItem.id)
      setMemoCreating(draftItem.id, false)
      setItems(prev => prev.filter(existing => existing.id !== draftItem.id))
      setSelectedItem(prev => prev?.id === draftItem.id ? null : prev)
      setDetailOpen(false)
      setIntakeError(err instanceof Error ? err.message : "メモの作成に失敗しました")
    } finally {
      creatingMemoPromisesRef.current.delete(draftItem.id)
    }
  }, [patchMemoItem, refreshTags, setMemoCreating])

  const waitForMemoPersistence = useCallback(async (id: string) => {
    const pendingCreate = creatingMemoPromisesRef.current.get(id)
    if (pendingCreate) {
      await pendingCreate
      return
    }
    if (!creatingMemoIdsRef.current.has(id)) return
    const draftItem = selectedItem?.id === id ? selectedItem : items.find(item => item.id === id) ?? null
    if (draftItem) await createDraftMemoIfNeeded(draftItem, { force: true })
  }, [createDraftMemoIfNeeded, items, selectedItem])

  const getLinkedTaskIdsForMemo = useCallback((item: MemoItem | null) => {
    if (!item) return []
    const taskIds = new Set(extractMindmapTaskIds(item))
    if (linkedMemoFocus) {
      const isFocusedSource =
        linkedMemoFocus.items.some(linkedItem => linkedItem.id === item.id) ||
        linkedMemoFocus.structuredItems.some(structuredItem => structuredItem.sourceId === item.id)
      if (isFocusedSource) taskIds.add(linkedMemoFocus.taskId)
    }
    return Array.from(taskIds)
  }, [linkedMemoFocus])

  const syncLinkedTaskCompletion = useCallback(async (item: MemoItem | null, isCompleted: boolean) => {
    if (!onLinkedTaskStatusChange) return
    const taskIds = getLinkedTaskIdsForMemo(item)
    if (taskIds.length === 0) return
    const status = isCompleted ? "done" : "todo"
    await Promise.all(taskIds.map(taskId => onLinkedTaskStatusChange(taskId, status)))
  }, [getLinkedTaskIdsForMemo, onLinkedTaskStatusChange])

  useEffect(() => {
    const handleLinkedTaskStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: unknown; status?: unknown }>).detail
      const taskId = typeof detail?.taskId === "string" ? detail.taskId : ""
      const status = typeof detail?.status === "string" ? detail.status : ""
      if (!taskId || !status) return

      const focusedSourceIds = new Set<string>()
      if (linkedMemoFocus?.taskId === taskId) {
        for (const item of linkedMemoFocus.items) focusedSourceIds.add(item.id)
        for (const item of linkedMemoFocus.structuredItems) focusedSourceIds.add(item.sourceId)
      }

      const shouldUpdateItem = (item: MemoItem) =>
        extractMindmapTaskIds(item).includes(taskId) || focusedSourceIds.has(item.id)

      const applyTaskStatus = (item: MemoItem): MemoItem => {
        if (!shouldUpdateItem(item)) return item
        const isCompleted = status === "done"
        return {
          ...item,
          is_completed: isCompleted,
          memo_status: getMemoStatusForTaskStatus(item, status),
          ...(isCompleted ? { is_today: false } : {}),
          updated_at: new Date().toISOString(),
        }
      }

      setItems(prev => prev.map(applyTaskStatus))
      setSelectedItem(prev => prev ? applyTaskStatus(prev) : prev)
      setLinkedMemoFocus(prev => prev ? {
        ...prev,
        items: prev.items.map(applyTaskStatus),
      } : prev)
    }

    window.addEventListener(LINKED_TASK_STATUS_EVENT, handleLinkedTaskStatus)
    return () => window.removeEventListener(LINKED_TASK_STATUS_EVENT, handleLinkedTaskStatus)
  }, [linkedMemoFocus])

  const restoreMemoItem = useCallback(async (item: MemoItem) => {
    const itemFromServer = await createWishlistMemo(buildMemoCreatePayload(item))
    invalidateWishlistItemsCache()
    return itemFromServer
  }, [])

  const removeMemoItemFromServer = useCallback(async (id: string) => {
    const res = await fetch(`/api/wishlist/${id}`, { method: "DELETE" })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.error || "メモの削除に失敗しました")
    }
    invalidateWishlistItemsCache()
  }, [])

  const handleUpdate = useCallback(async (id: string, updates: Record<string, unknown>) => {
    if (Object.keys(updates).length > 0) {
      if (creatingMemoIdsRef.current.has(id)) {
        const currentPending = pendingCreateUpdatesRef.current.get(id) ?? {}
        pendingCreateUpdatesRef.current.set(id, { ...currentPending, ...updates })
        const optimisticUpdate = (item: MemoItem): MemoItem => ({
          ...item,
          ...updates,
          updated_at: new Date().toISOString(),
        })
        const currentDraft = selectedItem?.id === id ? selectedItem : items.find(item => item.id === id) ?? null
        const nextDraft = currentDraft ? optimisticUpdate(currentDraft) : null
        setItems(prev => prev.map(existing => existing.id === id ? optimisticUpdate(existing) : existing))
        setSelectedItem(prev => prev?.id === id ? optimisticUpdate(prev) : prev)
        setIntakeError(null)
        if (nextDraft) {
          await createDraftMemoIfNeeded(nextDraft)
        }
        return
      }

      const previousItem = items.find(item => item.id === id) ?? null
      const updateVersion = (itemUpdateVersions.current.get(id) ?? 0) + 1
      itemUpdateVersions.current.set(id, updateVersion)
      const isLatestUpdate = () => itemUpdateVersions.current.get(id) === updateVersion
      const previousItems = items
      const previousSelectedItem = selectedItem
      const completionUpdate = getCompletionUpdate(updates)
      const previousCompletion = previousItem ? (previousItem.is_completed || previousItem.memo_status === "completed") : null
      const optimisticUpdate = (item: MemoItem): MemoItem => ({
        ...item,
        ...updates,
        updated_at: new Date().toISOString(),
      })
      setItems(prev => prev.map(existing => existing.id === id ? optimisticUpdate(existing) : existing))
      setSelectedItem(prev => prev?.id === id ? optimisticUpdate(prev) : prev)
      setIntakeError(null)
      const linkedTaskSync = completionUpdate !== null && previousItem
        ? syncLinkedTaskCompletion(previousItem, completionUpdate)
        : Promise.resolve()
      await enqueueItemSave(id, async () => {
        try {
          const item = await patchMemoItem(id, updates)
          await linkedTaskSync
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
          if (completionUpdate !== null && previousItem && previousCompletion !== null) {
            void syncLinkedTaskCompletion(previousItem, previousCompletion)
          }
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
  }, [createDraftMemoIfNeeded, enqueueItemSave, fetchItems, items, patchMemoItem, pushAction, refreshTags, selectedItem, syncLinkedTaskCompletion])

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
    const mobileColumnOverrides = isMobileMemoLayout
      ? getMobileColumnCreateOverrides(activeMobileColumn)
      : {}
    const draftItem = buildOptimisticMemoItem({
      id: createClientMemoId(),
      title: "",
      projectId: selectedProjectId,
      description: "",
      overrides: mobileColumnOverrides,
    })
    setMemoCreating(draftItem.id, true)
    invalidateWishlistItemsCache()
    setItems(prev => [draftItem, ...prev])
    setSelectedItem(draftItem)
    setTagFilter("all")
    setDetailOpen(true)
  }

  const handleQuickAdd = async () => {
    const text = intakeText.trim()
    if (!text || isAnalyzing || isTranscribing) return
    const [firstLine, ...rest] = text.split("\n")
    const title = firstLine.trim().slice(0, 80) || "新しいメモ"
    const description = rest.join("\n").trim() || (text.length > title.length ? text : "")
    const mobileColumnOverrides = isMobileMemoLayout
      ? getMobileColumnCreateOverrides(activeMobileColumn)
      : {}
    const draftItem = buildOptimisticMemoItem({
      id: createClientMemoId(),
      title,
      projectId: selectedProjectId,
      description,
      overrides: mobileColumnOverrides,
    })
    setIntakeError(null)
    setMemoCreating(draftItem.id, true)
    invalidateWishlistItemsCache()
    setItems(prev => [draftItem, ...prev])
    setIntakeText("")
    setTagFilter("all")
    setSelectedItem(draftItem)
    setDetailOpen(true)
    const createRequest = createWishlistMemo(buildMemoCreatePayload(draftItem))
    const trackedCreateRequest = createRequest.then(() => undefined)
    void trackedCreateRequest.catch(() => undefined)
    creatingMemoPromisesRef.current.set(draftItem.id, trackedCreateRequest)
    try {
      const item = await createRequest
      const pendingUpdates = pendingCreateUpdatesRef.current.get(draftItem.id) ?? null
      pendingCreateUpdatesRef.current.delete(draftItem.id)
      const nextItem = pendingUpdates
        ? { ...item, ...pendingUpdates, updated_at: new Date().toISOString() } as MemoItem
        : item
      invalidateWishlistItemsCache()
      setItems(prev => prev.map(existing => existing.id === draftItem.id ? nextItem : existing))
      setSelectedItem(prev => prev?.id === draftItem.id ? nextItem : prev)
      setMemoCreating(draftItem.id, false)
      if (pendingUpdates && Object.keys(pendingUpdates).length > 0) {
        try {
          const patched = await patchMemoItem(draftItem.id, pendingUpdates)
          setItems(prev => prev.map(existing => existing.id === draftItem.id ? patched : existing))
          setSelectedItem(prev => prev?.id === draftItem.id ? patched : prev)
        } catch (err) {
          setIntakeError(err instanceof Error ? err.message : "メモの更新に失敗しました")
        }
      }
      await refreshTags()
      pushAction({
        description: `「${nextItem.title}」を追加`,
        undo: async () => {
          setItems(prev => prev.filter(existing => existing.id !== draftItem.id))
          await removeMemoItemFromServer(draftItem.id)
          await refreshTags()
        },
        redo: async () => {
          const restored = await restoreMemoItem(nextItem)
          setItems(prev => prev.some(existing => existing.id === restored.id) ? prev : [restored, ...prev])
          await refreshTags()
        },
      })
    } catch (err) {
      pendingCreateUpdatesRef.current.delete(draftItem.id)
      setMemoCreating(draftItem.id, false)
      setItems(prev => prev.filter(existing => existing.id !== draftItem.id))
      setSelectedItem(prev => prev?.id === draftItem.id ? null : prev)
      setDetailOpen(false)
      setIntakeError(err instanceof Error ? err.message : "メモの追加に失敗しました")
    } finally {
      creatingMemoPromisesRef.current.delete(draftItem.id)
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
      const suggestedCategory = ""
      setSuggestion({
        ...data.suggestion,
        project_id: selectedProjectId,
        category: suggestedCategory,
        tags: [],
        tag_suggestions: [
          ...new Set([
            ...(
              typeof data.suggestion?.category === "string" && data.suggestion.category.trim()
                ? [data.suggestion.category.trim()]
                : []
            ),
            ...(Array.isArray(data.suggestion?.tags) ? data.suggestion.tags.filter((tag: unknown): tag is string => typeof tag === "string" && tag.trim().length > 0) : []),
            ...allTags,
          ]),
        ],
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
    const baseAiSourcePayload = { suggestion, intakeText }
    const mobileTargetColumn = addToCalendar
      ? "scheduled"
      : activeMobileColumn
    const mobileColumnOverrides = isMobileMemoLayout
      ? getMobileColumnCreateOverrides(mobileTargetColumn, baseAiSourcePayload)
      : {}
    try {
      const item = await createWishlistMemo({
        title: suggestion.title,
        project_id: suggestion.project_id ?? selectedProjectId,
        category: suggestion.category || null,
        tags: suggestion.tags,
        description: suggestion.description,
        time_candidates: suggestion.time_candidates,
        subtask_suggestions: suggestion.subtask_suggestions,
        scheduled_at: scheduledAt,
        duration_minutes: durationMinutes,
        memo_status: scheduledAt ? "time_candidates" : "unsorted",
        ai_source_payload: baseAiSourcePayload,
        ...mobileColumnOverrides,
      }) as MemoItem
      invalidateWishlistItemsCache()
      setItems(prev => [item, ...prev])
      setTagFilter("all")
      setSelectedItem(item)
      setDetailOpen(true)
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

  const handleCalendarAdd = useCallback(async (item: MemoItem, calendarIdOverride?: string) => {
    const optimisticEventId = `optimistic-wishlist-${item.id}`
    const startTime = item.scheduled_at ? new Date(item.scheduled_at) : null
    const durationMinutes = item.duration_minutes ?? 60
    const calendarId = calendarIdOverride ?? targetCalendarId

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
      invalidateWishlistItemsCache()
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
        invalidateWishlistItemsCache()
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

  const handleDetailOpenChange = useCallback((open: boolean) => {
    if (open) {
      setDetailOpen(true)
      return
    }

    const item = selectedItem
    if (item && creatingMemoIdsRef.current.has(item.id)) {
      const pendingUpdates = pendingCreateUpdatesRef.current.get(item.id) ?? {}
      const draftCandidate = { ...item, ...pendingUpdates } as MemoItem
      const hasPendingCreate = creatingMemoPromisesRef.current.has(item.id)
      const canPersist = normalizeDraftMemoForCreate(draftCandidate) !== null

      if (!hasPendingCreate && !canPersist) {
        pendingCreateUpdatesRef.current.delete(item.id)
        setMemoCreating(item.id, false)
        setItems(prev => prev.filter(existing => existing.id !== item.id))
        setSelectedItem(null)
        setDetailOpen(false)
        return
      }

      if (!hasPendingCreate) {
        void createDraftMemoIfNeeded(draftCandidate)
      }
    }

    setDetailOpen(false)
  }, [createDraftMemoIfNeeded, selectedItem, setMemoCreating])

  useEffect(() => {
    if (!mindmapMemoFocus) return
    const focus = mindmapMemoFocus
    let cancelled = false
    setDetailOpen(false)
    setSelectedItem(null)
    setLinkedMemoFocus({
      taskId: focus.taskId,
      taskTitle: "",
      items: [],
      structuredItems: [],
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
        const legacyItems = Array.isArray(data.items) ? data.items as MemoItem[] : []
        const sourceItems = Array.isArray(data.source_items) ? data.source_items as MemoItem[] : []
        const structuredItems = Array.isArray(data.structured_items)
          ? (data.structured_items as unknown[]).map(toLinkedStructuredItem).filter((entry): entry is LinkedStructuredItem => !!entry)
          : []
        const linkedItems = [...new Map([...legacyItems, ...sourceItems].map(item => [item.id, item])).values()]
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
          structuredItems,
          isLoading: false,
          error: null,
        })
      } catch (err) {
        if (cancelled) return
        setLinkedMemoFocus({
          taskId: focus.taskId,
          taskTitle: "",
          items: [],
          structuredItems: [],
          isLoading: false,
          error: err instanceof Error ? err.message : "関連メモの取得に失敗しました",
        })
      }
    }

    void loadLinkedMemos()
    return () => {
      cancelled = true
    }
  }, [mindmapMemoFocus])

  // D&D: ドロップしたカラムキー（droppableId）からカラム遷移を判定し、更新を投げる
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
  const applyColumnMove = useCallback(async (item: MemoItem, to: ColumnKey, from: ColumnKey): Promise<boolean> => {
    // 「予定済み」へのドロップは時刻設定が必要なので、詳細シートを開いて促す
    if (to === "scheduled") {
      setIntakeError("予定済みにするには時刻を設定してください。詳細を開きました。")
      openDetail(item)
      return false
    }
    if (to === "mapped") {
      setIntakeError("マップ追加済みへ入れるには、メモを選択してマップ化してください。")
      return false
    }

    let updates: Partial<MemoItem> | null = null
    if (to === "today") {
      // unsorted/scheduled/completed → today: is_today=true、completedからの復活は完了解除
      updates = from === "completed"
        ? { is_completed: false, memo_status: "unsorted", is_today: true }
        : { is_today: true }
    } else if (to === "unsorted") {
      // today → unsorted: 確認ダイアログで、未予定へ戻すか別日に予定し直すかを選ぶ
      if (from === "today") {
        openTodayRemovalDialog(item)
        return false
      }
      // scheduled → unsorted: Google カレンダー予定も含めて予定情報を解除
      if (from === "scheduled") {
        await handleUnscheduleMemo(item)
        return true
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
      return true
    }
    return false
  }, [handleUnscheduleMemo, handleUpdate, openDetail, openTodayRemovalDialog])

  const getHorizontalDragTargetColumn = useCallback((sourceColumn: ColumnKey): ColumnKey | null => {
    if (!isMobileMemoLayout || linkedMemoFocus) return null

    const gesture = memoColumnDragRef.current
    const startPoint = gesture?.startPoint
    const latestPoint = latestDragPointRef.current
    if (!startPoint || !latestPoint) return null

    const dx = latestPoint.x - startPoint.x
    const dy = latestPoint.y - startPoint.y
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)
    if (absX < MEMO_HORIZONTAL_COLUMN_DRAG_PX || absX < absY * 1.15) return null

    const currentIndex = MOBILE_COLUMN_ORDER.indexOf(sourceColumn)
    if (currentIndex < 0) return null

    const columnWidth = mobileColumnsRef.current?.clientWidth ?? 0
    const stepWidth = Math.max(MEMO_HORIZONTAL_COLUMN_DRAG_PX, columnWidth > 0 ? columnWidth * 0.55 : 180)
    const steps = Math.max(1, Math.round(absX / stepWidth))
    const direction = dx > 0 ? 1 : -1
    const targetIndex = Math.max(0, Math.min(MOBILE_COLUMN_ORDER.length - 1, currentIndex + direction * steps))
    const target = MOBILE_COLUMN_ORDER[targetIndex]
    return target && target !== sourceColumn ? target : null
  }, [isMobileMemoLayout, linkedMemoFocus])

  const getColumnAutoMoveTarget = useCallback((): ColumnKey | null => {
    if (!isMobileMemoLayout || linkedMemoFocus) return null
    const gesture = memoColumnDragRef.current
    const sourceColumn = gesture?.sourceColumn
    const latestPoint = latestDragPointRef.current
    if (!gesture || !sourceColumn || !latestPoint) return null

    const target = mobileColumnsRef.current
    if (target) {
      const rect = target.getBoundingClientRect()
      const currentColumn = gesture.autoTargetColumn ?? activeMobileColumn ?? sourceColumn
      const currentIndex = MOBILE_COLUMN_ORDER.indexOf(currentColumn)
      if (currentIndex >= 0) {
        if (latestPoint.x >= rect.right - MEMO_COLUMN_AUTO_MOVE_EDGE_PX) {
          const nextColumn = MOBILE_COLUMN_ORDER[Math.min(MOBILE_COLUMN_ORDER.length - 1, currentIndex + 1)] ?? null
          return nextColumn && nextColumn !== currentColumn ? nextColumn : null
        }
        if (latestPoint.x <= rect.left + MEMO_COLUMN_AUTO_MOVE_EDGE_PX) {
          const previousColumn = MOBILE_COLUMN_ORDER[Math.max(0, currentIndex - 1)] ?? null
          return previousColumn && previousColumn !== currentColumn ? previousColumn : null
        }
      }
    }

    return getHorizontalDragTargetColumn(sourceColumn)
  }, [activeMobileColumn, getHorizontalDragTargetColumn, isMobileMemoLayout, linkedMemoFocus])

  const scheduleColumnAutoMove = useCallback((target: ColumnKey | null) => {
    const gesture = memoColumnDragRef.current
    if (!gesture || !target || target === gesture.autoTargetColumn) {
      clearColumnAutoMoveTimer()
      return
    }

    const activeTimer = columnAutoMoveTimerRef.current
    if (activeTimer?.target === target) return

    clearColumnAutoMoveTimer()
    columnAutoMoveTimerRef.current = {
      target,
      timerId: window.setTimeout(() => {
        columnAutoMoveTimerRef.current = null
        const currentGesture = memoColumnDragRef.current
        if (!currentGesture) return
        currentGesture.autoTargetColumn = target
        currentGesture.startPoint = latestDragPointRef.current ? { ...latestDragPointRef.current } : currentGesture.startPoint
        scrollToMobileColumn(target)
      }, MEMO_COLUMN_AUTO_MOVE_HOLD_MS),
    }
  }, [clearColumnAutoMoveTimer, scrollToMobileColumn])

  useEffect(() => {
    const handlePointerMove = () => {
      scheduleColumnAutoMove(getColumnAutoMoveTarget())
    }

    window.addEventListener("touchmove", handlePointerMove, { capture: true, passive: true })
    window.addEventListener("mousemove", handlePointerMove, { capture: true })
    return () => {
      window.removeEventListener("touchmove", handlePointerMove, { capture: true })
      window.removeEventListener("mousemove", handlePointerMove, { capture: true })
      clearColumnAutoMoveTimer()
    }
  }, [clearColumnAutoMoveTimer, getColumnAutoMoveTarget, scheduleColumnAutoMove])

  const handleDragStart = useCallback((start: DragStart) => {
    clearColumnAutoMoveTimer()
    memoColumnDragRef.current = {
      startPoint: pointerStartPointRef.current ? { ...pointerStartPointRef.current } : latestDragPointRef.current ? { ...latestDragPointRef.current } : null,
      sourceColumn: start.source.droppableId as ColumnKey,
      autoTargetColumn: null,
    }
  }, [clearColumnAutoMoveTimer])

  const handleDragEnd = useCallback(async (result: DropResult) => {
    const { source, destination, draggableId } = result
    const sourceColumn = source.droppableId as ColumnKey
    const autoTargetColumn = memoColumnDragRef.current?.autoTargetColumn ?? null

    try {
      const item = itemById.get(draggableId)
      if (!item) return

      const destinationColumn = destination?.droppableId as ColumnKey | undefined
      if (destinationColumn && destinationColumn !== sourceColumn) {
        await applyColumnMove(item, destinationColumn, sourceColumn)
        return
      }

      const horizontalTarget = autoTargetColumn && autoTargetColumn !== sourceColumn
        ? autoTargetColumn
        : getHorizontalDragTargetColumn(sourceColumn)
      if (!horizontalTarget) return

      const moved = await applyColumnMove(item, horizontalTarget, sourceColumn)
      if (moved) scrollToMobileColumn(horizontalTarget)
    } finally {
      clearColumnAutoMoveTimer()
      memoColumnDragRef.current = null
    }
  }, [applyColumnMove, clearColumnAutoMoveTimer, getHorizontalDragTargetColumn, itemById, scrollToMobileColumn])

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 overflow-hidden p-4">
        <div className="h-10 w-40 animate-pulse rounded-md bg-muted/70" />
        <div className="grid flex-1 min-h-0 gap-3 md:grid-cols-3">
          {[0, 1, 2].map(index => (
            <div key={index} className="space-y-3 rounded-md border bg-background p-3">
              <div className="h-8 animate-pulse rounded bg-muted/60" />
              <div className="h-24 animate-pulse rounded bg-muted/40" />
              <div className="h-24 animate-pulse rounded bg-muted/30" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const hasIntakeText = intakeText.trim().length > 0
  const disableMemoAdd = isRecording || isAnalyzing || isTranscribing
  const handleAddMemoFromComposer = async () => {
    if (disableMemoAdd) return
    if (hasIntakeText) {
      await handleQuickAdd()
      return
    }
    await handleCreate()
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className={cn("shrink-0 border-b px-3 py-2", compactComposer ? "space-y-2 md:px-3" : "space-y-2 md:px-5")}>
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
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label={isRecording ? "録音を停止" : "音声入力"}
              title={isRecording ? "録音を停止" : "音声入力"}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              onClick={handleAddMemoFromComposer}
              disabled={disableMemoAdd}
              className="h-10 shrink-0 gap-1 px-3"
            >
              <Plus className="h-4 w-4" />
              追加
            </Button>
            {SHOW_MEMO_MINDMAP_ENTRY && (
            <Button
              type="button"
              variant={selectMode ? "secondary" : "outline"}
              size="icon"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className="h-10 w-10 shrink-0"
              aria-pressed={selectMode}
              aria-label={selectMode ? "メモ選択を終了" : "メモを複数選択"}
              title={selectMode ? "メモ選択を終了" : "メモを複数選択"}
            >
              <Network className="h-4 w-4" />
            </Button>
            )}
          </div>
        ) : isMobileMemoLayout && !linkedMemoFocus ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <h1 className="shrink-0 text-lg font-semibold leading-none tracking-normal">メモ</h1>
              {onSelectSpace && onSelectProject && (
                <SpaceProjectSwitcher
                  spaces={spaces}
                  projects={projects}
                  selectedSpaceId={selectedSpaceId}
                  selectedProjectId={selectedProjectId}
                  onSelectSpace={onSelectSpace}
                  onSelectProject={onSelectProject}
                  onProjectCreated={onProjectCreated}
                  onProjectSaved={onProjectSaved}
                  onProjectDeleted={onProjectDeleted}
                  onSpaceSaved={onSpaceSaved}
                  showAllProjectsOption
                  variant="memoHeaderCompact"
                  className="ml-6"
                />
              )}
            </div>
            {SHOW_MEMO_TAG_FILTER_ENTRY && (
            <TagFilterMenu
              tags={allTags}
              selectedTag={tagFilter}
              tagColors={tagColors}
              onTagChange={setTagFilter}
              className="h-9 w-9 shrink-0 rounded-md"
            />
            )}
          </div>

          <div className="flex gap-2">
            <textarea
              value={intakeText}
              onChange={e => setIntakeText(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) void handleQuickAdd()
              }}
              placeholder="音声またはテキストで入力"
              rows={1}
              className="min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button
              type="button"
              onClick={handleVoiceToggle}
              disabled={isTranscribing}
              variant={isRecording ? "destructive" : "outline"}
              size="icon"
              className="h-11 w-11 shrink-0 rounded-md"
              aria-label={isRecording ? "録音を停止" : "音声入力"}
              title={isRecording ? "録音を停止" : "音声入力"}
            >
              {isTranscribing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => { void handleAnalyze() }}
              disabled={!hasIntakeText || isRecording || isAnalyzing || isTranscribing}
              size="icon"
              className="h-11 w-11 shrink-0 rounded-md"
              aria-label="AIで整理して生成"
              title="AIで整理して生成"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              onClick={handleAddMemoFromComposer}
              disabled={disableMemoAdd}
              size="icon"
              className="h-11 w-11 shrink-0 rounded-md"
              aria-label="メモを追加"
              title="メモを追加"
            >
              <Plus className="h-4 w-4" />
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
        </>
        ) : (
        <>
          <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold leading-tight">メモ</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">雑な入力を整理</p>
          </div>
          {SHOW_MEMO_TAG_FILTER_ENTRY && (
          <TagFilterMenu
            tags={allTags}
            selectedTag={tagFilter}
            tagColors={tagColors}
            onTagChange={setTagFilter}
            className="min-h-[40px] min-w-[40px] shrink-0"
          />
          )}
          {SHOW_MEMO_MINDMAP_ENTRY && (
          <Button
            type="button"
            variant={selectMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            aria-pressed={selectMode}
            className="min-h-[40px] shrink-0 gap-1 px-3"
            title={selectMode ? "メモ選択を終了" : "複数メモをマインドマップに整理"}
          >
            <Network className="h-4 w-4" />
            <span className="hidden sm:inline">{selectMode ? "選択解除" : "マップ化"}</span>
          </Button>
          )}
          <Button
            type="button"
            onClick={handleAddMemoFromComposer}
            disabled={disableMemoAdd}
            size="sm"
            className="min-h-[40px] shrink-0 gap-1 px-3"
            title={hasIntakeText ? "入力内容をメモとして追加" : "新しいメモを追加"}
          >
            <Plus className="h-4 w-4" /> 追加
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => { void handleAnalyze() }}
            disabled={!hasIntakeText || isRecording || isAnalyzing || isTranscribing}
            size="sm"
            className="min-h-[40px] shrink-0 gap-1 px-3"
            title="AIで整理して生成"
          >
            <Sparkles className="h-4 w-4" /> 生成
          </Button>
          </div>

          <div className="flex gap-2">
          <textarea
            value={intakeText}
            onChange={e => setIntakeText(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { handleAnalyze(); return }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleQuickAdd() }
            }}
            placeholder="音声またはテキストで入力"
            rows={1}
            className="min-h-[44px] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button
            type="button"
            onClick={handleVoiceToggle}
            disabled={isTranscribing}
            variant={isRecording ? "destructive" : "outline"}
            size="icon"
            className="min-h-[44px] w-11 shrink-0 px-0"
            aria-label={isRecording ? "録音を停止" : "音声入力"}
            title={isRecording ? "録音を停止" : "音声入力"}
          >
            {isTranscribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRecording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
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
        </>
        )}
        {isMobileMemoLayout && !linkedMemoFocus && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1 md:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {MOBILE_COLUMN_ORDER.map(column => {
              const section = mobileSections[column]
              const active = activeMobileColumn === column
              return (
                <button
                  key={column}
                  type="button"
                  onClick={() => scrollToMobileColumn(column)}
                  className={cn(
                    "min-h-8 shrink-0 rounded-full border px-3 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  aria-pressed={active}
                >
                  {section.title}
                  <span className={cn(
                    "ml-1 rounded-full px-1.5 text-[10px]",
                    active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}>
                    {section.count}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {SHOW_MEMO_MINDMAP_ENTRY && selectMode && (
          <MemoSelectionToolbar
            selectedCount={selectedMemoIds.size}
            allVisibleSelected={visibleMemoIds.length > 0 && visibleMemoIds.every(id => selectedMemoIds.has(id))}
            onToggleVisible={toggleSelectVisibleMemos}
            onMap={() => setShowMindmapDialog(true)}
            onCancel={exitSelectMode}
          />
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
                      : `${linkedMemoFocus.items.length}件 / 分解${linkedMemoFocus.structuredItems.length}件`}
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
          ) : filteredItems.length === 0 && (!linkedMemoFocus || linkedMemoFocus.structuredItems.length === 0) && !(isMobileMemoLayout && !linkedMemoFocus) ? (
            <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>{linkedMemoFocus ? "このノードに紐付くメモはありません" : "メモはまだありません"}</p>
              {!linkedMemoFocus && (
                <Button variant="outline" onClick={handleCreate} className="min-h-[44px]">
                  <Plus className="mr-1 h-4 w-4" /> 追加
                </Button>
              )}
            </div>
          ) : linkedMemoFocus ? (
            <div className="mx-auto max-w-2xl space-y-3">
              {linkedMemoFocus.structuredItems.length > 0 && (
                <div className="rounded-lg border bg-background/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">このノードに紐付く分解項目</div>
                      <div className="text-xs text-muted-foreground">元メモは下の関連メモに表示されます</div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {linkedMemoFocus.structuredItems.map(structuredItem => {
                      return (
                        <div key={structuredItem.id} className="rounded-md border bg-muted/10 p-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                                <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {actionLabel(structuredItem.actionType)}
                                </span>
                                {structuredItem.placementMode && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                                    {structuredItem.placementMode === "link_existing" ? "既存紐付け" : structuredItem.placementMode === "create_child" ? "子として追加" : "直下追加"}
                                  </span>
                                )}
                              </div>
                              <div className="break-words text-sm font-medium leading-5">{structuredItem.title}</div>
                              {structuredItem.body && (
                                <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">{structuredItem.body}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {filteredItems.length > 0 && (
                <DragDropContext
                  enableDefaultSensors={false}
                  sensors={memoDndSensors}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                >
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
                    nativeMemoDrag={isCalendarSplitVisible}
                    selectMode={selectMode}
                    selectedMemoIds={selectedMemoIds}
                    onToggleSelect={toggleMemoSelection}
                  />
                </DragDropContext>
              )}
            </div>
          ) : isMobileMemoLayout ? (
            <DragDropContext
              enableDefaultSensors={false}
              sensors={memoDndSensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div
                ref={mobileColumnsRef}
                onScroll={handleMobileColumnsScroll}
                className="-mx-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ scrollSnapType: "x mandatory" }}
              >
                <div className="flex min-w-full">
                  {MOBILE_COLUMN_ORDER.map(column => {
                    const section = mobileSections[column]
                    return (
                      <div
                        key={column}
                        className="w-full shrink-0 px-4"
                        style={{ scrollSnapAlign: "start" }}
                      >
                        <MemoSection
                          columnKey={section.columnKey}
                          title={section.title}
                          count={section.count}
                          items={section.items}
                          emptyText={section.emptyText}
                          onUpdate={handleUpdate}
                          onDelete={handleDelete}
                          onOpen={openDetail}
                          projectById={projectById}
                          tagColors={tagColors}
                          nativeMemoDrag={(column === "unsorted" || column === "today") && isCalendarSplitVisible}
                          selectMode={selectMode}
                          selectedMemoIds={selectedMemoIds}
                          onToggleSelect={toggleMemoSelection}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </DragDropContext>
          ) : (
            <DragDropContext
              enableDefaultSensors={false}
              sensors={memoDndSensors}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
            <div className="mx-auto w-full overflow-x-auto pb-2">
              <div
                className={cn(
                  "grid min-w-0 gap-4 md:w-max",
                  unscheduledItems.length >= 2
                    ? "md:grid-cols-[13rem_13rem_17rem_13rem_13rem_13rem]"
                    : "md:grid-cols-[13rem_17rem_13rem_13rem_13rem]",
                )}
              >
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
                  nativeMemoDrag={isCalendarSplitVisible}
                  className={unscheduledItems.length >= 2 ? "md:col-span-2" : undefined}
                  listClassName={unscheduledItems.length >= 2 ? "sm:grid-cols-2" : undefined}
                  selectMode={selectMode}
                  selectedMemoIds={selectedMemoIds}
                  onToggleSelect={toggleMemoSelection}
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
                  nativeMemoDrag={isCalendarSplitVisible}
                  selectMode={selectMode}
                  selectedMemoIds={selectedMemoIds}
                  onToggleSelect={toggleMemoSelection}
                />
                <MemoSection
                  columnKey="mapped"
                  title="マップ追加済み"
                  count={mappedItems.length}
                  items={mappedItems}
                  emptyText="マップ追加済みのメモはありません"
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onOpen={openDetail}
                  projectById={projectById}
                  tagColors={tagColors}
                  nativeMemoDrag={false}
                  selectMode={selectMode}
                  selectedMemoIds={selectedMemoIds}
                  onToggleSelect={toggleMemoSelection}
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
                  nativeMemoDrag={false}
                  selectMode={selectMode}
                  selectedMemoIds={selectedMemoIds}
                  onToggleSelect={toggleMemoSelection}
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
                  nativeMemoDrag={false}
                  selectMode={selectMode}
                  selectedMemoIds={selectedMemoIds}
                  onToggleSelect={toggleMemoSelection}
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
        onOpenChange={handleDetailOpenChange}
        onUpdate={handleUpdate}
        onCalendarAdd={async (item, calendarId) => { await handleCalendarAdd(item, calendarId) }}
        onSaved={() => handleDetailOpenChange(false)}
        tagOptions={allTags}
        projects={projects}
        calendars={calendars}
        tagColors={tagColors}
        onLaunchCodex={launchCodexForMemo}
        onCopyCodexPrompt={copyCodexPromptForMemo}
        onReadyForAttachments={waitForMemoPersistence}
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

      {SHOW_MEMO_MINDMAP_ENTRY && selectMode && !showMindmapDialog && (
        <div className="fixed bottom-20 left-1/2 z-50 flex w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 p-1.5 shadow-lg backdrop-blur md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggleSelectVisibleMemos}
            className="h-9 shrink-0 rounded-full px-3 text-xs"
          >
            {visibleMemoIds.length > 0 && visibleMemoIds.every(id => selectedMemoIds.has(id)) ? "解除" : "全選択"}
          </Button>
          <Button
            type="button"
            onClick={() => setShowMindmapDialog(true)}
            disabled={selectedMemoIds.size === 0}
            className="h-9 min-w-0 flex-1 rounded-full px-3 text-xs"
          >
            <Network className="mr-1 h-4 w-4" />
            {selectedMemoIds.size > 0 ? `${selectedMemoIds.size}件をマップ化` : "メモを選択"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={exitSelectMode}
            className="h-9 w-9 shrink-0 rounded-full"
            aria-label="選択を終了"
            title="選択を終了"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <MemoToMindmapDialog
        open={showMindmapDialog}
        noteIds={[...selectedMemoIds]}
        source="wishlist"
        projects={projects.map(project => ({ id: project.id, title: project.title }))}
        spaces={spaces.map(space => ({ id: space.id, title: space.title }))}
        defaultSpaceId={selectedSpaceId}
        defaultProjectId={selectedMemosProjectId}
        onClose={() => setShowMindmapDialog(false)}
        onSuccess={projectId => {
          const committedIds = new Set(selectedMemoIds)
          setShowMindmapDialog(false)
          exitSelectMode()
          setItems(prev => prev.map(item =>
            committedIds.has(item.id)
              ? { ...item, project_id: projectId, memo_status: "organized", updated_at: new Date().toISOString() }
              : item,
          ))
          void fetchItems({ force: true })
          void onMindmapUpdated?.()
        }}
      />
    </div>
  )
}

function MemoSelectionToolbar({
  selectedCount,
  allVisibleSelected,
  onToggleVisible,
  onMap,
  onCancel,
}: {
  selectedCount: number
  allVisibleSelected: boolean
  onToggleVisible: () => void
  onMap: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-md border bg-primary/5 px-3 py-2 text-xs">
      <span className="font-medium text-foreground">{selectedCount}件選択中</span>
      <button
        type="button"
        onClick={onToggleVisible}
        className="rounded border bg-background px-2 py-1 text-muted-foreground hover:text-foreground"
      >
        {allVisibleSelected ? "表示分を解除" : "表示分を全選択"}
      </button>
      <Button
        type="button"
        size="sm"
        onClick={onMap}
        disabled={selectedCount === 0}
        className="ml-auto h-8 gap-1.5 px-3 text-xs"
      >
        <Network className="h-3.5 w-3.5" />
        {selectedCount > 0 ? `${selectedCount}件をマップ化` : "メモを選択"}
      </Button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        キャンセル
      </button>
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
  nativeMemoDrag = false,
  selectMode = false,
  selectedMemoIds,
  onToggleSelect,
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
  nativeMemoDrag?: boolean
  selectMode?: boolean
  selectedMemoIds?: Set<string>
  onToggleSelect?: (memoId: string) => void
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
              <div className={cn("grid min-w-0 gap-3", listClassName)}>
                {items.map((item, index) => (
                  <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={selectMode}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...(!selectMode ? dragProvided.dragHandleProps : {})}
                        className={cn(
                          "relative min-w-0 rounded-lg transition-shadow",
                          dragSnapshot.isDragging && "opacity-80 shadow-xl ring-2 ring-primary/40",
                          selectMode && selectedMemoIds?.has(item.id) && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                        )}
                      >
                        <WishlistCard
                          item={item}
                          onUpdate={onUpdate}
                          onDelete={onDelete}
                          onClick={() => selectMode ? onToggleSelect?.(item.id) : onOpen(item)}
                          project={item.project_id ? projectById.get(item.project_id) ?? null : null}
                          tagColors={tagColors}
                          nativeMemoDrag={nativeMemoDrag}
                        />
                        {selectMode && (
                          <>
                            <button
                              type="button"
                              className="absolute inset-0 z-20 rounded-lg"
                              onClick={() => onToggleSelect?.(item.id)}
                              aria-pressed={selectedMemoIds?.has(item.id) ?? false}
                              aria-label={selectedMemoIds?.has(item.id) ? "メモの選択を解除" : "メモを選択"}
                            />
                            <div
                              className={cn(
                                "pointer-events-none absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-full border shadow-sm",
                                selectedMemoIds?.has(item.id)
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border bg-background text-transparent",
                              )}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </div>
                          </>
                        )}
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

function TagFilterMenu({
  tags,
  selectedTag,
  tagColors,
  onTagChange,
  className,
}: {
  tags: string[]
  selectedTag: string | "all"
  tagColors: Record<string, string>
  onTagChange: (tag: string | "all") => void
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("relative", className)}
          aria-label="タグメニューを開く"
          title="タグ"
        >
          <MoreHorizontal className="h-4 w-4" />
          {selectedTag !== "all" && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 p-2">
        <DropdownMenuLabel className="px-2 text-xs text-muted-foreground">タグで絞り込み</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => onTagChange("all")}
          className={cn(
            "min-h-11 cursor-pointer gap-2 rounded-md text-sm",
            selectedTag === "all" && "bg-muted font-medium",
          )}
        >
          <Check className={cn("h-4 w-4", selectedTag === "all" ? "opacity-100" : "opacity-0")} />
          すべて
        </DropdownMenuItem>
        {tags.length > 0 && <DropdownMenuSeparator />}
        <div className="grid max-h-[45vh] grid-cols-2 gap-1 overflow-y-auto p-1">
          {tags.map(tag => {
          const color = getTagColor(tag, tagColors)
          return (
            <DropdownMenuItem
              key={tag}
              onSelect={() => onTagChange(tag)}
              className="min-h-11 cursor-pointer justify-between rounded-md border px-2 text-xs"
              style={{
                borderColor: colorToRgba(color, selectedTag === tag ? 0.8 : 0.35),
                backgroundColor: selectedTag === tag ? colorToRgba(color, 0.24) : colorToRgba(color, 0.1),
                color,
              }}
            >
              <span className="min-w-0 truncate">{tag}</span>
              {selectedTag === tag && <Check className="h-3.5 w-3.5 shrink-0" />}
            </DropdownMenuItem>
          )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
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
