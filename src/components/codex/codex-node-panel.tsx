"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type MouseEvent } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useCodexManualHandoffConfirmation } from "@/hooks/useCodexManualHandoffConfirmation"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import {
  appendCodexHandoffToken,
  beginCopyPromptForCodexHandoff,
  buildCodexOpenTarget,
  buildCodexHandoffToken,
  canUseLocalCodexOpenApi,
  copyPromptForCodexHandoff,
  getCurrentMobilePlatform,
  isLikelyMobileDevice,
  launchCodexViaLocalApi,
  launchFeedbackForMode,
  normalizeCodexPrompt,
  openCodexMobileTargetViaFocusmapNativeApp,
  type MobilePlatform,
  type CodexLaunchMode,
} from "@/lib/codex-app-launch"
import { getCodexTaskUiState } from "@/lib/codex-run-state"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import type { AiTask, AiTaskActivityMessage } from "@/types/ai-task"
import { Bot, Calendar as CalendarIcon, Check, ChevronDown, Clock, Copy, ExternalLink, ImagePlus, Laptop, Loader2, Mic, Save, Smartphone, Sparkles, Square, Trash2, TriangleAlert } from "lucide-react"
import { DurationWheelPopover } from "@/components/ui/duration-wheel-popover"
import { useCalendars } from "@/hooks/useCalendars"
import type { Task, TaskAttachment } from "@/types/database"

type NodeInfo = {
  taskId: string
  title: string
  memo: string
  cwd: string | null
  status: string | null
  codexThreadUrl?: string | null
  scheduledLabel?: string | null
  priority?: number | null
  estimatedLabel?: string | null
  isDone?: boolean
  hasMemo?: boolean
}

type CodexNodePanelProps = {
  open: boolean
  node: NodeInfo
  candidates: string[]
  onClose: () => void
  onPersistDir: (taskId: string, dir: string) => Promise<void> | void
  onOpenMemo?: (taskId: string) => void
  onToggleComplete?: (taskId: string, done: boolean) => void
  onAddChild?: (taskId: string) => void
  onDelete?: (taskId: string) => void
  onSaveHeading?: (taskId: string, heading: string) => Promise<void> | void
  onSaveDraft?: (taskId: string, draft: { title: string; memo: string | null }) => Promise<void> | void
  onSaveTaskDetails?: (taskId: string, updates: Partial<Task>) => Promise<void> | void
  onRegisterSchedule?: (taskId: string, params: { scheduledAt: string | null; estimatedMinutes: number; calendarId: string | null }) => Promise<{ googleEventId?: string | null } | void> | { googleEventId?: string | null } | void
}

type SaveStatus = "saved" | "saving" | "error"
type CodexSendStatus = "idle" | "sending" | "sent"
type CodexRunnerStatus = {
  checked: boolean
  ready: boolean
}

type AiRunner = {
  executors?: string[]
  last_heartbeat_at?: string | null
}

type CodexChatEntry = {
  kind: "assistant" | "event" | "user" | "process"
  text: string
}

const RUNNER_ONLINE_WINDOW_MS = 5 * 60 * 1000
const RUNNER_STATUS_POLL_MS = 30_000
const CODEX_PANEL_SYNC_INTERVAL_MS = 3_000
const CODEX_PANEL_IDLE_SYNC_INTERVAL_MS = 60 * 60_000
const CODEX_PANEL_WATCH_PING_INTERVAL_MS = 10_000
const CODEX_DISPLAY_LOG_CHARS = 80_000
const QUICK_ESTIMATED_MINUTES = [5, 15, 30, 60, 120] as const

type TaskAttachmentPreview = Pick<TaskAttachment, "id" | "file_name" | "file_url" | "file_type" | "file_size">

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function hasOnlineCodexRunner(runners: AiRunner[]) {
  const now = Date.now()
  return runners.some((runner) => {
    const executors = Array.isArray(runner.executors) ? runner.executors : []
    if (!executors.includes("codex_app") && !executors.includes("codex")) return false
    const lastHeartbeatAt = runner.last_heartbeat_at ? new Date(runner.last_heartbeat_at).getTime() : 0
    return Number.isFinite(lastHeartbeatAt) && lastHeartbeatAt > 0 && now - lastHeartbeatAt < RUNNER_ONLINE_WINDOW_MS
  })
}

function buildCodexPrompt(heading: string, detail: string) {
  const normalizedHeading = normalizeCodexPrompt(heading)
  const normalizedDetail = normalizeCodexPrompt(detail)
  return [normalizedHeading, normalizedDetail].filter(Boolean).join("\n")
}

function toDateInputValue(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function toTimeInputValue(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  return `${hour}:${minute}`
}

function todayDateInputValue() {
  const date = new Date()
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function combineLocalDateTime(dateValue: string, timeValue: string) {
  if (!dateValue) return null
  const [year, month, day] = dateValue.split("-").map(Number)
  const [hour, minute] = (timeValue || "09:00").split(":").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0).toISOString()
}

function formatDurationLabel(minutes: number | null) {
  if (!minutes || minutes <= 0) return "未設定"
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}時間${rest}分` : `${hours}時間`
}

function formatFileSize(value: number | null) {
  if (!value || value <= 0) return null
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)}KB`
  return `${(value / 1024 / 1024).toFixed(1)}MB`
}

function imageExtensionFromType(type: string) {
  if (type.includes("jpeg")) return "jpg"
  if (type.includes("webp")) return "webp"
  if (type.includes("gif")) return "gif"
  return "png"
}

function stripFocusmapSyncId(prompt: string) {
  return prompt
    .replace(/\n?---\nFocusmap同期ID:\s+FM-[^\n]+\nこの同期IDはFocusmap連携用です。返信では触れないでください。\s*$/u, "")
    .trim()
}

function normalizedKey(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function isGenericCodexPulseText(value: string) {
  return /Codex\.appの稼働シグナルを確認中|Codex\.appが作業中です|Codex セッションは確認待ちです/u.test(value.trim())
}

function promptEchoKeys(prompt: string) {
  const keys = new Set<string>()
  const rawPrompt = normalizedKey(prompt)
  if (rawPrompt) keys.add(rawPrompt)
  const visiblePrompt = stripFocusmapSyncId(prompt)
  const normalizedPrompt = normalizedKey(visiblePrompt)
  if (normalizedPrompt) keys.add(normalizedPrompt)
  const firstLine = visiblePrompt.split("\n").map(line => line.trim()).find(Boolean)
  if (firstLine) keys.add(normalizedKey(firstLine))
  return keys
}

function sanitizeCodexDisplayLog(value: string): string {
  const seen = new Set<string>()
  return value
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block && !/^\[(developer|system)\]/i.test(block))
    .filter(block => !/^Focusmap同期ID:/i.test(block))
    .filter(block => !isGenericCodexPulseText(block))
    .filter(block => !/^プロンプト待ち。Codex\.appで送信されると/i.test(block))
    .filter(block => {
      const key = normalizedKey(block)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join("\n\n")
    .trim()
}

function buildCodexDisplayLog(liveLog: string, message: string, preview: string): string {
  const base = liveLog || message || preview
  return sanitizeCodexDisplayLog(base).slice(-CODEX_DISPLAY_LOG_CHARS)
}

function activityMessagesToDisplayLog(messages: AiTaskActivityMessage[]): string {
  return messages
    .map((message) => {
      const body = message.body.trim()
      if (!body) return ""
      if (isGenericCodexPulseText(body)) return ""
      if (message.role === "user" || message.kind === "user_answer") return `[user] ${body}`
      if (message.role === "codex" && (message.kind === "progress" || message.kind === "question" || message.kind === "approval" || message.kind === "completed")) {
        return `[assistant] ${body}`
      }
      return `[Codex] ${body}`
    })
    .filter(Boolean)
    .join("\n\n")
}

function parseCodexConversation(value: string, prompt: string): { entries: CodexChatEntry[]; processLogs: string[] } {
  const entries: CodexChatEntry[] = []
  const assistantBlocks: string[] = []
  const processLogs: string[] = []
  const seen = new Set<string>()
  const promptKeys = promptEchoKeys(prompt)

  const pushEntry = (entry: CodexChatEntry) => {
    const key = `${entry.kind}:${normalizedKey(entry.text)}`
    if (!entry.text.trim() || seen.has(key)) return
    seen.add(key)
    entries.push(entry)
  }
  const pushProcess = (text: string) => {
    const key = normalizedKey(text)
    if (key && !processLogs.some(log => normalizedKey(log) === key)) processLogs.push(text)
  }
  const flushAssistant = () => {
    const text = assistantBlocks.join("\n\n").trim()
    assistantBlocks.length = 0
    if (text) pushEntry({ kind: "assistant", text })
  }

  for (const rawBlock of value.split(/\n{2,}/)) {
    const block = rawBlock.trim()
    if (!block || promptKeys.has(normalizedKey(block))) continue
    if (/^\[(developer|system)\]/i.test(block)) continue
    if (/^Codex セッションは確認待ちです。/i.test(block)) continue

    const user = block.match(/^\[user\]\s*([\s\S]+)/i)
    if (user?.[1]?.trim()) {
      flushAssistant()
      const userText = user[1].trim()
      if (!promptKeys.has(normalizedKey(userText))) pushEntry({ kind: "user", text: userText })
      continue
    }

    const process = block.match(/^\[(command:[^\]]+|approval-requested|approval-resolved)\]\s*([\s\S]*)/i)
    if (process?.[1]) {
      flushAssistant()
      const tag = process[1].toLowerCase()
      const body = process[2]?.trim() ?? ""
      if (tag === "approval-requested") pushProcess(`承認待ち\n${body}`)
      else if (tag === "approval-resolved") pushProcess("承認済み")
      else if (tag === "command:started") pushProcess(`実行開始\n${body}`)
      else if (tag === "command:completed") pushProcess(`実行完了\n${body}`)
      continue
    }

    const event = block.match(/^\[Codex\]\s*([\s\S]+)/i)
    if (event?.[1]?.trim()) {
      flushAssistant()
      if (!/実行完了/.test(event[1])) pushEntry({ kind: "event", text: event[1].trim() })
      continue
    }

    const assistant = block.match(/^\[assistant\]\s*([\s\S]+)/i)
    assistantBlocks.push((assistant?.[1] ?? block).trim())
  }

  flushAssistant()
  return { entries, processLogs }
}

export function CodexNodePanel({
  open,
  node,
  candidates,
  onClose,
  onSaveHeading,
  onSaveDraft,
  onSaveTaskDetails,
  onRegisterSchedule,
}: CodexNodePanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { calendars } = useCalendars()
  const {
    getBySourceId: getAiTaskBySourceId,
    refresh: refreshAiTasks,
    refreshStatus: refreshAiTaskStatus,
  } = useMemoAiTasks({ sourceTaskIds: [node.taskId] })
  const [heading, setHeading] = useState(node.title)
  const [detail, setDetail] = useState(node.memo)
  const [error, setError] = useState<string | null>(null)
  const [codexFeedback, setCodexFeedback] = useState<string | null>(null)
  const [codexSendStatus, setCodexSendStatus] = useState<CodexSendStatus>("idle")
  const [justSentPrompt, setJustSentPrompt] = useState("")
  const [codexRunnerStatus, setCodexRunnerStatus] = useState<CodexRunnerStatus>({ checked: false, ready: false })
  const [codexActivityMessages, setCodexActivityMessages] = useState<AiTaskActivityMessage[]>([])
  const [codexActivityError, setCodexActivityError] = useState<string | null>(null)
  const [isCopyingCodexPrompt, setIsCopyingCodexPrompt] = useState(false)
  const [isOpeningCodex, setIsOpeningCodex] = useState(false)
  const [codexPromptCopied, setCodexPromptCopied] = useState(false)
  const [isMobileOpenTarget, setIsMobileOpenTarget] = useState(false)
  const [mobilePlatform, setMobilePlatform] = useState<MobilePlatform>("desktop")
  const [isGeneratingHeading, setIsGeneratingHeading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(null)
  const [calendarId, setCalendarId] = useState("")
  const [googleEventId, setGoogleEventId] = useState<string | null>(null)
  const [isRegisteringSchedule, setIsRegisteringSchedule] = useState(false)
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<TaskAttachmentPreview[]>([])
  const [isLoadingTaskDetail, setIsLoadingTaskDetail] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [imageNotice, setImageNotice] = useState<string | null>(null)
  const [isImageDragActive, setIsImageDragActive] = useState(false)
  const saveVersionRef = useRef(0)
  const codexWatchIdRef = useRef<string | null>(null)
  const codexSyncInFlightRef = useRef(false)

  if (!codexWatchIdRef.current && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    codexWatchIdRef.current = `node:${crypto.randomUUID()}`
  }

  useEffect(() => {
    if (!open) return
    const platform = getCurrentMobilePlatform()
    setMobilePlatform(platform)
    setIsMobileOpenTarget(isLikelyMobileDevice())
    setHeading(node.title)
    setDetail(node.memo)
    setError(null)
    setCodexFeedback(null)
    setCodexSendStatus("idle")
    codexSyncInFlightRef.current = false
    setJustSentPrompt("")
    setCodexRunnerStatus({ checked: false, ready: false })
    setCodexActivityMessages([])
    setCodexActivityError(null)
    setIsCopyingCodexPrompt(false)
    setIsOpeningCodex(false)
    setCodexPromptCopied(false)
    setIsGeneratingHeading(false)
    setSaveStatus("saved")
    setGoogleEventId(null)
    setIsRegisteringSchedule(false)
    setScheduleNotice(null)
    setImageNotice(null)
    setIsImageDragActive(false)
  }, [open, node.taskId, node.title, node.memo])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const loadTaskDetail = async () => {
      setIsLoadingTaskDetail(true)
      try {
        const [taskRes, attachmentsRes] = await Promise.all([
          fetch(`/api/tasks/${encodeURIComponent(node.taskId)}`, { cache: "no-store" }),
          fetch(`/api/tasks/${encodeURIComponent(node.taskId)}/attachments`, { cache: "no-store" }),
        ])

        const taskData = await taskRes.json().catch(() => ({})) as { task?: Task; error?: { message?: string } }
        const attachmentsData = await attachmentsRes.json().catch(() => ({})) as { attachments?: TaskAttachmentPreview[]; error?: string }
        if (cancelled) return

        if (taskRes.ok && taskData.task) {
          setScheduledAt(taskData.task.scheduled_at ?? null)
          setEstimatedMinutes(taskData.task.estimated_time ?? null)
          setCalendarId(taskData.task.calendar_id ?? "")
          setGoogleEventId(taskData.task.google_event_id ?? null)
        }

        if (attachmentsRes.ok && Array.isArray(attachmentsData.attachments)) {
          setAttachments(attachmentsData.attachments)
        } else {
          setAttachments([])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "メモ詳細を取得できませんでした")
          setAttachments([])
        }
      } finally {
        if (!cancelled) setIsLoadingTaskDetail(false)
      }
    }

    void loadTaskDetail()
    return () => {
      cancelled = true
    }
  }, [open, node.taskId])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const fetchRunnerStatus = async () => {
      try {
        const res = await fetchWithSupabaseAuth("/api/ai-runners", { cache: "no-store" })
        const data = await res.json().catch(() => ({})) as { runners?: AiRunner[] }
        if (cancelled) return
        setCodexRunnerStatus({
          checked: true,
          ready: res.ok && hasOnlineCodexRunner(Array.isArray(data.runners) ? data.runners : []),
        })
      } catch {
        if (!cancelled) setCodexRunnerStatus({ checked: true, ready: false })
      }
    }

    void fetchRunnerStatus()
    const interval = window.setInterval(() => void fetchRunnerStatus(), RUNNER_STATUS_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [open])

  const moveFocusToPanel = useCallback(() => {
    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      (active.matches("input, textarea, select") || active.isContentEditable)
    ) {
      active.blur()
    }
    contentRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!open) return
    const firstFrame = window.requestAnimationFrame(() => {
      moveFocusToPanel()
      window.requestAnimationFrame(moveFocusToPanel)
    })
    return () => window.cancelAnimationFrame(firstFrame)
  }, [moveFocusToPanel, open])

  const saveDraft = useCallback(async (nextHeading: string, nextDetail: string) => {
    const version = saveVersionRef.current + 1
    saveVersionRef.current = version
    setError(null)
    setSaveStatus("saving")

    try {
      const title = nextHeading.trim() || node.title
      const memo = nextDetail.trim() ? nextDetail : null

      if (onSaveDraft) {
        await onSaveDraft(node.taskId, { title, memo })
      } else {
        if (onSaveHeading) {
          await onSaveHeading(node.taskId, title)
        }
        const res = await fetch(`/api/tasks/${encodeURIComponent(node.taskId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(onSaveHeading ? { memo } : { title, memo }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(typeof data?.error?.message === "string" ? data.error.message : "メモの保存に失敗しました")
        }
      }

      if (saveVersionRef.current === version) {
        setSaveStatus("saved")
      }
    } catch (err) {
      if (saveVersionRef.current === version) {
        setSaveStatus("error")
        setError(err instanceof Error ? err.message : "メモの保存に失敗しました")
      }
    }
  }, [node.taskId, node.title, onSaveDraft, onSaveHeading])

  const handleHeadingChange = useCallback((nextHeading: string) => {
    setHeading(nextHeading)
    void saveDraft(nextHeading, detail)
  }, [detail, saveDraft])

  const handleDetailChange = useCallback((nextDetail: string) => {
    setDetail(nextDetail)
    void saveDraft(heading, nextDetail)
  }, [heading, saveDraft])

  const calendarOptions = useMemo(() => {
    const writable = calendars.filter(calendar => (
      calendar.google_calendar_id &&
      (calendar.access_level === "owner" || calendar.access_level === "writer")
    ))
    const selectedWritable = writable.filter(calendar => calendar.selected)
    const source = selectedWritable.length > 0 ? selectedWritable : writable.length > 0 ? writable : calendars
    const options = source
      .filter(calendar => calendar.google_calendar_id)
      .map(calendar => ({
        id: calendar.google_calendar_id,
        name: calendar.name || (calendar.is_primary ? "Google" : calendar.google_calendar_id),
        color: calendar.background_color ?? calendar.color ?? "#3F51B5",
        primary: calendar.is_primary,
      }))
    if (options.length > 0) return options
    return [{ id: "primary", name: "Google", color: "#3F51B5", primary: true }]
  }, [calendars])

  useEffect(() => {
    if (!open) return
    setCalendarId(prev => (
      prev && calendarOptions.some(calendar => calendar.id === prev)
        ? prev
        : calendarOptions[0]?.id ?? "primary"
    ))
  }, [calendarOptions, open])

  const patchTaskDetail = useCallback(async (updates: Record<string, unknown>) => {
    setError(null)
    setScheduleNotice(null)
    setSaveStatus("saving")
    try {
      if (onSaveTaskDetails) {
        await onSaveTaskDetails(node.taskId, updates as Partial<Task>)
      } else {
        const res = await fetch(`/api/tasks/${encodeURIComponent(node.taskId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(typeof data?.error?.message === "string" ? data.error.message : "タスク詳細の保存に失敗しました")
        }
        if (typeof data?.task?.google_event_id === "string") {
          setGoogleEventId(data.task.google_event_id)
        }
      }
      setSaveStatus("saved")
    } catch (err) {
      setSaveStatus("error")
      setError(err instanceof Error ? err.message : "タスク詳細の保存に失敗しました")
    }
  }, [node.taskId, onSaveTaskDetails])

  const dateValue = useMemo(() => toDateInputValue(scheduledAt), [scheduledAt])
  const timeValue = useMemo(() => toTimeInputValue(scheduledAt), [scheduledAt])

  const updateScheduledAt = useCallback((nextScheduledAt: string | null) => {
    setScheduledAt(nextScheduledAt)
    void patchTaskDetail({ scheduled_at: nextScheduledAt })
  }, [patchTaskDetail])

  const handleDateChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextDate = event.target.value
    if (!nextDate) {
      updateScheduledAt(null)
      return
    }
    updateScheduledAt(combineLocalDateTime(nextDate, timeValue || "09:00"))
  }, [timeValue, updateScheduledAt])

  const handleTimeChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = event.target.value
    const nextDate = dateValue || todayDateInputValue()
    updateScheduledAt(combineLocalDateTime(nextDate, nextTime || "09:00"))
  }, [dateValue, updateScheduledAt])

  const handleDurationChange = useCallback((minutes: number | null) => {
    setEstimatedMinutes(minutes)
    void patchTaskDetail({ estimated_time: minutes })
  }, [patchTaskDetail])

  const handleCalendarChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextCalendarId = event.target.value
    setCalendarId(nextCalendarId)
    void patchTaskDetail({ calendar_id: nextCalendarId.trim() || null })
  }, [patchTaskDetail])

  const canRegisterSchedule = Boolean(scheduledAt && estimatedMinutes && estimatedMinutes > 0 && calendarId.trim())

  const handleRegisterSchedule = useCallback(async () => {
    if (!scheduledAt || !estimatedMinutes || estimatedMinutes <= 0 || !calendarId.trim()) {
      setError("日時・所要時間・カレンダーをすべて選択してください")
      return
    }

    const targetCalendarId = calendarId.trim()
    setError(null)
    setScheduleNotice(null)
    setIsRegisteringSchedule(true)
    try {
      const wasLinked = Boolean(googleEventId)
      if (onRegisterSchedule) {
        const result = await onRegisterSchedule(node.taskId, {
          scheduledAt,
          estimatedMinutes,
          calendarId: targetCalendarId,
        })
        if (result?.googleEventId) {
          setGoogleEventId(result.googleEventId)
        }
      } else {
        await patchTaskDetail({
          scheduled_at: scheduledAt,
          estimated_time: estimatedMinutes,
          calendar_id: targetCalendarId,
        })
        const res = await fetch("/api/calendar/sync-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: node.taskId,
            scheduled_at: scheduledAt,
            estimated_time: estimatedMinutes,
            calendar_id: targetCalendarId,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "カレンダー登録に失敗しました")
        if (typeof data.googleEventId === "string") {
          setGoogleEventId(data.googleEventId)
        }
      }
      setScheduleNotice(wasLinked ? "カレンダー予定を更新しました" : "カレンダーに登録しました")
      setSaveStatus("saved")
    } catch (err) {
      setSaveStatus("error")
      setError(err instanceof Error ? err.message : "カレンダー登録に失敗しました")
    } finally {
      setIsRegisteringSchedule(false)
    }
  }, [calendarId, estimatedMinutes, googleEventId, node.taskId, onRegisterSchedule, patchTaskDetail, scheduledAt])

  const uploadImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith("image/"))
    if (imageFiles.length === 0) {
      setImageNotice("画像ファイルを選択してください")
      return
    }
    setError(null)
    setImageNotice(null)
    setIsUploadingImage(true)
    try {
      const uploaded: TaskAttachmentPreview[] = []
      for (const file of imageFiles) {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch(`/api/tasks/${encodeURIComponent(node.taskId)}/attachments`, {
          method: "POST",
          body: formData,
        })
        const data = await res.json().catch(() => ({})) as { attachment?: TaskAttachmentPreview; error?: string }
        if (!res.ok || !data.attachment) {
          throw new Error(typeof data.error === "string" ? data.error : "画像の追加に失敗しました")
        }
        uploaded.push(data.attachment)
      }
      setAttachments(prev => [...prev, ...uploaded])
      setImageNotice(`${uploaded.length}件の画像を追加しました`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像の追加に失敗しました")
    } finally {
      setIsUploadingImage(false)
      setIsImageDragActive(false)
    }
  }, [node.taskId])

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length > 0) void uploadImages(files)
    event.target.value = ""
  }, [uploadImages])

  const handlePasteClipboardImage = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard || !("read" in navigator.clipboard)) {
      setImageNotice("この環境ではクリック貼り付けに対応していません。Cmd+Vか画像追加を使ってください")
      return
    }
    try {
      const clipboardItems = await navigator.clipboard.read()
      const files: File[] = []
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith("image/"))
        if (!imageType) continue
        const blob = await item.getType(imageType)
        files.push(new File([blob], `clipboard-${Date.now()}.${imageExtensionFromType(imageType)}`, { type: imageType }))
      }
      await uploadImages(files)
    } catch (err) {
      setImageNotice(err instanceof Error ? err.message : "クリップボード画像を読み取れませんでした")
    }
  }, [uploadImages])

  const handlePanelPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files ?? []).filter(file => file.type.startsWith("image/"))
    if (files.length === 0) return
    event.preventDefault()
    void uploadImages(files)
  }, [uploadImages])

  const handleImageDrop = useCallback((event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsImageDragActive(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void uploadImages(files)
  }, [uploadImages])

  const handleDeleteAttachment = useCallback(async (attachment: TaskAttachmentPreview) => {
    setDeletingAttachmentId(attachment.id)
    setError(null)
    const previous = attachments
    setAttachments(prev => prev.filter(item => item.id !== attachment.id))
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(node.taskId)}/attachments/${encodeURIComponent(attachment.id)}`, {
        method: "DELETE",
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "画像の削除に失敗しました")
    } catch (err) {
      setAttachments(previous)
      setError(err instanceof Error ? err.message : "画像の削除に失敗しました")
    } finally {
      setDeletingAttachmentId(null)
    }
  }, [attachments, node.taskId])

  const handleTranscribed = useCallback((text: string) => {
    setDetail(prev => {
      const nextDetail = prev.trim() ? `${prev.trim()}\n${text}` : text
      void saveDraft(heading, nextDetail)
      return nextDetail
    })
  }, [heading, saveDraft])

  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    startRecording,
    stopRecording,
  } = useVoiceRecorder(handleTranscribed)

  const toggleVoiceInput = useCallback(() => {
    if (isRecording) {
      stopRecording()
      return
    }
    void startRecording()
  }, [isRecording, startRecording, stopRecording])

  const generateHeading = useCallback(async () => {
    const detailText = detail.trim()
    if (!detailText) return

    setError(null)
    setIsGeneratingHeading(true)
    try {
      const res = await fetch("/api/ai/generate-memo-heading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detail: detailText, currentHeading: heading.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "見出し生成に失敗しました")
      }
      if (typeof data.heading === "string" && data.heading.trim()) {
        handleHeadingChange(data.heading.trim())
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "見出し生成に失敗しました")
    } finally {
      setIsGeneratingHeading(false)
    }
  }, [detail, handleHeadingChange, heading])

  const promptHeadingForCodex = heading || node.title
  const codexPrompt = buildCodexPrompt(promptHeadingForCodex, detail)
  const codexRepoPath = (node.cwd?.trim() || candidates.find(candidate => candidate.trim()) || "").trim()
  const codexTask = getAiTaskBySourceId(node.taskId)
  const isCodexTask = codexTask?.executor === "codex" || codexTask?.executor === "codex_app"
  const codexUiState = getCodexTaskUiState(codexTask)
  const codexResult = asRecord(codexTask?.result)
  const codexSnapshot = asRecord(codexResult.codex_thread_snapshot)
  const codexThreadId =
    stringValue(codexTask?.codex_thread_id) ||
    stringValue(codexResult.codex_thread_id)
  const codexManualHandoff = codexResult.codex_manual_handoff === true
  const hasCodexRun = isCodexTask || !!justSentPrompt
  const codexWaitingForAppSend = codexManualHandoff && codexUiState?.state === "prompt_waiting"
  const codexMessage = stringValue(codexResult.message)
  const codexLiveLog = stringValue(codexResult.live_log)
  const codexPreview = stringValue(codexSnapshot.preview)
  const rawSentPrompt = codexTask?.prompt?.trim() || justSentPrompt
  const codexAiTaskId = codexTask?.id ?? null
  const sentPrompt = stripFocusmapSyncId(rawSentPrompt)
  const isCodexRunning = codexUiState?.state === "running" || codexTask?.status === "running"
  const canCopyCodexPrompt = hasCodexRun && !!rawSentPrompt && !isCodexRunning
  const codexDisplayLog = buildCodexDisplayLog(codexLiveLog, codexMessage, codexPreview)
  const codexActivityDisplayLog = activityMessagesToDisplayLog(codexActivityMessages)
  const codexConversation = useMemo(
    () => parseCodexConversation([codexActivityDisplayLog, codexDisplayLog].filter(Boolean).join("\n\n"), rawSentPrompt),
    [codexActivityDisplayLog, codexDisplayLog, rawSentPrompt],
  )
  const codexStatusLabel =
    codexTask?.status === "completed"
      ? "確認待ち"
      : codexWaitingForAppSend
        ? "未送信"
        : codexTask?.status === "failed"
          ? "接続失敗"
          : codexUiState?.state === "prompt_waiting"
            ? "未送信"
            : codexUiState?.state === "running"
              ? "Codex実行中"
              : codexUiState?.state === "awaiting_approval" || codexTask?.status === "awaiting_approval"
              ? "確認待ち"
              : codexThreadId
                ? "送信確認済み"
                : "Codexで確認"
  const codexStatusClass =
    codexTask?.status === "failed"
      ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
      : codexWaitingForAppSend || codexUiState?.state === "prompt_waiting"
        ? "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300"
        : codexUiState?.state === "running"
          ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  const codexOpenTarget = buildCodexOpenTarget(
    { prompt: rawSentPrompt || codexPrompt, repoPath: codexRepoPath || null, threadUrl: node.codexThreadUrl || null },
    { preferMobile: isMobileOpenTarget, mobilePlatform },
  )
  const codexHref = codexOpenTarget.url

  const loadCodexActivity = useCallback(async () => {
    const taskId = codexAiTaskId
    if (!open || !taskId || !isCodexTask) return

    try {
      const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${taskId}/activity`, { cache: "no-store" })
      const data = await res.json().catch(() => ({})) as { messages?: AiTaskActivityMessage[]; error?: string }
      if (!res.ok) throw new Error(data.error || `activity ${res.status}`)
      setCodexActivityMessages(Array.isArray(data.messages)
        ? data.messages.filter(message => !isGenericCodexPulseText(message.body))
        : [])
      setCodexActivityError(null)
    } catch (err) {
      setCodexActivityError(err instanceof Error ? err.message : "Codex活動履歴を取得できません")
    }
  }, [codexAiTaskId, isCodexTask, open])

  const syncCodexState = useCallback(async () => {
    if (!open || !hasCodexRun) return
    if (codexSyncInFlightRef.current) return
    codexSyncInFlightRef.current = true
    try {
      await fetchWithSupabaseAuth("/api/codex/sync-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_task_id: node.taskId,
          ai_task_id: codexAiTaskId,
          include_visible_activity: true,
        }),
      }).catch(() => undefined)
      await refreshAiTaskStatus()
      await loadCodexActivity()
    } finally {
      codexSyncInFlightRef.current = false
    }
  }, [codexAiTaskId, hasCodexRun, loadCodexActivity, node.taskId, open, refreshAiTaskStatus])

  const { trackManualHandoff, confirmManualHandoffNow, markScreenSwitched } = useCodexManualHandoffConfirmation({
    onConfirmed: async () => {
      await refreshAiTasks()
      await refreshAiTaskStatus()
      window.setTimeout(() => void loadCodexActivity(), 250)
    },
  })

  const handleCopyCodexPrompt = useCallback(async () => {
    if (!rawSentPrompt || isCopyingCodexPrompt) return
    setIsCopyingCodexPrompt(true)
    setCodexPromptCopied(false)
    try {
      const copied = await copyPromptForCodexHandoff(rawSentPrompt)
      if (!copied) throw new Error("クリップボードコピー失敗")
      setCodexPromptCopied(true)
      setCodexFeedback("プロンプトをコピーしました。Codex.app側で貼り付けて送信してください。")
      window.setTimeout(() => setCodexPromptCopied(false), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : "クリップボードコピー失敗")
    } finally {
      setIsCopyingCodexPrompt(false)
    }
  }, [isCopyingCodexPrompt, rawSentPrompt])

  const handleOpenCodexWithPrompt = useCallback(async (event?: MouseEvent<HTMLAnchorElement>) => {
    const prompt = rawSentPrompt || codexPrompt
    if (!normalizeCodexPrompt(prompt)) {
      event?.preventDefault()
      setError("Codexに渡す内容を入力してください")
      return
    }

    const target = buildCodexOpenTarget(
      {
        prompt,
        repoPath: codexRepoPath || null,
        threadUrl: node.codexThreadUrl || null,
        originUrl: typeof window !== "undefined" ? window.location.href : null,
      },
      { preferMobile: isMobileOpenTarget, mobilePlatform },
    )
    const isMobileHandoff = isMobileOpenTarget && typeof window !== "undefined"
    const shouldConfirmManualHandoff = isMobileHandoff && !!codexAiTaskId && codexUiState?.state === "prompt_waiting"
    if (shouldConfirmManualHandoff) {
      trackManualHandoff({ taskId: codexAiTaskId })
    }
    const copyAttempt = beginCopyPromptForCodexHandoff(prompt)
    const openedViaNativeApp = isMobileHandoff && target.url
      ? openCodexMobileTargetViaFocusmapNativeApp(target.url, prompt, "urls" in target ? target.urls : undefined)
      : false
    if (openedViaNativeApp) event?.preventDefault()
    if (isMobileHandoff && !openedViaNativeApp) event?.preventDefault()
    if (shouldConfirmManualHandoff && openedViaNativeApp) {
      markScreenSwitched("external_app_opened")
    }

    setError(null)
    setCodexFeedback(null)
    setIsOpeningCodex(true)

    if (isMobileHandoff) {
      copyAttempt.finished
        .then(copied => {
          setCodexPromptCopied(copied)
          setCodexFeedback(copied
            ? "プロンプトをコピーしました。Codexで貼り付けて開始してください。"
            : "Codexを開きます。コピーできない場合はFocusmapに戻って再コピーしてください。")
        })
        .catch(() => {
          setCodexFeedback("Codexを開きます。コピーできない場合はFocusmapに戻って再コピーしてください。")
        })
        .finally(() => {
          setIsOpeningCodex(false)
          if (!openedViaNativeApp && typeof window !== "undefined") {
            const navigate = () => {
              window.location.href = target.url
            }
            if (shouldConfirmManualHandoff && codexAiTaskId) {
              void confirmManualHandoffNow(codexAiTaskId, "screen_switched").finally(navigate)
            } else {
              navigate()
            }
          }
        })
      return
    }

    event?.preventDefault()
    try {
      let copiedToClipboard = await copyAttempt.finished
      if (canUseLocalCodexOpenApi()) {
        const launchOutcome = await launchCodexViaLocalApi({
          prompt,
          repoPath: codexRepoPath || null,
          threadUrl: node.codexThreadUrl || null,
        })
        if (launchOutcome.copiedToClipboard) copiedToClipboard = true
        setCodexFeedback(`${launchFeedbackForMode(launchOutcome.mode)} ${copiedToClipboard ? "プロンプトはコピー済みです。" : ""}`)
        return
      }
      if (!copiedToClipboard) {
        throw new Error("プロンプトをクリップボードにコピーできませんでした")
      }
      if (typeof window !== "undefined") {
        window.location.href = target.url
      }
      setCodexFeedback(`${launchFeedbackForMode(target.mode)} プロンプトはコピー済みです。`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codexを開けませんでした")
    } finally {
      setIsOpeningCodex(false)
    }
  }, [codexAiTaskId, codexPrompt, codexRepoPath, codexUiState?.state, confirmManualHandoffNow, isMobileOpenTarget, markScreenSwitched, mobilePlatform, node.codexThreadUrl, rawSentPrompt, trackManualHandoff])

  useEffect(() => {
    if (!open || !hasCodexRun) return
    void syncCodexState()
    const intervalMs = (
      codexUiState?.state === "running" ||
      codexUiState?.state === "prompt_waiting" ||
      codexUiState?.state === "awaiting_approval"
    )
      ? CODEX_PANEL_SYNC_INTERVAL_MS
      : CODEX_PANEL_IDLE_SYNC_INTERVAL_MS
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncCodexState()
    }, intervalMs)
    return () => window.clearInterval(intervalId)
  }, [codexUiState?.state, hasCodexRun, open, syncCodexState])

  useEffect(() => {
    const taskId = codexAiTaskId
    if (!open || !taskId || !isCodexTask) {
      setCodexActivityMessages([])
      setCodexActivityError(null)
      return
    }

    void loadCodexActivity()
    if (canUseLocalCodexOpenApi()) return

    const intervalMs = (
      codexUiState?.state === "running" ||
      codexUiState?.state === "prompt_waiting" ||
      codexUiState?.state === "awaiting_approval"
    )
      ? CODEX_PANEL_SYNC_INTERVAL_MS
      : CODEX_PANEL_IDLE_SYNC_INTERVAL_MS
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCodexActivity()
    }, intervalMs)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [codexAiTaskId, codexUiState?.state, isCodexTask, loadCodexActivity, open])

  useEffect(() => {
    const taskId = codexAiTaskId
    if (!open || !taskId || !isCodexTask) return

    const watchId = codexWatchIdRef.current ?? `node:${taskId}`
    const sendWatch = (action: "open" | "close" | "ping") => {
      void fetchWithSupabaseAuth("/api/task-progress/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: action === "close",
        body: JSON.stringify({
          task_id: taskId,
          action,
          watch_id: watchId,
          ttl_seconds: 20,
        }),
      }).catch(() => undefined)
    }

    sendWatch("open")
    const intervalId = window.setInterval(() => sendWatch("ping"), CODEX_PANEL_WATCH_PING_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
      sendWatch("close")
    }
  }, [codexAiTaskId, isCodexTask, open])

  const sendToCodex = useCallback(async (event?: MouseEvent<HTMLAnchorElement>) => {
    const promptHeading = heading || node.title
    if (!normalizeCodexPrompt(promptHeading) && !normalizeCodexPrompt(detail)) {
      event?.preventDefault()
      setError("Codexに渡す内容を入力してください")
      return
    }

    const basePrompt = buildCodexPrompt(promptHeading, detail)
    const handoffToken = buildCodexHandoffToken(node.taskId)
    const prompt = appendCodexHandoffToken(basePrompt, handoffToken)
    const repoPath = (node.cwd?.trim() || candidates.find(candidate => candidate.trim()) || "").trim()
    const openTarget = buildCodexOpenTarget(
      {
        prompt,
        repoPath: repoPath || null,
        originUrl: typeof window !== "undefined" ? window.location.href : null,
      },
      { preferMobile: isMobileOpenTarget, mobilePlatform },
    )
    const dispatchMode = "manual" as const
    const useLocalApi = canUseLocalCodexOpenApi() && !isMobileOpenTarget
    const isMobileHandoff = isMobileOpenTarget && typeof window !== "undefined"
    if (!isMobileHandoff) event?.preventDefault()
    let launchMode: CodexLaunchMode | null = null
    setError(null)
    setCodexFeedback(null)
    setCodexSendStatus("sending")

    try {
      const savePromise = saveDraft(heading, detail).catch((saveError: unknown) => {
        console.warn("[codex-node-panel] draft save failed before Codex handoff:", saveError)
      })
      const scheduleCodexTask = async () => {
        const scheduleRes = await fetchWithSupabaseAuth("/api/ai-tasks/schedule", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: prompt.length < 50_000,
          body: JSON.stringify({
            prompt,
            cwd: repoPath || null,
            approval_type: "auto",
            source_task_id: node.taskId,
            scheduled_at: new Date().toISOString(),
            executor: "codex_app",
            dispatch_mode: dispatchMode,
            codex_handoff_token: handoffToken,
          }),
        })
        if (!scheduleRes.ok && scheduleRes.status !== 409) {
          const data = await scheduleRes.json().catch(() => ({})) as { error?: string }
          throw new Error(data.error || `Codex送信準備に失敗しました (${scheduleRes.status})`)
        }
        if (scheduleRes.status === 409) {
          const data = await scheduleRes.json().catch(() => ({})) as { error?: string }
          throw new Error(data.error || "このノードは既にCodexで実行中または確認待ちです")
        }
        return await scheduleRes.json() as AiTask
      }
      const schedulePromise = scheduleCodexTask()

      const copyAttempt = beginCopyPromptForCodexHandoff(prompt)

      if (isMobileHandoff) {
        const trackedSchedulePromise = schedulePromise
          .then((task) => {
            setJustSentPrompt(prompt)
            void refreshAiTasks()
            return task
          })
          .catch((scheduleError: unknown) => {
            if (document.visibilityState === "visible") {
              setCodexSendStatus("idle")
              setError(scheduleError instanceof Error ? scheduleError.message : "Codex送信準備に失敗しました")
            }
            return null
          })
        trackManualHandoff({ taskPromise: trackedSchedulePromise })
        const openedViaNativeApp = openCodexMobileTargetViaFocusmapNativeApp(
          openTarget.url,
          prompt,
          "urls" in openTarget ? openTarget.urls : undefined,
        )
        event?.preventDefault()
        if (openedViaNativeApp) {
          markScreenSwitched("external_app_opened")
        }
        launchMode = openTarget.mode
        setJustSentPrompt(prompt)
        copyAttempt.finished
          .then(copied => {
            setCodexPromptCopied(copied)
            setCodexFeedback(copied
              ? "プロンプトをコピーしました。Codexで貼り付けて開始してください。"
              : "Codexを開きます。コピーできない場合はFocusmapに戻って再コピーしてください。")
          })
          .catch(() => {
            setCodexFeedback("Codexを開きます。コピーできない場合はFocusmapに戻って再コピーしてください。")
          })
          .finally(() => {
            setCodexSendStatus("sent")
            if (!openedViaNativeApp && typeof window !== "undefined") {
              void trackedSchedulePromise.then(task => {
                if (task) {
                  markScreenSwitched("external_app_opened")
                  window.location.href = openTarget.url
                }
              })
            }
            window.setTimeout(() => void syncCodexState(), 1200)
            window.setTimeout(() => void syncCodexState(), 3500)
          })
        return
      }

      let copiedToClipboard = copyAttempt.copiedSynchronously
      if (useLocalApi) {
        const [scheduleResult, launchResult] = await Promise.allSettled([
          schedulePromise,
          launchCodexViaLocalApi({ prompt, repoPath: repoPath || null }),
        ])
        if (launchResult.status === "rejected") {
          throw launchResult.reason instanceof Error ? launchResult.reason : new Error("Codex.appを開けませんでした")
        }
        const launchOutcome = launchResult.value
        launchMode = launchOutcome.mode
        if (launchOutcome.copiedToClipboard) copiedToClipboard = true
        if (scheduleResult.status === "fulfilled") {
          setJustSentPrompt(prompt)
          void refreshAiTasks()
        } else {
          const message = scheduleResult.reason instanceof Error
            ? scheduleResult.reason.message
            : "Codex送信準備に失敗しました"
          setError(`Codex.appは開きましたが、Focusmapの追跡登録に失敗しました。必要なら戻って再送してください。${message}`)
        }
      } else if (typeof window !== "undefined" && !isMobileHandoff) {
        await schedulePromise
        setJustSentPrompt(prompt)
        void refreshAiTasks()
        copiedToClipboard = await copyAttempt.finished
        if (!copiedToClipboard) {
          throw new Error("プロンプトをクリップボードにコピーできませんでした")
        }
        launchMode = openTarget.mode
        window.location.href = openTarget.url
      }

      void savePromise
      if (useLocalApi && !copiedToClipboard) {
        void copyAttempt.finished.then(copied => {
          if (copied) setCodexPromptCopied(true)
        })
      }
      setCodexSendStatus("sent")
      await refreshAiTasks()
      window.setTimeout(() => void syncCodexState(), 1200)
      window.setTimeout(() => void syncCodexState(), 3500)
      const copyFeedback = copiedToClipboard ? "プロンプトはコピー済みです。" : "プロンプトのコピーに失敗しました。"
      const dispatchFeedback = isMobileOpenTarget
          ? "Codexで貼り付けて開始してください。"
          : repoPath
          ? "Codex.appで内容を確認して送信してください。"
          : "リポジトリ未設定のため、Codex.appで貼り付けて開始してください。"
      setCodexFeedback(
        `${launchFeedbackForMode(launchMode ?? "browser-deep-link")} ${copyFeedback} ${dispatchFeedback}`,
      )
    } catch (err) {
      setCodexSendStatus(launchMode ? "sent" : "idle")
      setError(err instanceof Error ? err.message : "Codexに送れませんでした")
    }
  }, [candidates, detail, heading, isMobileOpenTarget, markScreenSwitched, mobilePlatform, node.cwd, node.taskId, node.title, refreshAiTasks, saveDraft, syncCodexState, trackManualHandoff])

  const showCodexSetupPrompt =
    !canUseLocalCodexOpenApi() &&
    codexRunnerStatus.checked &&
    !codexRunnerStatus.ready
  const selectedCalendar = calendarOptions.find(calendar => calendar.id === calendarId) ?? calendarOptions[0]
  const nodeMetaTags = useMemo(() => {
    const tags: string[] = []
    if (node.isDone) tags.push("完了")
    else tags.push("未完了")
    if (scheduledAt) tags.push("予定あり")
    if (estimatedMinutes && estimatedMinutes > 0) tags.push(formatDurationLabel(estimatedMinutes))
    if (attachments.length > 0) tags.push(`画像 ${attachments.length}`)
    if (node.hasMemo || detail.trim()) tags.push("メモあり")
    if (node.priority != null) tags.push(`優先度 ${node.priority}`)
    return Array.from(new Set(tags))
  }, [attachments.length, detail, estimatedMinutes, node.hasMemo, node.isDone, node.priority, scheduledAt])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void saveDraft(heading, detail)
          onClose()
        }
      }}
    >
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        onPaste={handlePanelPaste}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(moveFocusToPanel)
        }}
        className="flex max-h-[92dvh] w-[calc(100vw-1rem)] !max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-neutral-800 bg-neutral-950/98 p-0 text-neutral-50 shadow-[0_24px_80px_rgba(0,0,0,0.6)] xl:!max-w-[1280px]"
      >
        <div className="shrink-0 px-4 pb-2 pt-4 pr-12 sm:px-6">
          <DialogTitle className="text-left text-lg font-semibold text-neutral-50">メモを編集</DialogTitle>
        </div>

        <div className="shrink-0 border-b border-neutral-800 px-4 pb-4 sm:px-6">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="min-w-0 space-y-1" htmlFor="codex-memo-heading">
              <span className="text-sm text-neutral-400">見出し</span>
              <textarea
                id="codex-memo-heading"
                value={heading}
                rows={2}
                onChange={(event) => handleHeadingChange(event.target.value)}
                className="max-h-28 min-h-12 w-full resize-none overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-3 text-base leading-relaxed text-neutral-50 outline-none placeholder:text-neutral-500 focus:border-emerald-500"
                placeholder="見出し"
              />
            </label>
            <div className="min-w-0 space-y-1">
              <span className="text-sm text-neutral-400">タグ</span>
              <div className="flex min-h-12 flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/45 px-3 py-2">
                {nodeMetaTags.map(tag => (
                  <span
                    key={tag}
                    className="rounded-full border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs font-medium text-neutral-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] xl:items-start">
            <div className="space-y-4 xl:col-start-2 xl:row-start-1">
              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                  <ImagePlus className="h-4 w-4" />
                  <span>画像</span>
                  <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">{attachments.length}</span>
                </div>
                <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                  {attachments.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                      {attachments.map(attachment => {
                        const isImage = attachment.file_type?.startsWith("image/")
                        const sizeLabel = formatFileSize(attachment.file_size)
                        return (
                          <div key={attachment.id} className="group relative overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
                            {isImage ? (
                              // eslint-disable-next-line @next/next/no-img-element -- Supabase signed attachment URLs are user-generated.
                              <img src={attachment.file_url} alt={attachment.file_name} className="h-28 w-full object-cover" />
                            ) : (
                              <div className="flex h-28 items-center justify-center px-2 text-center text-xs text-neutral-400">
                                {attachment.file_name}
                              </div>
                            )}
                            <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-neutral-400">
                              <span className="min-w-0 flex-1 truncate">{attachment.file_name}</span>
                              {sizeLabel && <span className="shrink-0">{sizeLabel}</span>}
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleDeleteAttachment(attachment)}
                              disabled={deletingAttachmentId === attachment.id}
                              className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 bg-neutral-950/90 text-neutral-300 opacity-100 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100"
                              aria-label="画像を削除"
                              title="画像を削除"
                            >
                              {deletingAttachmentId === attachment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={isUploadingImage}
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(event) => {
                        event.preventDefault()
                        setIsImageDragActive(true)
                      }}
                      onDragEnter={(event) => {
                        event.preventDefault()
                        setIsImageDragActive(true)
                      }}
                      onDragLeave={() => setIsImageDragActive(false)}
                      onDrop={handleImageDrop}
                      className={`flex min-h-[72px] items-center justify-center gap-3 rounded-lg border border-dashed px-3 py-3 text-left transition-colors ${
                        isImageDragActive
                          ? "border-emerald-500 bg-emerald-500/10 text-neutral-50"
                          : "border-neutral-800 bg-neutral-900/35 text-neutral-400 hover:border-emerald-500/60 hover:text-neutral-100"
                      } ${isUploadingImage ? "cursor-wait opacity-70" : ""}`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950">
                        {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-neutral-100">画像を追加</span>
                        <span className="block text-xs leading-4">フォルダー選択 / ドラッグ&ドロップ</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isUploadingImage}
                      onClick={() => void handlePasteClipboardImage()}
                      className="flex min-h-[72px] items-center justify-center gap-3 rounded-lg border border-emerald-500/35 bg-emerald-500/5 px-3 py-3 text-left text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:opacity-70"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-neutral-950">
                        <Copy className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">クリップボード画像を貼り付け</span>
                        <span className="block text-xs leading-4 text-emerald-200/75">クリック / Cmd+V</span>
                      </span>
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFileInputChange}
                  />
                  {imageNotice && (
                    <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">{imageNotice}</p>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                  <Clock className="h-4 w-4" />
                  <span>時間・予定</span>
                  {isLoadingTaskDetail && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />}
                </div>
                <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1 text-xs text-neutral-400">
                      <span>日付</span>
                      <span className="flex min-h-11 items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/55 px-3">
                        <CalendarIcon className="h-4 w-4 shrink-0 text-neutral-500" />
                        <input
                          type="date"
                          value={dateValue}
                          onChange={handleDateChange}
                          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none [color-scheme:dark]"
                        />
                      </span>
                    </label>
                    <label className="space-y-1 text-xs text-neutral-400">
                      <span>時刻</span>
                      <span className="flex min-h-11 items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/55 px-3">
                        <Clock className="h-4 w-4 shrink-0 text-neutral-500" />
                        <input
                          type="time"
                          value={timeValue}
                          onChange={handleTimeChange}
                          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none [color-scheme:dark]"
                        />
                      </span>
                    </label>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-neutral-400">
                      <span>所要時間</span>
                      <div className="flex items-center gap-2">
                        <span>{formatDurationLabel(estimatedMinutes)}</span>
                        {estimatedMinutes ? (
                          <button
                            type="button"
                            onClick={() => handleDurationChange(null)}
                            className="min-h-7 rounded-md border border-neutral-800 bg-neutral-900/55 px-2 text-[11px] font-medium text-neutral-400 transition-colors hover:text-neutral-100"
                          >
                            解除
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {QUICK_ESTIMATED_MINUTES.map(minutes => (
                        <button
                          key={minutes}
                          type="button"
                          onClick={() => handleDurationChange(minutes)}
                          className={`min-h-9 rounded-md border px-2 text-xs font-medium transition-colors ${
                            estimatedMinutes === minutes
                              ? "border-emerald-500 bg-emerald-500 text-emerald-950"
                              : "border-neutral-800 bg-neutral-900/55 text-neutral-400 hover:text-neutral-100"
                          }`}
                        >
                          {formatDurationLabel(minutes)}
                        </button>
                      ))}
                      <DurationWheelPopover
                        valueMinutes={estimatedMinutes}
                        onChange={minutes => handleDurationChange(minutes)}
                        side="top"
                        align="end"
                        trigger={(
                          <button
                            type="button"
                            className={`min-h-9 rounded-md border px-2 text-xs font-medium transition-colors ${
                              estimatedMinutes && !(QUICK_ESTIMATED_MINUTES as readonly number[]).includes(estimatedMinutes)
                                ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                                : "border-neutral-800 bg-neutral-900/55 text-neutral-400 hover:text-neutral-100"
                            }`}
                          >
                            カスタム
                          </button>
                        )}
                      />
                    </div>
                  </div>
                  <label className="space-y-1 text-xs text-neutral-400">
                    <span>カレンダー</span>
                    <span className="relative flex min-h-11 items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/55 px-3 focus-within:border-emerald-500">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: selectedCalendar?.color ?? "#3F51B5" }}
                      />
                      <select
                        value={calendarId}
                        onChange={handleCalendarChange}
                        className="min-w-0 flex-1 appearance-none bg-transparent pr-6 text-sm text-neutral-100 outline-none [color-scheme:dark]"
                      >
                        {calendarOptions.map(calendar => (
                          <option key={calendar.id} value={calendar.id}>
                            {calendar.name}{calendar.primary ? "（主）" : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
                    </span>
                  </label>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                    <p className="min-w-0 text-xs leading-5 text-neutral-500">
                      日時・所要時間・カレンダーが揃うと登録できます。
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleRegisterSchedule()}
                      disabled={!canRegisterSchedule || isRegisteringSchedule}
                      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900/40 disabled:text-neutral-600"
                    >
                      {isRegisteringSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarIcon className="h-3.5 w-3.5" />}
                      {googleEventId ? "予定を更新" : "予定を登録"}
                    </button>
                  </div>
                  {scheduleNotice && (
                    <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                      {scheduleNotice}
                    </p>
                  )}
                </div>
              </section>
            </div>

            <div className="space-y-2 xl:col-start-1 xl:row-start-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <span className="text-sm text-muted-foreground">メモ詳細</span>
                <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
                  {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存失敗" : "保存済み"}
                </span>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2">
                {!hasCodexRun && (
                  <a
                    href={codexHref}
                    onClick={sendToCodex}
                    aria-disabled={codexSendStatus === "sending"}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-emerald-100"
                    aria-label="コピーしてCodexを開く"
                    title="コピーしてCodexを開く"
                  >
                    {codexSendStatus === "sending" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isMobileOpenTarget ? (
                      <Smartphone className="h-4 w-4" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    Codexを開く
                  </a>
                )}
                <button
                  type="button"
                  onClick={generateHeading}
                  disabled={!detail.trim() || isGeneratingHeading}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-100"
                  aria-label="見出し生成"
                  title="見出し生成"
                >
                  {isGeneratingHeading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  見出し生成
                </button>
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={isTranscribing}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
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
                </button>
              </div>
            </div>
            {hasCodexRun && (
              <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
                <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Bot className={codexUiState?.state === "running" ? "h-4 w-4 text-emerald-500" : "h-4 w-4 text-amber-500"} />
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${codexStatusClass}`}>
                      {codexUiState?.state === "running" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : codexTask?.status === "failed" ? (
                        <TriangleAlert className="h-3.5 w-3.5" />
                      ) : codexWaitingForAppSend ? (
                        <Clock className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      {codexStatusLabel}
                    </span>
                    {codexThreadId ? (
                      <span className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground" title={codexThreadId}>
                        {codexThreadId}
                      </span>
                    ) : (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                        {codexWaitingForAppSend ? "未送信" : codexManualHandoff ? "外部アプリ確認待ち" : "thread検出待ち"}
                      </span>
                    )}
                  </div>
                  {hasCodexRun && !!(rawSentPrompt || codexPrompt) && !isCodexRunning && (
                    <a
                      href={codexHref}
                      onClick={(event) => void handleOpenCodexWithPrompt(event)}
                      aria-disabled={isOpeningCodex}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-emerald-200"
                      aria-label="プロンプトをコピーしてCodexを開く"
                      title="プロンプトをコピーしてCodexを開く"
                    >
                      {isOpeningCodex ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : isMobileOpenTarget ? (
                        <Smartphone className="h-3.5 w-3.5" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      Codexを開く
                    </a>
                  )}
                  {canCopyCodexPrompt && (
                    <button
                      type="button"
                      onClick={() => void handleCopyCodexPrompt()}
                      disabled={isCopyingCodexPrompt}
                      className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-200"
                    >
                      {isCopyingCodexPrompt ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : codexPromptCopied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {codexPromptCopied ? "コピー済み" : "再コピー"}
                    </button>
                  )}
                </div>

                <div>
                  <div className="max-h-[46dvh] min-h-64 space-y-3 overflow-y-auto px-3 py-4">
                    {sentPrompt && (
                      <div className="flex justify-end">
                        <div className="max-w-[84%] rounded-2xl bg-muted px-3 py-2 text-sm leading-6 text-foreground">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {codexWaitingForAppSend ? "送信前の内容" : "送信した内容"}
                          </p>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{sentPrompt}</pre>
                        </div>
                      </div>
                    )}

                    {codexConversation.entries.length > 0 ? (
                      codexConversation.entries.map((entry, index) => {
                        if (entry.kind === "event") {
                          return (
                            <div key={`${entry.kind}-${index}-${entry.text.slice(0, 24)}`} className="flex justify-center">
                              <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">{entry.text}</span>
                            </div>
                          )
                        }
                        if (entry.kind === "user") {
                          return (
                            <div key={`${entry.kind}-${index}-${entry.text.slice(0, 24)}`} className="flex justify-end">
                              <div className="max-w-[84%] rounded-2xl bg-muted px-3 py-2 text-sm leading-6">
                                <p className="mb-1 text-xs font-medium text-muted-foreground">Codex側で追加指示</p>
                                <pre className="whitespace-pre-wrap break-words font-sans">{entry.text}</pre>
                              </div>
                            </div>
                          )
                        }
                        return (
                          <div key={`${entry.kind}-${index}-${entry.text.slice(0, 24)}`} className="flex justify-start">
                            <div className="max-w-[94%] rounded-2xl border border-amber-500/25 bg-background px-3 py-2 text-sm leading-6 shadow-sm">
                              <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">Codex出力</p>
                              <pre className="whitespace-pre-wrap break-words font-sans">{entry.text}</pre>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed bg-muted/10 px-3 py-8 text-sm text-muted-foreground">
                        {codexWaitingForAppSend
                          ? "Codex.appで送信されると、ここに返答が表示されます"
                          : codexManualHandoff && !codexThreadId
                            ? "Codex側の返答を確認してください"
                          : codexActivityError
                            ? "チャットログを取得できません"
                            : "Codex側の返答を待っています"}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            <textarea
              value={detail}
              onChange={(event) => handleDetailChange(event.target.value)}
              className={`${hasCodexRun ? "min-h-[28dvh]" : "min-h-[44dvh]"} w-full resize-y rounded-lg border border-border/70 bg-background px-4 py-3 text-base leading-relaxed outline-none focus:border-primary`}
              placeholder="メモの詳細を書いてください"
            />

            {showCodexSetupPrompt && (
              <div className="rounded-md border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-1.5 font-medium">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Mac側のCodex起動補助は未接続
                  </p>
                  <a
                    href="/dashboard/workspace/setup?step=2"
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-amber-400/50 bg-background/70 px-2.5 font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-950"
                  >
                    <Laptop className="h-3.5 w-3.5" />
                    Macセットアップ
                  </a>
                </div>
                <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-300/80">
                  今回はブラウザから外部アプリ起動を試します。Macアプリまたはlocalhostで開くと、クリップボードコピーとCodex.app起動まで安定して実行できます。
                </p>
              </div>
            )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              void saveDraft(heading, detail)
              onClose()
            }}
            className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-base font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
          >
            {saveStatus === "saving" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            保存して閉じる
          </button>

          {codexFeedback && (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-300">{codexFeedback}</p>
          )}

          {(error || voiceError) && (
            <p className="mt-3 text-sm text-rose-500">{error || voiceError}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
