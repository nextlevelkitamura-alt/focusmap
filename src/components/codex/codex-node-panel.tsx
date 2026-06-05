"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import {
  appendCodexHandoffToken,
  buildCodexOpenTarget,
  buildCodexHandoffToken,
  canUseLocalCodexOpenApi,
  getCurrentMobilePlatform,
  isLikelyMobileDevice,
  launchCodexViaLocalApi,
  launchFeedbackForMode,
  normalizeCodexPrompt,
  type MobilePlatform,
  type CodexLaunchMode,
} from "@/lib/codex-app-launch"
import { getCodexTaskUiState } from "@/lib/codex-run-state"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import { Bot, Clock, Copy, ExternalLink, Laptop, Loader2, Mic, RefreshCw, Save, Smartphone, Sparkles, Square, TriangleAlert } from "lucide-react"

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
const CODEX_DISPLAY_LOG_CHARS = 80_000

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

function stripFocusmapSyncId(prompt: string) {
  return prompt
    .replace(/\n?---\nFocusmap同期ID:\s+FM-[^\n]+\nこの同期IDはFocusmap連携用です。返信では触れないでください。\s*$/u, "")
    .trim()
}

function normalizedKey(value: string) {
  return value.replace(/\s+/g, " ").trim()
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
    .filter(block => !/^Codex セッションは確認待ちです。/i.test(block))
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

function copyPromptToClipboard(prompt: string): Promise<boolean> {
  let copied = false

  if (typeof document !== "undefined") {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const textarea = document.createElement("textarea")
    textarea.value = prompt
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "0"
    textarea.style.width = "1px"
    textarea.style.height = "1px"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.focus()
    textarea.select()
    try {
      copied = document.execCommand("copy")
    } catch {
      copied = false
    } finally {
      document.body.removeChild(textarea)
      activeElement?.focus({ preventScroll: true })
    }
  }

  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(prompt)
      .then(() => true)
      .catch(() => copied)
  }

  return Promise.resolve(copied)
}

export function CodexNodePanel({ open, node, candidates, onClose, onSaveHeading, onSaveDraft }: CodexNodePanelProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const { getBySourceId: getAiTaskBySourceId, refresh: refreshAiTasks } = useMemoAiTasks()
  const [heading, setHeading] = useState(node.title)
  const [detail, setDetail] = useState(node.memo)
  const [error, setError] = useState<string | null>(null)
  const [codexFeedback, setCodexFeedback] = useState<string | null>(null)
  const [codexSendStatus, setCodexSendStatus] = useState<CodexSendStatus>("idle")
  const [isSyncingCodex, setIsSyncingCodex] = useState(false)
  const [justSentPrompt, setJustSentPrompt] = useState("")
  const [codexRunnerStatus, setCodexRunnerStatus] = useState<CodexRunnerStatus>({ checked: false, ready: false })
  const [isMobileOpenTarget, setIsMobileOpenTarget] = useState(false)
  const [mobilePlatform, setMobilePlatform] = useState<MobilePlatform>("desktop")
  const [isGeneratingHeading, setIsGeneratingHeading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const saveVersionRef = useRef(0)

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
    setIsSyncingCodex(false)
    setJustSentPrompt("")
    setCodexRunnerStatus({ checked: false, ready: false })
    setIsGeneratingHeading(false)
    setSaveStatus("saved")
  }, [open, node.taskId, node.title, node.memo])

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
  const codexThreadUrl =
    codexThreadId
      ? `codex://threads/${codexThreadId}`
      : stringValue(codexResult.codex_thread_url) || node.codexThreadUrl || null
  const codexManualHandoff = codexResult.codex_manual_handoff === true
  const hasCodexRun = isCodexTask || !!justSentPrompt
  const codexWaitingForAppSend = codexManualHandoff && !codexThreadId
  const codexMessage = stringValue(codexResult.message)
  const codexLiveLog = stringValue(codexResult.live_log)
  const codexPreview = stringValue(codexSnapshot.preview)
  const rawSentPrompt = codexTask?.prompt?.trim() || justSentPrompt
  const sentPrompt = stripFocusmapSyncId(rawSentPrompt)
  const codexDisplayLog = buildCodexDisplayLog(codexLiveLog, codexMessage, codexPreview)
  const codexConversation = useMemo(
    () => parseCodexConversation(codexDisplayLog, rawSentPrompt),
    [codexDisplayLog, rawSentPrompt],
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
    { prompt: codexPrompt, repoPath: codexRepoPath || null },
    { preferMobile: isMobileOpenTarget, mobilePlatform },
  )
  const codexHref = codexOpenTarget.url

  const syncCodexState = useCallback(async () => {
    if (!open || !hasCodexRun) return
    setIsSyncingCodex(true)
    try {
      await fetchWithSupabaseAuth("/api/codex/sync-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_task_id: node.taskId,
          ai_task_id: codexTask?.id,
        }),
      }).catch(() => undefined)
      await refreshAiTasks()
    } finally {
      setIsSyncingCodex(false)
    }
  }, [codexTask?.id, hasCodexRun, node.taskId, open, refreshAiTasks])

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

  const openCodexThread = useCallback(async () => {
    const prompt = codexThreadUrl ? "" : sentPrompt || codexPrompt
    const repoPath = codexRepoPath || codexTask?.cwd?.trim() || null
    setError(null)
    try {
      if (canUseLocalCodexOpenApi() && !isMobileOpenTarget) {
        await launchCodexViaLocalApi({ prompt, repoPath, threadUrl: codexThreadUrl })
      } else {
        const target = buildCodexOpenTarget(
          { prompt, repoPath, threadUrl: codexThreadUrl },
          { preferMobile: isMobileOpenTarget, mobilePlatform },
        )
        window.location.href = target.url
      }
      window.setTimeout(() => void syncCodexState(), 1200)
      window.setTimeout(() => void syncCodexState(), 3500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex.app を開けませんでした")
    }
  }, [codexPrompt, codexRepoPath, codexTask?.cwd, codexThreadUrl, isMobileOpenTarget, mobilePlatform, sentPrompt, syncCodexState])

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
    const useLocalApi = canUseLocalCodexOpenApi() && !isMobileOpenTarget
    event?.preventDefault()
    let launchMode: CodexLaunchMode | null = null
    setError(null)
    setCodexFeedback(null)
    setCodexSendStatus("sending")

    try {
      const clipboardPromise = copyPromptToClipboard(prompt)
      const dispatchMode = "manual"
      const savePromise = saveDraft(heading, detail)
      await savePromise
      const scheduleRes = await fetch("/api/ai-tasks/schedule", {
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

      let copiedToClipboard = await clipboardPromise
      if (useLocalApi) {
        const launchOutcome = await launchCodexViaLocalApi({ prompt, repoPath: repoPath || null })
        launchMode = launchOutcome.mode
        if (launchOutcome.copiedToClipboard) copiedToClipboard = true
      } else if (typeof window !== "undefined") {
        launchMode = openTarget.mode
        window.location.href = openTarget.url
      }

      setCodexSendStatus("sent")
      setJustSentPrompt(prompt)
      await refreshAiTasks()
      window.setTimeout(() => void syncCodexState(), 1200)
      window.setTimeout(() => void syncCodexState(), 3500)
      const copyFeedback = copiedToClipboard ? "プロンプトはコピー済みです。" : "プロンプトのコピーに失敗しました。"
      const dispatchFeedback = isMobileOpenTarget
          ? "ChatGPTアプリのCodex画面で貼り付けて開始してください。"
          : repoPath
          ? "Macセットアップ未完了のため、今回はCodex.appで貼り付けて開始してください。"
          : "リポジトリ未設定のため、Codex.appで貼り付けて開始してください。"
      setCodexFeedback(
        `${launchFeedbackForMode(launchMode ?? "browser-deep-link")} ${copyFeedback} ${dispatchFeedback}`,
      )
    } catch (err) {
      setCodexSendStatus(launchMode ? "sent" : "idle")
      setError(err instanceof Error ? err.message : "Codexに送れませんでした")
    }
  }, [candidates, detail, heading, isMobileOpenTarget, mobilePlatform, node.cwd, node.taskId, node.title, refreshAiTasks, saveDraft, syncCodexState])

  const recopyCodexPrompt = useCallback(async () => {
    const prompt = sentPrompt || codexPrompt
    if (!prompt.trim()) return
    const copied = await copyPromptToClipboard(prompt)
    setCodexFeedback(copied
      ? "プロンプトを再コピーしました。画像が必要な場合はCodex.app側で手動添付してください。"
      : "プロンプトの再コピーに失敗しました。")
  }, [codexPrompt, sentPrompt])

  const showCodexSetupPrompt =
    !canUseLocalCodexOpenApi() &&
    codexRunnerStatus.checked &&
    !codexRunnerStatus.ready

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
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.requestAnimationFrame(moveFocusToPanel)
        }}
        className="flex max-h-[92dvh] w-[calc(100vw-1rem)] !max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-border/70 p-0 xl:!max-w-[1200px]"
      >
        <DialogTitle className="sr-only">メモ見出し</DialogTitle>

        <div className="shrink-0 border-b border-border/70 px-4 py-4 pr-12 sm:px-6">
          <label className="text-sm text-muted-foreground" htmlFor="codex-memo-heading">
            メモ見出し
          </label>
          <div className="mt-2">
            <textarea
              id="codex-memo-heading"
              value={heading}
              rows={2}
              onChange={(event) => handleHeadingChange(event.target.value)}
              className="max-h-28 min-h-12 w-full resize-none overflow-y-auto rounded-lg border border-border/70 bg-background px-3 py-3 text-base leading-relaxed outline-none focus:border-primary"
              placeholder="メモ見出し"
            />
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <div className="flex items-center justify-between gap-3 sm:justify-start">
                <span className="text-sm text-muted-foreground">メモ詳細</span>
                <span className="text-xs font-medium text-muted-foreground" aria-live="polite">
                  {saveStatus === "saving" ? "保存中" : saveStatus === "error" ? "保存失敗" : "保存済み"}
                </span>
              </div>
              <div className="flex shrink-0 items-center justify-end gap-2">
                {hasCodexRun ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void syncCodexState()}
                      disabled={isSyncingCodex}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                      aria-label="Codexログを更新"
                      title="Codexログを更新"
                    >
                      <RefreshCw className={`h-4 w-4 ${isSyncingCodex ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void openCodexThread()}
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-100"
                      aria-label={codexThreadUrl ? "Codexスレッドを開く" : "Codex.appを開く"}
                      title={codexThreadUrl ? "Codexスレッドを開く" : "Codex.appを開く"}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {codexThreadUrl ? "Codexで開く" : "Codex.appを開く"}
                    </button>
                  </>
                ) : (
                  <a
                    href={codexHref}
                    onClick={sendToCodex}
                    aria-disabled={codexSendStatus === "sending"}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 aria-disabled:pointer-events-none aria-disabled:opacity-50 dark:text-emerald-100"
                    aria-label={isMobileOpenTarget ? "コピーしてChatGPTのCodexを開く" : "コピーしてCodexを開く"}
                    title={isMobileOpenTarget ? "コピーしてChatGPTのCodexを開く" : "コピーしてCodexを開く"}
                  >
                    {codexSendStatus === "sending" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isMobileOpenTarget ? (
                      <Smartphone className="h-4 w-4" />
                    ) : (
                      <ExternalLink className="h-4 w-4" />
                    )}
                    {isMobileOpenTarget ? "ChatGPTでCodex" : "Codexに送る"}
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
                        {codexWaitingForAppSend ? "未送信" : "thread検出待ち"}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">
                      {isSyncingCodex ? "同期中" : "約3秒ごとに同期"}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => void syncCodexState()}
                      disabled={isSyncingCodex}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isSyncingCodex ? "animate-spin" : ""}`} />
                      更新
                    </button>
                    {sentPrompt && (
                      <button
                        type="button"
                        onClick={() => void recopyCodexPrompt()}
                        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-semibold transition-colors hover:bg-muted"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        再コピー
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void openCodexThread()}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      {codexThreadUrl ? "Codexで開く" : "Codex.appを開く"}
                    </button>
                  </div>
                </div>

                <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <div className="max-h-[46dvh] min-h-64 space-y-3 overflow-y-auto px-3 py-4">
                    <div className="flex justify-start">
                      <div className="max-w-[88%] rounded-2xl border bg-background px-3 py-2 text-sm leading-6 shadow-sm">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Focusmap</p>
                        <p className="text-muted-foreground">
                          {codexWaitingForAppSend
                            ? "プロンプトはコピー済みです。Codex.appで貼り付けて送信すると、この欄に状態と出力が同期されます。"
                            : "このノードの続きはCodex.appで進めます。Focusmapは状態と出力だけを同期します。"}
                        </p>
                      </div>
                    </div>

                    {sentPrompt && (
                      <div className="flex justify-end">
                        <div className="max-w-[84%] rounded-2xl bg-muted px-3 py-2 text-sm leading-6 text-foreground">
                          <p className="mb-1 text-xs font-medium text-muted-foreground">
                            {codexWaitingForAppSend ? "コピー済み" : "Codex側で送信"}
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
                          ? "Codex.appで送信されると、ここに同期ログが表示されます"
                          : "Codex.app側の出力はまだ同期されていません"}
                      </div>
                    )}
                  </div>

                  <aside className="border-t bg-muted/5 px-3 py-3 lg:border-l lg:border-t-0">
                    <details className="group text-xs">
                      <summary className="cursor-pointer select-none rounded-md border bg-background px-3 py-2 font-medium text-muted-foreground">
                        同期ログ {codexConversation.processLogs.length}
                      </summary>
                      <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {codexConversation.processLogs.length > 0 ? (
                          codexConversation.processLogs.map((log, index) => (
                            <div key={`${index}-${log.slice(0, 20)}`} className="whitespace-pre-wrap rounded-md border bg-background px-3 py-2 leading-5 text-muted-foreground">
                              {log}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-md border bg-background px-3 py-2 leading-5 text-muted-foreground">
                            まだ詳細ログは同期されていません
                          </div>
                        )}
                      </div>
                    </details>
                  </aside>
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
