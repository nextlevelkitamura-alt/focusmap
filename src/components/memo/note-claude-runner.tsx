"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import QRCode from "react-qr-code"
import { Terminal, Loader2, Smartphone, Copy, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Settings, Circle, XCircle, ExternalLink, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AiTask, AiTaskProgressState, AiTaskProgressSummary } from "@/types/ai-task"

// ─────────────────────────────────────────────────────────────────────────
// Codex 実行ステップタイムライン
//   task-runner が ai_tasks.result.steps[] に進捗を蓄積するので、
//   想定順序に沿ってチェックマーク／スピナー／⋯ で表示する
// ─────────────────────────────────────────────────────────────────────────
type CodexStepStatus = "done" | "active" | "failed"
interface CodexStepRecord {
  key: string
  label: string
  status: CodexStepStatus
  at: string
}

const CODEX_STEP_ORDER: { key: string; label: string }[] = [
  { key: "received", label: "Mac で受信" },
  { key: "daemon_ready", label: "Codex daemon 接続OK" },
  { key: "spawn", label: "Bridge プロセス起動" },
  { key: "connected", label: "app-server に接続 (initialize OK)" },
  { key: "thread_visible", label: "Thread 作成 (mobile / Codex.app に表示)" },
  { key: "prompt_ready", label: "プロンプト準備完了" },
  { key: "turn_started", label: "プロンプト送信完了" },
  { key: "completed", label: "完了" },
]

function formatStepTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return ""
  }
}

function CodexStepTimeline({
  steps,
  isRunning,
  failed,
}: {
  steps: CodexStepRecord[]
  isRunning: boolean
  failed: boolean
}) {
  // 既知の step key と未知の step key をマージ（custom step もそのまま末尾に並べる）
  const byKey = new Map(steps.map(s => [s.key, s]))
  const known = CODEX_STEP_ORDER.map(({ key, label }) => ({
    key,
    label,
    record: byKey.get(key) ?? null,
  }))
  const unknown = steps.filter(s => !CODEX_STEP_ORDER.some(o => o.key === s.key))
    .map(s => ({ key: s.key, label: s.label, record: s }))
  const allRows = [...known, ...unknown]

  // 最後に到達した既知ステップ (= done) を求める。
  // その次のステップを「active」として表示（スピナー）
  const lastDoneIdx = allRows.reduceRight<number>((acc, row, idx) => {
    if (acc !== -1) return acc
    return row.record?.status === "done" ? idx : -1
  }, -1)

  return (
    <ol className="space-y-1 text-[11px]">
      {allRows.map((row, idx) => {
        const rec = row.record
        const isFailed = rec?.status === "failed"
        const isDone = rec?.status === "done"
        const isExplicitlyActive = rec?.status === "active"
        // 「次に進む予定」のステップ = 最後の done の直後 + まだ完了していない + 全体が running 中
        const isImplicitActive = !rec && isRunning && !failed && idx === lastDoneIdx + 1
        const isActiveLike = isExplicitlyActive || isImplicitActive

        const Icon = isFailed
          ? XCircle
          : isDone
            ? CheckCircle2
            : isActiveLike
              ? Loader2
              : Circle

        return (
          <li
            key={row.key}
            className={cn(
              "flex items-start gap-2 leading-tight",
              isFailed ? "text-red-600 dark:text-red-300"
                : isDone ? "text-foreground"
                : isActiveLike ? "text-blue-600 dark:text-blue-300"
                : "text-muted-foreground/60",
            )}
          >
            <Icon className={cn(
              "w-3.5 h-3.5 shrink-0 mt-[1px]",
              isActiveLike && !isFailed && !isDone && "animate-spin",
              isDone && "text-emerald-500",
              isFailed && "text-red-500",
            )} />
            <span className="flex-1 min-w-0 break-words">{rec?.label ?? row.label}</span>
            {rec?.at && (
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                {formatStepTime(rec.at)}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

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

  useEffect(() => {
    setProgressOverride(null)
    setCheckError(null)
  }, [latestTask?.id, latestTask?.result])

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
  const progressSummary = progressOverride ?? getProgressSummary(resultObj)
  const progressPercent = progressSummary ? Math.max(0, Math.min(100, Math.round(progressSummary.progress_percent))) : null

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
          {latestTask.status === "completed" ? (
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
            STATUS_COLOR[latestTask.status] ?? "bg-muted text-muted-foreground",
          )}>
            {STATUS_LABEL[latestTask.status] ?? latestTask.status}
          </span>
          <span className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
            latestTask.executor === "codex" || latestTask.executor === "codex_app"
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}>
            {latestTask.executor === "codex" || latestTask.executor === "codex_app" ? "◎ Codex" : "▲ Claude"}
          </span>
          {progressSummary && (
            <span className={cn(
              "text-[11px] px-1.5 py-0.5 rounded font-medium shrink-0",
              PROGRESS_STATE_COLOR[progressSummary.state] ?? PROGRESS_STATE_COLOR.unknown,
            )}>
              {PROGRESS_STATE_LABEL[progressSummary.state] ?? "不明"}
            </span>
          )}
          <span className="min-w-0 flex-1 basis-24 truncate text-[11px] text-muted-foreground">
            {progressSummary && progressPercent !== null
              ? `${progressPercent}% / ${PROGRESS_STATE_LABEL[progressSummary.state] ?? "不明"} / ${progressSummary.current_step || progressSummary.summary}`
              : "セッション"}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        // 展開時の最大高さ。Claude QR 表示時の高さを目安に頭打ち（masonry でカードが伸びすぎないため）
        <div className="border-t px-2.5 py-2 space-y-2 max-h-[420px] overflow-y-auto">
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

          {/* セッションURLが取れるまでの待機表示（Claude のみ）*/}
          {latestTask.executor !== "codex" && latestTask.executor !== "codex_app" && isActive && !url && (
            <div className="flex items-center gap-1.5 text-[11px] text-blue-600 dark:text-blue-400">
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
              セッションを起動中...（最大 1 分）
            </div>
          )}

          {/* Codex: 進捗ステップタイムライン（実行中・完了・失敗で常に表示）*/}
          {latestTask.executor === "codex" && (() => {
            const resultObj = typeof latestTask.result === "object" && latestTask.result !== null
              ? (latestTask.result as { steps?: CodexStepRecord[]; live_log?: string; codex_thread_id?: string })
              : {}
            const steps = Array.isArray(resultObj.steps) ? resultObj.steps : []
            const liveLog = resultObj.live_log
            const threadId = resultObj.codex_thread_id
            const isFailed = latestTask.status === "failed"
            const isRunning = isActive

            return (
              <div className="space-y-2">
                {steps.length > 0 && (
                  <div className="rounded-md border bg-muted/20 p-2">
                    <CodexStepTimeline
                      steps={steps}
                      isRunning={isRunning}
                      failed={isFailed}
                    />
                    {threadId && (
                      <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground">
                        thread <span className="font-mono">{threadId.slice(0, 8)}</span> ＝
                        スマホ ChatGPT app の 💻 アイコンから接続できます
                      </div>
                    )}
                  </div>
                )}
                {/* ライブログ（起動直後は空、Codex が走ると流れ始める） */}
                {isRunning && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      ライブログ（task-runner サイクルごとに更新）
                    </div>
                    {liveLog ? (
                      <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px] leading-4 font-mono">
                        {liveLog.slice(-2500)}
                      </pre>
                    ) : (
                      <div className="rounded bg-muted/20 px-2 py-1.5 text-[10px] text-muted-foreground italic">
                        まだ出力なし（起動直後）
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* リモートセッションURL（Claude のみ） */}
          {latestTask.executor !== "codex" && url && (
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

          {/* 実際に AI に送られたプロンプト */}
          {latestTask.prompt && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {latestTask.executor === "codex" ? "Codex" : "Claude"} に送られたプロンプト（{latestTask.prompt.length} 字）
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
                {latestTask.executor === "codex" ? "Codex" : "Claude"} 実行完了
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
