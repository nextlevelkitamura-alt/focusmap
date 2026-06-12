"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type MouseEvent } from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useCodexManualHandoffConfirmation } from "@/hooks/useCodexManualHandoffConfirmation"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import { useCodexRunnerStatus } from "@/hooks/useCodexRunnerStatus"
import {
  appendCodexHandoffToken,
  beginCopyPromptForCodexHandoff,
  buildCodexOpenTarget,
  buildCodexHandoffToken,
  canUseLocalCodexOpenApi,
  copyCodexImageToClipboard,
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
import { Bot, Calendar as CalendarIcon, Check, ChevronDown, Clock, Copy, ExternalLink, ImagePlus, Laptop, Loader2, Mic, Save, Smartphone, Sparkles, Square, Trash2, TriangleAlert, X } from "lucide-react"
import { DurationWheelPopover } from "@/components/ui/duration-wheel-popover"
import { useCalendars } from "@/hooks/useCalendars"
import { OPEN_TODAY_CALENDAR_EVENT, type OpenTodayCalendarEventDetail } from "@/lib/calendar-constants"
import type { Task, TaskAttachment } from "@/types/database"
import { compressImageFileForUpload, MAX_UPLOAD_IMAGE_BYTES } from "@/lib/image-compression"

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
}

type SaveStatus = "saved" | "saving" | "error"
type CodexSendStatus = "idle" | "sending" | "sent"

type CodexChatEntry = {
  kind: "assistant" | "event" | "user" | "process"
  text: string
}

const CODEX_PANEL_SYNC_INTERVAL_MS = 3_000
const CODEX_PANEL_IDLE_SYNC_INTERVAL_MS = 60 * 60_000
const CODEX_PANEL_WATCH_PING_INTERVAL_MS = 10_000
const CODEX_DISPLAY_LOG_CHARS = 80_000
const QUICK_ESTIMATED_MINUTES = [5, 15, 30, 60, 120] as const
const DEFAULT_ESTIMATED_MINUTES = 15

type TaskAttachmentPreview = Pick<TaskAttachment, "id" | "file_name" | "file_url" | "file_type" | "file_size">
type PendingTaskAttachmentPreview = TaskAttachmentPreview & {
  is_pending: true
}

function isPendingTaskAttachmentPreview(
  attachment: TaskAttachmentPreview | PendingTaskAttachmentPreview,
): attachment is PendingTaskAttachmentPreview {
  return "is_pending" in attachment
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function buildCodexPrompt(heading: string, detail: string) {
  const normalizedHeading = normalizeCodexPrompt(heading)
  const normalizedDetail = normalizeCodexPrompt(detail)
  return [normalizedHeading, normalizedDetail].filter(Boolean).join("\n")
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

function createPendingAttachmentId(file: File, index: number) {
  return `pending-${Date.now()}-${index}-${file.name}`
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
}: CodexNodePanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const isMobile = useIsMobile()
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
  const codexRunnerStatus = useCodexRunnerStatus(open)
  const [codexActivityMessages, setCodexActivityMessages] = useState<AiTaskActivityMessage[]>([])
  const [codexActivityError, setCodexActivityError] = useState<string | null>(null)
  const [isCopyingCodexPrompt, setIsCopyingCodexPrompt] = useState(false)
  const [isOpeningCodex, setIsOpeningCodex] = useState(false)
  const [codexPromptCopied, setCodexPromptCopied] = useState(false)
  const [copyingCodexImageId, setCopyingCodexImageId] = useState<string | null>(null)
  const [codexImageCopyNotice, setCodexImageCopyNotice] = useState<string | null>(null)
  const [isMobileOpenTarget, setIsMobileOpenTarget] = useState(false)
  const [mobilePlatform, setMobilePlatform] = useState<MobilePlatform>("desktop")
  const [isGeneratingHeading, setIsGeneratingHeading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const [estimatedMinutes, setEstimatedMinutes] = useState<number | null>(DEFAULT_ESTIMATED_MINUTES)
  const [calendarId, setCalendarId] = useState("")
  const [isRegisteringSchedule, setIsRegisteringSchedule] = useState(false)
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<TaskAttachmentPreview[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PendingTaskAttachmentPreview[]>([])
  const [isLoadingTaskDetail, setIsLoadingTaskDetail] = useState(false)
  const [isUploadingImage, setIsUploadingImage] = useState(false)
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null)
  const [imageNotice, setImageNotice] = useState<string | null>(null)
  const [previewAttachment, setPreviewAttachment] = useState<TaskAttachmentPreview | PendingTaskAttachmentPreview | null>(null)
  const [isImageDragActive, setIsImageDragActive] = useState(false)
  const saveVersionRef = useRef(0)
  const codexWatchIdRef = useRef<string | null>(null)
  const codexSyncInFlightRef = useRef(false)
  const pendingAttachmentUrlsRef = useRef<Set<string>>(new Set())

  const releasePendingAttachmentUrl = useCallback((previewUrl: string) => {
    if (!previewUrl || !pendingAttachmentUrlsRef.current.has(previewUrl)) return
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrl)
    }
    pendingAttachmentUrlsRef.current.delete(previewUrl)
  }, [])

  const createPendingAttachments = useCallback((files: File[]) => {
    return files.map((file, index): PendingTaskAttachmentPreview => {
      const previewUrl = typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : ""
      if (previewUrl) pendingAttachmentUrlsRef.current.add(previewUrl)
      return {
        id: createPendingAttachmentId(file, index),
        file_name: file.name,
        file_url: previewUrl,
        file_type: file.type,
        file_size: file.size,
        is_pending: true,
      }
    })
  }, [])

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
    setCodexActivityMessages([])
    setCodexActivityError(null)
    setIsCopyingCodexPrompt(false)
    setIsOpeningCodex(false)
    setCodexPromptCopied(false)
    setCopyingCodexImageId(null)
    setCodexImageCopyNotice(null)
    setIsGeneratingHeading(false)
    setSaveStatus("saved")
    setIsRegisteringSchedule(false)
    setScheduleNotice(null)
    setImageNotice(null)
    setPreviewAttachment(null)
    setIsImageDragActive(false)
    setPendingAttachments(prev => {
      prev.forEach(attachment => releasePendingAttachmentUrl(attachment.file_url))
      return []
    })
  }, [open, node.taskId, node.title, node.memo, releasePendingAttachmentUrl])

  useEffect(() => {
    const pendingUrls = pendingAttachmentUrlsRef.current
    return () => {
      pendingUrls.forEach(previewUrl => {
        if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(previewUrl)
        }
      })
      pendingUrls.clear()
    }
  }, [])

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
          const loadedEstimatedMinutes = taskData.task.estimated_time
          setEstimatedMinutes(
            loadedEstimatedMinutes && loadedEstimatedMinutes > 0
              ? loadedEstimatedMinutes
              : DEFAULT_ESTIMATED_MINUTES,
          )
          setCalendarId(taskData.task.calendar_id ?? "")
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
    if (!previewAttachment) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewAttachment(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [previewAttachment])

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
  }, [calendarId, calendarOptions, open])

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
      }
      setSaveStatus("saved")
      return true
    } catch (err) {
      setSaveStatus("error")
      setError(err instanceof Error ? err.message : "タスク詳細の保存に失敗しました")
      return false
    }
  }, [node.taskId, onSaveTaskDetails])

  const handleDurationChange = useCallback((minutes: number | null) => {
    setEstimatedMinutes(minutes)
    void patchTaskDetail({ estimated_time: minutes })
  }, [patchTaskDetail])

  const handleCalendarChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const nextCalendarId = event.target.value
    setCalendarId(nextCalendarId)
    void patchTaskDetail({ calendar_id: nextCalendarId.trim() || null })
  }, [patchTaskDetail])

  const canRegisterSchedule = Boolean(estimatedMinutes && estimatedMinutes > 0 && calendarId.trim())

  const handleRegisterSchedule = useCallback(async () => {
    if (!estimatedMinutes || estimatedMinutes <= 0 || !calendarId.trim()) {
      setError("所要時間とカレンダーを選択してください")
      return
    }

    const targetCalendarId = calendarId.trim()
    setError(null)
    setScheduleNotice(null)
    setIsRegisteringSchedule(true)
    try {
      const saved = await patchTaskDetail({
        estimated_time: estimatedMinutes,
        calendar_id: targetCalendarId,
      })
      if (!saved) return
      window.dispatchEvent(new CustomEvent<OpenTodayCalendarEventDetail>(OPEN_TODAY_CALENDAR_EVENT, {
        detail: {
          source: "mindmap-node-panel",
          taskId: node.taskId,
        },
      }))
      setScheduleNotice("カレンダーで予定を入れられます")
      setSaveStatus("saved")
      onClose()
    } catch (err) {
      setSaveStatus("error")
      setError(err instanceof Error ? err.message : "予定の準備に失敗しました")
    } finally {
      setIsRegisteringSchedule(false)
    }
  }, [calendarId, estimatedMinutes, node.taskId, onClose, patchTaskDetail])

  const uploadImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith("image/"))
    if (imageFiles.length === 0) {
      setImageNotice("画像ファイルを選択してください")
      return
    }
    const pendingUploads = createPendingAttachments(imageFiles)
    const pendingIds = new Set(pendingUploads.map(attachment => attachment.id))
    setError(null)
    setImageNotice(null)
    setPendingAttachments(prev => [...pendingUploads, ...prev])
    setIsUploadingImage(true)
    try {
      const compressedFiles = await Promise.all(imageFiles.map(file => compressImageFileForUpload(file)))
      const oversizedFile = compressedFiles.find(file => file.size > MAX_UPLOAD_IMAGE_BYTES)
      if (oversizedFile) {
        throw new Error("画像を300KB以下に圧縮できませんでした。小さい画像を選んでください")
      }

      const uploaded = await Promise.allSettled(compressedFiles.map(async file => {
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
        return data.attachment
      }))
      const succeeded = uploaded
        .filter((result): result is PromiseFulfilledResult<TaskAttachmentPreview> => result.status === "fulfilled")
      const failed = uploaded.filter(result => result.status === "rejected")

      pendingUploads.forEach(attachment => releasePendingAttachmentUrl(attachment.file_url))
      setPendingAttachments(prev => prev.filter(attachment => !pendingIds.has(attachment.id)))
      if (succeeded.length > 0) {
        setAttachments(prev => [...prev, ...succeeded.map(result => result.value)])
        setImageNotice(`${succeeded.length}件の画像を追加しました`)
      }
      if (failed.length > 0) {
        const firstError = failed[0].reason
        throw new Error(firstError instanceof Error ? firstError.message : "一部の画像の追加に失敗しました")
      }
    } catch (err) {
      pendingUploads.forEach(attachment => releasePendingAttachmentUrl(attachment.file_url))
      setPendingAttachments(prev => prev.filter(attachment => !pendingIds.has(attachment.id)))
      setError(err instanceof Error ? err.message : "画像の追加に失敗しました")
    } finally {
      setIsUploadingImage(false)
      setIsImageDragActive(false)
    }
  }, [createPendingAttachments, node.taskId, releasePendingAttachmentUrl])

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
    setPreviewAttachment(prev => prev?.id === attachment.id ? null : prev)
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
  const codexCopyableImages = useMemo(
    () => attachments.filter(attachment => attachment.file_type?.startsWith("image/") && attachment.file_url?.trim()),
    [attachments],
  )
  const displayedAttachments: Array<TaskAttachmentPreview | PendingTaskAttachmentPreview> = [...pendingAttachments, ...attachments]
  const isWaitingForImageSave = isUploadingImage || pendingAttachments.length > 0
  const isCodexRunnerUnavailable = !codexRunnerStatus.ready
  const codexRunnerUnavailableMessage = codexRunnerStatus.loading || !codexRunnerStatus.checked
    ? "Macの通信状態を確認中です。確認後にCodexへ送れます。"
    : "Macがオンラインではありません。Focusmap Macを起動するとCodexへ送れます。"
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
    codexWaitingForAppSend
        ? "未送信"
        : codexTask?.status === "failed"
          ? "接続失敗"
          : codexUiState?.state === "prompt_waiting"
            ? "未送信"
            : codexUiState?.state === "running"
              ? "Codex実行中"
              : codexUiState?.state === "completed"
              ? "完了済み"
              : codexTask?.status === "completed" && codexUiState?.state !== "awaiting_approval"
                ? "完了済み"
              : codexUiState?.state === "awaiting_approval" || codexTask?.status === "awaiting_approval"
              ? "確認待ち"
              : codexThreadId
                ? "送信確認済み"
                : "Codexで確認"
  const codexStatusClass =
    codexTask?.status === "failed"
      ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
      : codexUiState?.state === "completed" || (codexTask?.status === "completed" && codexUiState?.state !== "awaiting_approval")
        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
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

  const handleCopyCodexImage = useCallback(async (image: TaskAttachmentPreview) => {
    if (!image.file_url.trim() || copyingCodexImageId) return
    setCopyingCodexImageId(image.id)
    setError(null)
    try {
      const result = await copyCodexImageToClipboard(image.file_url)
      if (!result.copiedImageToClipboard) {
        throw new Error("画像をクリップボードにコピーできませんでした")
      }
      setCodexImageCopyNotice("画像をコピーしました。同じCodex入力欄へ貼り付けてください。")
    } catch (err) {
      setError(err instanceof Error ? err.message : "画像をクリップボードにコピーできませんでした")
      setCodexImageCopyNotice(null)
    } finally {
      setCopyingCodexImageId(null)
    }
  }, [copyingCodexImageId])

  const handleOpenCodexWithPrompt = useCallback(async (event?: MouseEvent<HTMLAnchorElement>) => {
    const prompt = rawSentPrompt || codexPrompt
    if (isWaitingForImageSave) {
      event?.preventDefault()
      setCodexFeedback("画像を保存中です。保存が終わるとCodexへ送れます。")
      return
    }
    if (isCodexRunnerUnavailable) {
      event?.preventDefault()
      setCodexFeedback(codexRunnerUnavailableMessage)
      return
    }
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
      if (openedViaNativeApp) {
        setCodexPromptCopied(true)
        setCodexFeedback(codexCopyableImages.length > 0
          ? "プロンプトをコピーしました。画像は画像欄のコピーアイコンから同じCodex入力欄へ貼り付けてください。"
          : "プロンプトをコピーしました。Codexで貼り付けて開始してください。")
        setIsOpeningCodex(false)
        return
      }
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
  }, [codexAiTaskId, codexCopyableImages.length, codexPrompt, codexRepoPath, codexRunnerUnavailableMessage, codexUiState?.state, confirmManualHandoffNow, isCodexRunnerUnavailable, isMobileOpenTarget, isWaitingForImageSave, markScreenSwitched, mobilePlatform, node.codexThreadUrl, rawSentPrompt, trackManualHandoff])

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
    if (isWaitingForImageSave) {
      event?.preventDefault()
      setCodexFeedback("画像を保存中です。保存が終わるとCodexへ送れます。")
      return
    }
    if (isCodexRunnerUnavailable) {
      event?.preventDefault()
      setCodexFeedback(codexRunnerUnavailableMessage)
      return
    }
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
          launchMode = openTarget.mode
          setJustSentPrompt(prompt)
          setCodexPromptCopied(true)
          setCodexFeedback(codexCopyableImages.length > 0
            ? "プロンプトをコピーしました。画像は画像欄のコピーアイコンから同じCodex入力欄へ貼り付けてください。"
            : "プロンプトをコピーしました。Codexで貼り付けて開始してください。")
          setCodexSendStatus("sent")
          window.setTimeout(() => void syncCodexState(), 1200)
          window.setTimeout(() => void syncCodexState(), 3500)
          return
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
      if (codexCopyableImages.length > 0) {
        setCodexImageCopyNotice("プロンプトを貼った後、画像欄のコピーアイコンから同じCodex入力欄へ貼り付けてください。")
      }
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
  }, [candidates, codexCopyableImages.length, codexRunnerUnavailableMessage, detail, heading, isCodexRunnerUnavailable, isMobileOpenTarget, isWaitingForImageSave, markScreenSwitched, mobilePlatform, node.cwd, node.taskId, node.title, refreshAiTasks, saveDraft, syncCodexState, trackManualHandoff])

  const showCodexSetupPrompt = codexRunnerStatus.checked && !codexRunnerStatus.ready
  const initialCodexSendDisabled = codexSendStatus === "sending" || isWaitingForImageSave || isCodexRunnerUnavailable
  const codexOpenDisabled = isOpeningCodex || isWaitingForImageSave || isCodexRunnerUnavailable
  const selectedCalendar = calendarOptions.find(calendar => calendar.id === calendarId) ?? calendarOptions[0]
  const previewAttachmentLabel = previewAttachment?.file_name?.trim() || "画像"
  const previewAttachmentSizeLabel = previewAttachment ? formatFileSize(previewAttachment.file_size) : null
  const previewCopyAttachment = previewAttachment && !isPendingTaskAttachmentPreview(previewAttachment)
    ? previewAttachment
    : null
  const canCopyPreviewAttachment = Boolean(
    previewCopyAttachment?.file_type?.startsWith("image/") && previewCopyAttachment.file_url?.trim(),
  )
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          void saveDraft(heading, detail)
          onClose()
        }
      }}
    >
      <SheetContent
        ref={contentRef}
        tabIndex={-1}
        side={isMobile ? "bottom" : "right"}
        onPaste={handlePanelPaste}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(moveFocusToPanel)
        }}
        className={cn(
          "gap-0 overflow-hidden overflow-x-hidden border-neutral-800 bg-neutral-950/98 p-0 text-neutral-50 shadow-[0_24px_80px_rgba(0,0,0,0.6)]",
          isMobile
            ? "max-h-[88dvh] rounded-t-2xl"
            : "h-full w-[min(92vw,460px)] max-w-none sm:max-w-none"
        )}
      >
        <SheetTitle className="sr-only">メモを編集</SheetTitle>
        <SheetDescription className="sr-only">
          マインドマップノードの見出し、メモ、所要時間、画像、Codex実行を編集します。
        </SheetDescription>

        <div className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-x-none px-4 pb-3 pt-4 sm:px-6 [touch-action:pan-y]">
          <div className="grid min-w-0 gap-3 xl:items-start">
            <section className="order-1 min-w-0 space-y-1.5 pr-9" data-testid="codex-node-heading-section">
              <label className="block text-xs font-medium text-neutral-400" htmlFor="codex-memo-heading">
                見出し
              </label>
              <input
                id="codex-memo-heading"
                value={heading}
                onChange={(event) => handleHeadingChange(event.target.value)}
                className="h-11 w-full min-w-0 rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 text-[15px] leading-none text-neutral-50 outline-none placeholder:text-neutral-500 focus:border-emerald-500"
                placeholder="見出し"
              />
            </section>

            <section
              className="order-2 min-w-0 space-y-1.5"
              data-testid="codex-node-detail-section"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs font-medium text-neutral-400">メモ詳細</span>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground" aria-live="polite">
                    {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存失敗" : "保存済み"}
                  </span>
                </div>
                <div className="flex shrink-0 items-center justify-end gap-1.5">
                  {(detail.trim() || isGeneratingHeading) ? (
                    <button
                      type="button"
                      onClick={generateHeading}
                      disabled={!detail.trim() || isGeneratingHeading}
                      className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/18 disabled:opacity-50"
                      aria-label="見出し生成"
                      title="見出し生成"
                    >
                      {isGeneratingHeading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      <span className="truncate">見出し生成</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={toggleVoiceInput}
                    disabled={isTranscribing}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900/70 text-neutral-200 transition-colors hover:bg-neutral-800 disabled:opacity-50"
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
              <textarea
                value={detail}
                onChange={(event) => handleDetailChange(event.target.value)}
	                className={cn(
	                  "w-full max-w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900/55 px-3 py-2.5 text-[15px] leading-6 text-neutral-50 outline-none placeholder:text-neutral-500 focus:border-emerald-500",
	                  hasCodexRun ? "min-h-24 sm:min-h-[18dvh]" : "min-h-28 sm:min-h-[22dvh]",
	                )}
                placeholder="メモの詳細を書いてください"
              />
            </section>

            <section
              className="order-5 min-w-0 space-y-2"
              data-testid="codex-node-image-section"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                <ImagePlus className="h-4 w-4" />
                <span>画像</span>
                <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-400">{displayedAttachments.length}</span>
              </div>
	              <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2.5">
	                {displayedAttachments.length > 0 && (
	                  <div className="grid min-w-0 gap-2">
	                    {displayedAttachments.map(attachment => {
	                      const isPending = isPendingTaskAttachmentPreview(attachment)
	                      const isImage = attachment.file_type?.startsWith("image/")
	                      const sizeLabel = formatFileSize(attachment.file_size)
	                      const label = attachment.file_name?.trim() || "画像"
	                      const canPreview = isImage && !!attachment.file_url?.trim()
	                      const savedAttachment = isPending ? null : attachment
	                      const canCopyImage = !!savedAttachment && canPreview
	                      const isCopyingImage = copyingCodexImageId === attachment.id
	                      return (
	                        <div
	                          key={attachment.id}
	                          data-testid={isPending ? "pending-task-attachment" : undefined}
	                          className={cn(
	                            "grid min-h-[68px] min-w-0 grid-cols-[72px_minmax(0,1fr)_40px_34px] items-center gap-2 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/85 p-1.5 transition-opacity",
	                            isPending && "opacity-45",
	                          )}
	                        >
	                          <button
	                            type="button"
	                            disabled={!canPreview}
	                            onClick={() => canPreview && setPreviewAttachment(attachment)}
	                            className="col-span-2 grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-center gap-2 rounded-md text-left transition-colors hover:bg-neutral-800/55 disabled:cursor-default disabled:hover:bg-transparent"
	                            aria-label={`${label}をプレビュー`}
	                            title={canPreview ? `${label}をプレビュー` : label}
	                          >
	                            <span className="flex h-14 w-[72px] items-center justify-center overflow-hidden rounded-md bg-neutral-950">
	                              {isImage && attachment.file_url ? (
	                                // eslint-disable-next-line @next/next/no-img-element -- Supabase signed attachment URLs are user-generated.
	                                <img src={attachment.file_url} alt={label} className="h-full w-full object-cover transition-transform hover:scale-[1.03]" />
	                              ) : (
	                                <ImagePlus className="h-4 w-4 text-neutral-500" />
	                              )}
	                            </span>
	                            <span className="min-w-0 text-left">
	                              <span className="block truncate text-sm font-medium text-neutral-100">{label}</span>
	                              <span className="block truncate text-[11px] leading-4 text-neutral-500">
	                                {isPending ? "保存中" : sizeLabel ?? "サイズ未取得"}
	                              </span>
	                            </span>
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => savedAttachment && void handleCopyCodexImage(savedAttachment)}
	                            disabled={!canCopyImage || !!copyingCodexImageId}
	                            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-neutral-700 bg-neutral-950 text-neutral-200 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45"
	                            aria-label={`${label}をCodex貼り付け用にコピー`}
	                            title={`${label}をコピー`}
	                          >
	                            {isCopyingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
	                          </button>
	                          {isPending ? (
	                            <span className="inline-flex h-9 w-9 items-center justify-center text-neutral-500">
	                              <Loader2 className="h-4 w-4 animate-spin" />
	                            </span>
	                          ) : (
	                            <button
	                              type="button"
	                              onClick={() => void handleDeleteAttachment(attachment)}
	                              disabled={deletingAttachmentId === attachment.id}
	                              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-red-500/10 hover:text-red-200 disabled:opacity-50"
	                              aria-label="画像を削除"
	                              title="画像を削除"
	                            >
                              {deletingAttachmentId === attachment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      )
                    })}
	                  </div>
	                )}
	                <div className={cn("grid min-w-0 gap-2", !isMobile && "sm:grid-cols-2")}>
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
	                    className={cn(
	                      "flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors",
	                      isImageDragActive
	                        ? "border-emerald-500 bg-emerald-500/10 text-neutral-50"
	                        : "border-neutral-800 bg-neutral-900/35 text-neutral-400 hover:border-emerald-500/60 hover:text-neutral-100",
                      isUploadingImage && "cursor-wait opacity-70",
	                    )}
	                  >
	                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950">
	                      {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
	                    </span>
	                    <span className="min-w-0">
	                      <span className="block text-sm font-semibold text-neutral-100">画像を追加</span>
	                      <span className="block text-[11px] leading-4">{isMobile ? "写真 / 撮影" : "選択 / D&D"}</span>
	                    </span>
	                  </button>
                  {!isMobile && (
                    <button
	                      type="button"
	                      disabled={isUploadingImage}
	                      onClick={() => void handlePasteClipboardImage()}
	                      className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/5 px-3 py-2 text-left text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:opacity-70"
	                      aria-label="クリップボード画像を貼り付け"
	                    >
	                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/35 bg-neutral-950">
	                        <Copy className="h-4 w-4" />
	                      </span>
	                      <span className="min-w-0">
	                        <span className="block text-sm font-semibold">クリップボード</span>
	                        <span className="block text-[11px] leading-4 text-emerald-200/75">クリック / Cmd+V</span>
	                      </span>
	                    </button>
                  )}
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
	                {codexImageCopyNotice && (
	                  <p className="rounded-md border border-sky-500/25 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">{codexImageCopyNotice}</p>
	                )}
	              </div>
            </section>

	            <section
	              className="order-3 min-w-0 space-y-1.5"
	              data-testid="codex-node-schedule-section"
	            >
	              <div className="flex items-center gap-2 text-sm font-semibold text-neutral-200">
	                <CalendarIcon className="h-4 w-4 text-emerald-300" />
	                <span>予定</span>
	                {isLoadingTaskDetail && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-500" />}
	              </div>
	              <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-950 p-2.5">
	                  <div className="space-y-1">
	                    <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-neutral-400">
	                      <span>所要時間</span>
	                      <span>{formatDurationLabel(estimatedMinutes)}</span>
	                    </div>
	                    <div className="grid grid-cols-3 gap-1.5">
	                      {QUICK_ESTIMATED_MINUTES.map(minutes => (
	                        <button
	                          key={minutes}
	                          type="button"
	                          onClick={() => handleDurationChange(minutes)}
	                          className={`min-h-9 rounded-md border px-2 text-xs font-semibold transition-colors ${
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
	                            className={`min-h-9 rounded-md border px-2 text-xs font-semibold transition-colors ${
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
	                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
	                  <label className="min-w-0 space-y-1 text-xs text-neutral-400">
	                    <span>カレンダー</span>
	                    <span className="relative flex min-h-10 items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900/55 px-3 focus-within:border-emerald-500">
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
	                  <button
	                    type="button"
	                    onClick={() => void handleRegisterSchedule()}
	                    disabled={!canRegisterSchedule || isRegisteringSchedule}
	                    className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-500/45 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900/40 disabled:text-neutral-600 sm:w-auto"
	                  >
	                    {isRegisteringSchedule ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarIcon className="h-3.5 w-3.5" />}
	                    予定を入れる
	                  </button>
	                </div>
	                {scheduleNotice && (
	                  <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
	                    {scheduleNotice}
	                  </p>
	                )}
	              </div>
	            </section>

            <section
              className="order-4 min-w-0 space-y-2"
              data-testid="codex-node-codex-section"
            >
              <div className="flex items-center gap-2 text-sm font-medium text-neutral-300">
                <Bot className="h-4 w-4" />
                <span>Codex</span>
              </div>
              {!hasCodexRun && (
                <a
                  href={codexHref}
                  onClick={sendToCodex}
                  aria-disabled={initialCodexSendDisabled}
                  className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-50 px-4 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  aria-label="コピーしてCodexに送る"
                  title={isCodexRunnerUnavailable ? codexRunnerUnavailableMessage : "コピーしてCodexに送る"}
                >
                  {codexSendStatus === "sending" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : isMobileOpenTarget ? (
                    <Smartphone className="h-4 w-4" />
                  ) : (
                    <ExternalLink className="h-4 w-4" />
                  )}
                  Codexに送る
                </a>
              )}
	              {hasCodexRun && (
                <section className="min-w-0 overflow-hidden overflow-x-hidden rounded-lg border border-border/70 bg-card">
                  <div className="flex min-w-0 flex-col gap-2 border-b border-border/60 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
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
                        <span className="min-w-0 max-w-full truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground" title={codexThreadId}>
                          {codexThreadId}
                        </span>
                      ) : (
                        <span className="min-w-0 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {codexWaitingForAppSend ? "未送信" : codexManualHandoff ? "外部アプリ確認待ち" : "thread検出待ち"}
                        </span>
                      )}
                    </div>
                    <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                      {hasCodexRun && !!(rawSentPrompt || codexPrompt) && !isCodexRunning && (
                        <a
                          href={codexHref}
                          onClick={(event) => void handleOpenCodexWithPrompt(event)}
                          aria-disabled={codexOpenDisabled}
                          className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 aria-disabled:pointer-events-none aria-disabled:opacity-50 sm:flex-none dark:text-emerald-200"
                          aria-label="プロンプトをコピーしてCodexを開く"
                          title={isCodexRunnerUnavailable ? codexRunnerUnavailableMessage : "プロンプトをコピーしてCodexを開く"}
                        >
                          {isOpeningCodex ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isMobileOpenTarget ? (
                            <Smartphone className="h-3.5 w-3.5" />
                          ) : (
                            <ExternalLink className="h-3.5 w-3.5" />
                          )}
                          <span className="truncate">Codexを開く</span>
                        </a>
                      )}
                      {canCopyCodexPrompt && (
                        <button
                          type="button"
                          onClick={() => void handleCopyCodexPrompt()}
                          disabled={isCopyingCodexPrompt}
                          className="inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-500/20 disabled:opacity-50 sm:flex-none dark:text-sky-200"
                        >
                          {isCopyingCodexPrompt ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : codexPromptCopied ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          <span className="truncate">{codexPromptCopied ? "コピー済み" : "再コピー"}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="max-h-[46dvh] min-h-48 min-w-0 space-y-3 overflow-y-auto overflow-x-hidden px-3 py-4 sm:min-h-64">
                    {sentPrompt && (
                      <div className="flex min-w-0 justify-end">
                        <div className="min-w-0 max-w-[92%] rounded-2xl bg-muted px-3 py-2 text-sm leading-6 text-foreground sm:max-w-[84%]">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {codexWaitingForAppSend ? "送信前の内容" : "送信した内容"}
                          </p>
                          <pre className="max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">{sentPrompt}</pre>
                        </div>
                      </div>
                    )}

                    {codexConversation.entries.length > 0 ? (
                      codexConversation.entries.map((entry, index) => {
                        if (entry.kind === "event") {
                          return (
                            <div key={`${entry.kind}-${index}-${entry.text.slice(0, 24)}`} className="flex min-w-0 justify-center">
                              <span className="max-w-full rounded-full border bg-muted/40 px-3 py-1 text-center text-xs text-muted-foreground break-words [overflow-wrap:anywhere]">{entry.text}</span>
                            </div>
                          )
                        }
                        if (entry.kind === "user") {
                          return (
                            <div key={`${entry.kind}-${index}-${entry.text.slice(0, 24)}`} className="flex min-w-0 justify-end">
                              <div className="min-w-0 max-w-[92%] rounded-2xl bg-muted px-3 py-2 text-sm leading-6 sm:max-w-[84%]">
                                <p className="mb-1 text-xs font-medium text-muted-foreground">Codex側で追加指示</p>
                                <pre className="whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">{entry.text}</pre>
                              </div>
                            </div>
                          )
                        }
                        return (
                          <div key={`${entry.kind}-${index}-${entry.text.slice(0, 24)}`} className="flex min-w-0 justify-start">
                            <div className="min-w-0 max-w-[96%] rounded-2xl border border-amber-500/25 bg-background px-3 py-2 text-sm leading-6 shadow-sm">
                              <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">Codex出力</p>
                              <pre className="whitespace-pre-wrap break-words font-sans [overflow-wrap:anywhere]">{entry.text}</pre>
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className="flex min-h-32 min-w-0 items-center justify-center rounded-md border border-dashed bg-muted/10 px-3 py-8 text-sm text-muted-foreground">
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
                </section>
              )}

              {isWaitingForImageSave && (
                <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                  画像を保存中です。保存が終わるとCodexへ送れます。画像は保存後にコピーできます。
                </p>
              )}

              {showCodexSetupPrompt && (
                <div className="min-w-0 rounded-md border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex min-w-0 items-center gap-1.5 font-medium">
                      <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0">Mac側のCodex起動補助は未接続</span>
                    </p>
                    <a
                      href="/dashboard/workspace/setup?step=2"
                      className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-amber-400/50 bg-background/70 px-2.5 font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-950"
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
            </section>

          </div>

          <button
            type="button"
            onClick={() => {
              void saveDraft(heading, detail)
              onClose()
            }}
            className="sticky bottom-0 z-10 mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-4 text-base font-semibold text-neutral-950 shadow-[0_-18px_30px_rgba(10,10,10,0.85)] transition-colors hover:bg-white disabled:opacity-50"
          >
            {saveStatus === "saving" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            保存
          </button>

          {codexFeedback && (
            <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-300">{codexFeedback}</p>
          )}

	          {(error || voiceError) && (
	            <p className="mt-3 text-sm text-rose-500">{error || voiceError}</p>
	          )}
	        </div>
	        {previewAttachment && (
	          <div
	            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 px-3 py-6 backdrop-blur-sm"
	            role="dialog"
	            aria-modal="true"
	            aria-label={`${previewAttachmentLabel}のプレビュー`}
	            onClick={() => setPreviewAttachment(null)}
	          >
	            <div
	              className="flex max-h-[88dvh] w-[min(92vw,920px)] max-w-none flex-col overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-2xl"
	              onClick={event => event.stopPropagation()}
	            >
	              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-neutral-800 px-3 py-2">
	                <div className="min-w-0">
	                  <p className="truncate text-sm font-semibold text-neutral-100" title={previewAttachmentLabel}>
	                    {previewAttachmentLabel}
	                  </p>
	                  {previewAttachmentSizeLabel && (
	                    <p className="text-[11px] text-neutral-500">{previewAttachmentSizeLabel}</p>
	                  )}
	                </div>
	                <div className="flex shrink-0 items-center gap-2">
	                  <button
	                    type="button"
	                    onClick={() => previewCopyAttachment && void handleCopyCodexImage(previewCopyAttachment)}
	                    disabled={!canCopyPreviewAttachment || !!copyingCodexImageId}
	                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-200 transition-colors hover:border-emerald-500/50 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-45"
	                    aria-label={`${previewAttachmentLabel}をCodex貼り付け用にコピー`}
	                    title={`${previewAttachmentLabel}をコピー`}
	                  >
	                    {copyingCodexImageId === previewAttachment.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
	                  </button>
	                  <button
	                    type="button"
	                    onClick={() => setPreviewAttachment(null)}
	                    className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900 text-neutral-200 transition-colors hover:bg-neutral-800"
	                    aria-label="プレビューを閉じる"
	                    title="閉じる"
	                  >
	                    <X className="h-4 w-4" />
	                  </button>
	                </div>
	              </div>
	              <div className="min-h-0 bg-black/55 p-3">
	                {/* eslint-disable-next-line @next/next/no-img-element -- Supabase signed attachment URLs are user-generated. */}
	                <img
	                  src={previewAttachment.file_url}
	                  alt={previewAttachmentLabel}
	                  className="max-h-[72dvh] w-full rounded-lg object-contain"
	                  draggable={false}
	                />
	              </div>
	            </div>
	          </div>
	        )}
	      </SheetContent>
    </Sheet>
  )
}
