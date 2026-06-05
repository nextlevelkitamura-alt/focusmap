"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import QRCode from "react-qr-code"
import { Terminal, Loader2, Smartphone, Copy, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Settings, ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getCodexTaskUiState } from "@/lib/codex-run-state"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import type { AiTask, AiTaskActivityMessage, AiTaskProgressState, AiTaskProgressSummary } from "@/types/ai-task"

interface NoteClaudeRunnerProps {
  noteId: string
  noteContent: string
  // 以下 3 つは Panel／将来の自動実行復活時のために型上残す。Button では現在不使用。
  projectId?: string | null
  repoPath?: string | null
  latestTask?: AiTask | null
}

const STATUS_LABEL: Record<string, string> = {
  pending: "実行待ち",
  running: "実行中",
  awaiting_approval: "承認待ち",
  needs_input: "入力待ち",
  completed: "完了",
  failed: "失敗",
}

const STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  awaiting_approval: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  needs_input: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/10 text-red-700 dark:text-red-300",
}

const ACTIVE_STATUSES = new Set(["pending", "running", "awaiting_approval", "needs_input"])

const PROGRESS_STATE_LABEL: Record<AiTaskProgressState, string> = {
  not_started: "未開始",
  running: "進行中",
  likely_completed: "完了候補",
  needs_review: "確認待ち",
  blocked: "停止中",
  failed: "失敗",
  unknown: "不明",
}

const PROGRESS_STATE_COLOR: Record<AiTaskProgressState, string> = {
  not_started: "bg-muted text-muted-foreground",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  likely_completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  needs_review: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  blocked: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  failed: "bg-red-500/10 text-red-700 dark:text-red-300",
  unknown: "bg-muted text-muted-foreground",
}

const SESSION_HEALTH_LABEL: Record<string, string> = {
  active: "セッション生存",
  stopped: "停止済み",
  lost_after_restart: "再起動後に紛失",
  transcript_only: "履歴のみ",
  unknown: "不明",
}

function isProgressSummary(value: unknown): value is AiTaskProgressSummary {
  return !!value &&
    typeof value === "object" &&
    "state" in value &&
    "progress_percent" in value &&
    "summary" in value
}

function getProgressSummary(result: Record<string, unknown> | null): AiTaskProgressSummary | null {
  const value = result?.progress_summary
  return isProgressSummary(value) ? value : null
}

function formatProgressTime(iso?: string) {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function formatActivityTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })
  } catch {
    return ""
  }
}

function activityTone(message: AiTaskActivityMessage) {
  if (message.kind === "failed") return "border-red-500/25 bg-red-500/5"
  if (message.kind === "completed") return "border-emerald-500/25 bg-emerald-500/5"
  if (message.kind === "question" || message.kind === "approval") return "border-amber-500/30 bg-amber-500/10"
  if (message.kind === "resumed" || message.kind === "sent" || message.kind === "prompt_waiting") return "border-blue-500/25 bg-blue-500/5"
  return "border-border bg-background/70"
}

function activityKindLabel(kind: AiTaskActivityMessage["kind"]) {
  switch (kind) {
    case "prompt_waiting": return "プロンプト待ち"
    case "sent": return "送信"
    case "progress": return "進捗"
    case "question": return "質問"
    case "approval": return "確認"
    case "resumed": return "再開"
    case "completed": return "完了"
    case "failed": return "失敗"
    case "user_answer": return "回答"
    default: return kind
  }
}

function codexReviewReasonLabel(reason: string | null) {
  switch (reason) {
    case "completed": return "完了確認"
    case "approval_requested": return "承認待ち"
    case "manual_handoff": return "プロンプト待ち"
    case "monitoring_lost": return "同期確認"
    case "thread_deleted": return "スレッド確認"
    case "aborted": return "停止確認"
    case "archived": return "アーカイブ確認"
    case "started": return "実行開始"
    default: return "確認待ち"
  }
}

function codexReviewDefaultBody(reason: string | null) {
  switch (reason) {
    case "completed":
      return "Codex側では完了らしき状態です。結果を見て問題なければ完了にしてください。"
    case "approval_requested":
      return "Codexが承認を待っています。Codex側の確認内容を見て、承認または追加指示をしてください。"
    case "manual_handoff":
      return "プロンプトはコピー済みです。Codex側で貼り付けて送信すると、Focusmapに状態が同期されます。"
    case "monitoring_lost":
      return "Codexの状態同期が途切れています。Codex側の画面を開いて、作業が続いているか確認してください。"
    case "thread_deleted":
      return "Codex threadが見つかりません。Codex側で対象スレッドが残っているか確認してください。"
    case "aborted":
      return "Codex実行が停止しています。中断理由を確認して、必要なら再実行してください。"
    case "archived":
      return "Codex threadがアーカイブされています。必要ならCodex側で開き直してください。"
    default:
      return "Codex側で確認が必要です。最新の質問や承認内容を確認してください。"
  }
}

function isReviewActivity(message: AiTaskActivityMessage) {
  return message.kind === "question" ||
    message.kind === "approval" ||
    message.kind === "completed" ||
    message.kind === "failed" ||
    message.kind === "prompt_waiting"
}

function userFacingActivityError(message: string | null) {
  if (!message) return null
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return "活動履歴を読み込めません。接続またはログイン状態を確認してください。"
  }
  return "活動履歴を読み込めません。少し待ってから開き直してください。"
}

function isGenericCodexReviewText(value: string) {
  const text = value.replace(/\s+/g, " ").trim()
  if (!text) return true
  return text === "完了確認" ||
    text === "確認待ち" ||
    text === "承認待ち" ||
    text === "プロンプト待ち" ||
    /^Codexの実行が完了しました。?結果確認待ちです。?$/.test(text) ||
    /^Codex セッションは確認待ちです。?/.test(text) ||
    /^\[Codex\] 実行完了。?確認待ちです。?$/.test(text) ||
    /^Codex側では完了らしき状態です。?/.test(text)
}

function cleanCodexDisplayText(value: string) {
  const blocks = value
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => block.replace(/^\[(assistant|codex)\]\s*/i, "").trim())
    .filter(block => !isGenericCodexReviewText(block))

  return blocks.join("\n\n").trim()
}

function readCodexSnapshotPreview(result: Record<string, unknown> | null) {
  const snapshot = result?.codex_thread_snapshot
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return ""
  const preview = (snapshot as Record<string, unknown>).preview
  return typeof preview === "string" ? preview : ""
}

function codexReadableOutput(result: Record<string, unknown> | null) {
  const liveLog = typeof result?.live_log === "string" ? cleanCodexDisplayText(result.live_log) : ""
  if (liveLog) return liveLog

  const message = typeof result?.message === "string" ? cleanCodexDisplayText(result.message) : ""
  if (message) return message

  return cleanCodexDisplayText(readCodexSnapshotPreview(result))
}

function reviewActivityBody(message: AiTaskActivityMessage | undefined) {
  if (!message || isGenericCodexReviewText(message.body)) return ""
  return message.body
}

export function NoteClaudeRunnerButton({
  noteId,
  noteContent,
  onOpenCodex,
}: NoteClaudeRunnerProps & { onOpenCodex: () => Promise<void> }) {
  const [isCopying, setIsCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    setError(null)
    setIsCopying(true)
    try {
      await onOpenCodex()
    } catch (e) {
      setError(e instanceof Error ? e.message : "起動に失敗しました")
    } finally {
      setIsCopying(false)
    }
  }

  const title = "Codex Web で開く（メモをクリップボードにコピー）"

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={handleClick}
        disabled={isCopying}
        className={cn(
          "min-h-[44px] min-w-[44px] gap-1",
          "border-amber-500/60 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300",
        )}
        title={title}
        aria-label={title}
      >
        {isCopying ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <ExternalLink className="w-5 h-5" />
        )}
      </Button>
      {error && (
        <div className="absolute mt-8 text-[10px] text-red-600 bg-background border border-red-200 rounded px-1.5 py-0.5 shadow-sm z-10">
          {error}
        </div>
      )}
      <span className="hidden">{noteContent.slice(0, 0)}{noteId.slice(0, 0)}</span>
    </>
  )
}

/**
 * メモカード下部に表示する実行パネル。
 * latestTask が存在する場合のみ表示される。
 */
export function NoteClaudeRunnerPanel({
  latestTask,
  isProjectAssigned,
  isRepoConfigured,
}: {
  latestTask: AiTask | null
  isProjectAssigned: boolean
  isRepoConfigured: boolean
}) {
  // デフォルト折りたたみ（メモ一覧の masonry が長くなりすぎないため、
  // ユーザーが意図的にクリックして開く運用に変更）
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isCheckingProgress, setIsCheckingProgress] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [progressOverride, setProgressOverride] = useState<AiTaskProgressSummary | null>(null)
  const [activityMessages, setActivityMessages] = useState<AiTaskActivityMessage[]>([])
  const [activityError, setActivityError] = useState<string | null>(null)
  const autoExpandedTaskIdRef = useRef<string | null>(null)
  const latestTaskId = latestTask?.id ?? null
  const latestExecutor = latestTask?.executor ?? null
  const latestTaskStatus = latestTask?.status ?? null
  const isLatestTaskActive = latestTaskStatus ? ACTIVE_STATUSES.has(latestTaskStatus) : false
  const isCodexTaskForActivity = latestExecutor === "codex" || latestExecutor === "codex_app"

  useEffect(() => {
    if (!latestTaskId) {
      autoExpandedTaskIdRef.current = null
      return
    }
    if (
      isCodexTaskForActivity &&
      isLatestTaskActive &&
      autoExpandedTaskIdRef.current !== latestTaskId
    ) {
      setExpanded(true)
      autoExpandedTaskIdRef.current = latestTaskId
    }
  }, [isCodexTaskForActivity, isLatestTaskActive, latestTaskId])

  useEffect(() => {
    setProgressOverride(null)
    setCheckError(null)
  }, [latestTask?.id, latestTask?.result])

  useEffect(() => {
    if (!latestTaskId || !isCodexTaskForActivity || !expanded) {
      setActivityMessages([])
      setActivityError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      try {
        const res = await fetchWithSupabaseAuth(`/api/ai-tasks/${latestTaskId}/activity`, { cache: "no-store" })
        const data = await res.json().catch(() => ({})) as { messages?: AiTaskActivityMessage[]; error?: string }
        if (!res.ok) throw new Error(data.error || `activity ${res.status}`)
        if (!cancelled) {
          setActivityMessages(Array.isArray(data.messages) ? data.messages : [])
          setActivityError(null)
        }
      } catch (error) {
        if (!cancelled) setActivityError(error instanceof Error ? error.message : "活動履歴を取得できません")
      }
    }

    void load()
    const interval = isLatestTaskActive
      ? window.setInterval(() => void load(), 5_000)
      : null

    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
    }
  }, [expanded, isCodexTaskForActivity, isLatestTaskActive, latestTask?.result, latestTaskId])

  if (!isProjectAssigned) return null

  // パス未設定の警告（タスクがまだないがプロジェクト紐付けはされている）
  if (!isRepoConfigured && !latestTask) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
        <AlertCircle className="w-3 h-3 shrink-0" />
        <span>このプロジェクトにリポジトリパス未設定。</span>
        <Link href="/dashboard/settings/projects#project-repos" className="underline hover:text-foreground inline-flex items-center gap-0.5">
          <Settings className="w-3 h-3" />
          設定
        </Link>
      </div>
    )
  }

  if (!latestTask) return null

  const isActive = ACTIVE_STATUSES.has(latestTask.status)
  const url = latestTask.remote_session_url
  const resultObj = typeof latestTask.result === "object" && latestTask.result !== null
    ? latestTask.result
    : null
  const resultMessage = typeof resultObj?.message === "string" ? resultObj.message : null
  const isCodexTask = latestTask.executor === "codex" || latestTask.executor === "codex_app"
  const codexUiState = getCodexTaskUiState(latestTask)
  const codexThreadId = typeof resultObj?.codex_thread_id === "string"
    ? resultObj.codex_thread_id
    : latestTask.codex_thread_id
  const codexReviewReason = typeof resultObj?.codex_review_reason === "string" ? resultObj.codex_review_reason : null
  const codexCurrentStep = typeof resultObj?.current_step === "string" ? resultObj.current_step : ""
  const latestReviewMessage = [...activityMessages]
    .reverse()
    .find(isReviewActivity)
  const codexReviewLabel = codexReviewReasonLabel(codexReviewReason)
  const codexOutput = codexReadableOutput(resultObj)
  const codexReviewBody = reviewActivityBody(latestReviewMessage) ||
    codexOutput ||
    (codexCurrentStep && !isGenericCodexReviewText(codexCurrentStep) ? codexCurrentStep : "") ||
    (resultMessage && !isGenericCodexReviewText(resultMessage) ? resultMessage : "") ||
    codexReviewDefaultBody(codexReviewReason)
  const codexHeaderSummary = codexUiState
    ? codexUiState.state === "awaiting_approval"
      ? `${codexReviewLabel}: ${codexReviewBody}`
      : codexUiState.state === "prompt_waiting"
        ? "プロンプト待ち: Codex側で貼り付けて送信してください"
        : codexCurrentStep || "Codexが実行中です"
    : null
  const activityLoadHelp = userFacingActivityError(activityError)
  const visibleActivityMessages = activityMessages
    .filter(message => !isReviewActivity(message) || !isGenericCodexReviewText(message.body))
    .slice(-6)
  const showActivityLoadHelp = !!activityLoadHelp && visibleActivityMessages.length === 0 && !codexOutput
  const progressSummary = progressOverride ?? getProgressSummary(resultObj)
  const progressPercent = progressSummary ? Math.max(0, Math.min(100, Math.round(progressSummary.progress_percent))) : null
  const headerStatusLabel = codexUiState?.label ?? (STATUS_LABEL[latestTask.status] ?? latestTask.status)
  const headerStatusClass = codexUiState
    ? codexUiState.state === "running"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
    : STATUS_COLOR[latestTask.status] ?? "bg-muted text-muted-foreground"

  const checkProgress = async () => {
    if (!latestTask || isCheckingProgress) return
    setIsCheckingProgress(true)
    setCheckError(null)
    try {
      const res = await fetch(`/api/ai-tasks/${latestTask.id}/progress-check`, {
        method: "POST",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || `進捗確認に失敗しました (${res.status})`)
      }
      if (data?.progress_summary && isProgressSummary(data.progress_summary)) {
        setProgressOverride(data.progress_summary)
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "進捗確認に失敗しました")
    } finally {
      setIsCheckingProgress(false)
    }
  }

  const markCompleted = async () => {
    if (!latestTask) return
    setCheckError(null)
    try {
      const res = await fetch(`/api/ai-tasks/${latestTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "完了更新に失敗しました")
      }
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "完了更新に失敗しました")
    }
  }

  const copyUrl = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <div className="mt-2 min-w-0 overflow-hidden rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-t-md px-2.5 py-1.5 text-left hover:bg-muted/40"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {codexUiState?.state === "running" ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500 shrink-0" />
          ) : codexUiState?.state === "awaiting_approval" ? (
            <Terminal className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          ) : latestTask.status === "completed" ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          ) : latestTask.status === "failed" ? (
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          ) : (
            <Terminal className={cn(
              "w-3.5 h-3.5 shrink-0",
              latestTask.status === "running" && "text-blue-500 animate-pulse",
            )} />
          )}
          <span className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
            headerStatusClass,
          )}>
            {headerStatusLabel}
          </span>
          <span className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
            latestTask.executor === "codex" || latestTask.executor === "codex_app"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}>
            {latestTask.executor === "codex" || latestTask.executor === "codex_app" ? "◎ Codex" : "▲ Claude"}
          </span>
          {codexUiState?.state === "awaiting_approval" ? (
            <span className={cn(
              "text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0",
              "bg-amber-500/10 text-amber-700 dark:text-amber-300",
            )}>
              {codexReviewLabel}
            </span>
          ) : progressSummary && (
            <span className={cn(
              "text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0",
              PROGRESS_STATE_COLOR[progressSummary.state] ?? PROGRESS_STATE_COLOR.unknown,
            )}>
              {PROGRESS_STATE_LABEL[progressSummary.state] ?? "不明"}
            </span>
          )}
          <span className="min-w-0 flex-1 basis-24 truncate text-[11px] text-muted-foreground">
            {codexUiState
              ? codexHeaderSummary
              : progressSummary && progressPercent !== null
              ? `${progressPercent}% / ${PROGRESS_STATE_LABEL[progressSummary.state] ?? "不明"} / ${progressSummary.current_step || progressSummary.summary}`
              : "セッション"}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        // 展開時の最大高さ。Claude QR 表示時の高さを目安に頭打ち（masonry でカードが伸びすぎないため）
        <div className="border-t px-2.5 py-2 space-y-2 max-h-[420px] overflow-y-auto">
          {isCodexTask && (
            <div className="rounded-md border bg-muted/20 p-2 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium">Codex 状態</span>
                    {codexUiState && (
                      <span className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        codexUiState.state === "running"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
                      )}>
                        {codexUiState.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {codexUiState?.state === "running"
                      ? "実行中だけ約5秒ごとに状態を同期します"
                      : codexUiState?.state === "prompt_waiting"
                        ? "Codex側で送信されるまで待機しています"
                        : "最新の確認内容を優先して表示します"}
                  </p>
                </div>
                {codexUiState?.state === "running" && <Loader2 className="h-4 w-4 animate-spin text-emerald-500" />}
              </div>

              {(codexUiState?.state === "awaiting_approval" || codexUiState?.state === "prompt_waiting") && (
                <div className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-5">
                  <div className="mb-1 flex items-center justify-between gap-2 text-amber-700 dark:text-amber-300">
                    <span className="font-medium">
                      {codexUiState.state === "prompt_waiting" ? "プロンプト待ち" : codexReviewLabel}
                    </span>
                    {latestReviewMessage && (
                      <span className="text-[10px] text-muted-foreground">{formatActivityTime(latestReviewMessage.created_at)}</span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{codexReviewBody}</p>
                </div>
              )}

              {latestTask.prompt && (
                <div className="rounded-md border bg-background/80 px-2.5 py-2 text-[11px] leading-5">
                  <div className="mb-1 flex items-center justify-between gap-2 text-muted-foreground">
                    <span className="font-medium text-foreground">Focusmapから送信</span>
                    <span className="text-[10px]">{latestTask.prompt.length}字</span>
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words font-sans">
                    {latestTask.prompt}
                  </pre>
                </div>
              )}

              {visibleActivityMessages.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-medium text-muted-foreground">Codexチャット / 活動</div>
                  {visibleActivityMessages.map(message => (
                    <div key={message.id} className={cn("rounded-md border px-2.5 py-2 text-[11px] leading-5", activityTone(message))}>
                      <div className="mb-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                        <span className="font-medium text-foreground">{activityKindLabel(message.kind)}</span>
                        <span className="text-[10px]">{formatActivityTime(message.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-wrap">{message.body}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground italic">
                  {codexUiState?.state === "awaiting_approval" ? codexReviewBody : codexCurrentStep || "Codex側の発話を待っています"}
                </div>
              )}
              {showActivityLoadHelp && (
                <div className="rounded border border-amber-500/25 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                  {activityLoadHelp}
                </div>
              )}
              {codexThreadId && (
                <details className="text-[10px] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">同期情報</summary>
                  <div className="mt-1 rounded bg-background/70 px-2 py-1.5 leading-4">
                    thread <span className="font-mono">{codexThreadId.slice(0, 8)}</span>
                  </div>
                </details>
              )}
              {latestTask.status !== "completed" && codexUiState?.state === "awaiting_approval" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={markCompleted}
                  className="h-8 w-full border-emerald-500/40 text-[11px] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  確認して完了にする
                </Button>
              )}
            </div>
          )}
          {!isCodexTask && (
          <div className="rounded-md border bg-muted/20 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium">AI進捗判定</span>
                  {progressSummary && (
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      PROGRESS_STATE_COLOR[progressSummary.state] ?? PROGRESS_STATE_COLOR.unknown,
                    )}>
                      {PROGRESS_STATE_LABEL[progressSummary.state] ?? "不明"}
                    </span>
                  )}
                </div>
                {progressSummary?.checked_at && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    最終更新 {formatProgressTime(progressSummary.checked_at)}
                    {progressSummary.source === "gemini" ? " / Gemini判定" : " / ルール判定"}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={checkProgress}
                disabled={isCheckingProgress}
                className="h-8 shrink-0 px-2 text-[11px]"
              >
                {isCheckingProgress ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                状況更新
              </Button>
            </div>

            {progressSummary && progressPercent !== null ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="truncate">{progressSummary.current_step || "現在ステップ不明"}</span>
                  <span className="shrink-0 tabular-nums">{progressPercent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      progressSummary.state === "failed" ? "bg-red-500" :
                        progressSummary.state === "blocked" ? "bg-amber-500" :
                          progressSummary.state === "likely_completed" ? "bg-emerald-500" :
                            "bg-blue-500",
                    )}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <p className="text-[11px] font-medium leading-4">
                  {progressPercent}% / {PROGRESS_STATE_LABEL[progressSummary.state] ?? "不明"} / {progressSummary.current_step || progressSummary.summary}
                </p>
                <p className="text-[11px] leading-4">
                  {progressSummary.comment || progressSummary.summary}
                </p>
                <div className="rounded bg-background/70 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                  <p>根拠: {progressSummary.evidence}</p>
                  <p>次: {progressSummary.recommended_action}</p>
                  <p>信頼度: {Math.round(progressSummary.confidence * 100)}%</p>
                  <p>状態: {SESSION_HEALTH_LABEL[progressSummary.session_health ?? "unknown"] ?? "不明"}</p>
                  {progressSummary.last_activity_at && (
                    <p>最終活動: {formatProgressTime(progressSummary.last_activity_at)}</p>
                  )}
                  {progressSummary.last_tool && <p>最後のツール: {progressSummary.last_tool}</p>}
                </div>
                {progressSummary.done_evidence && progressSummary.done_evidence.length > 0 && (
                  <div className="rounded bg-emerald-500/5 px-2 py-1.5 text-[10px] leading-4 text-emerald-700 dark:text-emerald-300">
                    <p className="font-medium">ここまで</p>
                    {progressSummary.done_evidence.slice(0, 3).map(item => (
                      <p key={item}>・{item}</p>
                    ))}
                  </div>
                )}
                {progressSummary.remaining_work && progressSummary.remaining_work.length > 0 && (
                  <div className="rounded bg-amber-500/5 px-2 py-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
                    <p className="font-medium">残り / 確認</p>
                    {progressSummary.remaining_work.slice(0, 3).map(item => (
                      <p key={item}>・{item}</p>
                    ))}
                  </div>
                )}
                {((progressSummary.files_touched?.length ?? 0) > 0 || (progressSummary.tests_seen?.length ?? 0) > 0) && (
                  <div className="rounded bg-background/70 px-2 py-1.5 text-[10px] leading-4 text-muted-foreground">
                    {(progressSummary.files_touched?.length ?? 0) > 0 && (
                      <p>ファイル: {progressSummary.files_touched?.slice(0, 4).join(", ")}</p>
                    )}
                    {(progressSummary.tests_seen?.length ?? 0) > 0 && (
                      <p>テスト: {progressSummary.tests_seen?.slice(0, 2).join(" / ")}</p>
                    )}
                  </div>
                )}
                {progressSummary.can_mark_completed && latestTask.status !== "completed" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={markCompleted}
                    className="h-8 w-full border-emerald-500/40 text-[11px] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    完了にする
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                状況更新を押すと、ログとタスク状態をGeminiが読んで進捗と完了可否を判定します。
              </p>
            )}

            {checkError && (
              <div className="rounded bg-red-500/5 border border-red-200 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
                {checkError}
              </div>
            )}
          </div>
          )}

          {/* セッションURLが取れるまでの待機表示（Claude のみ）*/}
          {latestTask.executor !== "codex" && latestTask.executor !== "codex_app" && isActive && !url && (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              セッションを起動中...（最大 1 分）
            </div>
          )}

          {/* リモートセッションURL（Claude のみ） */}
          {!isCodexTask && url && (
            <div className="space-y-2">
              <div className="flex flex-col sm:flex-row gap-2">
                {/* QRコード（PCで見るときに有用） */}
                <div className="shrink-0 rounded-md border bg-white p-2 self-start">
                  <QRCode value={url} size={96} />
                </div>

                {/* 接続用ボタン群 */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    スマホの Claude アプリで QR を読むか、ボタンで開く：
                  </p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    このデバイスで続ける
                  </a>
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="ml-2 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-[11px] hover:bg-muted"
                  >
                    <Copy className="w-3 h-3" />
                    {copied ? "コピー済" : "URLをコピー"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 実際に AI に送られたプロンプト（Codexは上のチャット枠にも常時表示する） */}
          {!isCodexTask && latestTask.prompt && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {isCodexTask ? "Codex" : "Claude"} に送られたプロンプト（{latestTask.prompt.length} 字）
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px] leading-4">
                {latestTask.prompt}
              </pre>
            </details>
          )}

          {/* 結果メッセージ（完了時はデフォルト展開で目立つように）*/}
          {latestTask.status === "completed" && resultMessage && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {isCodexTask ? "Codex" : "Claude"} 実行完了
                <span className="text-muted-foreground font-normal">（{resultMessage.length} 字）</span>
              </div>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-emerald-500/5 border border-emerald-500/20 p-2 text-[10px] leading-4 font-mono">
                {resultMessage}
              </pre>
            </div>
          )}

          {/* エラー */}
          {latestTask.status === "failed" && latestTask.error && (
            <div className="rounded bg-red-500/5 border border-red-200 px-2 py-1.5 text-[11px] text-red-700 dark:text-red-300">
              {latestTask.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
