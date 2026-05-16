"use client"

import { useState } from "react"
import Link from "next/link"
import QRCode from "react-qr-code"
import { Terminal, Loader2, Smartphone, Copy, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AiTask } from "@/types/ai-task"

interface NoteClaudeRunnerProps {
  noteId: string
  noteContent: string
  projectId: string | null
  repoPath: string | null
  latestTask: AiTask | null
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

export function NoteClaudeRunnerButton({
  noteId,
  noteContent,
  projectId,
  repoPath,
  latestTask,
  onStart,
}: NoteClaudeRunnerProps & { onStart: () => Promise<void> }) {
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isActive = latestTask && ACTIVE_STATUSES.has(latestTask.status)
  const isRepoConfigured = !!repoPath && repoPath.trim().length > 0
  const isProjectAssigned = !!projectId

  const handleClick = async () => {
    setError(null)
    setIsStarting(true)
    try {
      await onStart()
    } catch (e) {
      setError(e instanceof Error ? e.message : "起動に失敗しました")
    } finally {
      setIsStarting(false)
    }
  }

  const disabled = !isProjectAssigned || !isRepoConfigured || isActive || isStarting

  const title = !isProjectAssigned
    ? "プロジェクト未設定のため使用できません"
    : !isRepoConfigured
      ? "プロジェクトのリポジトリパス未設定（設定→プロジェクトから）"
      : isActive
        ? "すでに実行中のタスクがあります"
        : "このメモを Claude Code で実行"

  // 起動可能なときは強調表示（Claude ブランドカラーのアクセント）
  const visiblyEnabled = !disabled
  const isRunningNow = isActive && latestTask?.status === "running"

  return (
    <>
      <Button
        variant={visiblyEnabled ? "outline" : "ghost"}
        size="icon"
        onClick={handleClick}
        disabled={disabled}
        className={cn(
          "min-h-[44px] min-w-[44px] gap-1",
          visiblyEnabled && "border-amber-500/60 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 hover:text-amber-700 dark:text-amber-300",
          isRunningNow && "border-blue-500/60 bg-blue-500/10 text-blue-600 dark:text-blue-300",
          !isProjectAssigned || !isRepoConfigured ? "text-muted-foreground/40" : "",
        )}
        title={title}
        aria-label={title}
      >
        {isStarting || isRunningNow ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Terminal className="w-5 h-5" />
        )}
      </Button>
      {error && (
        <div className="absolute mt-8 text-[10px] text-red-600 bg-background border border-red-200 rounded px-1.5 py-0.5 shadow-sm z-10">
          {error}
        </div>
      )}
      {/* noteContent is reserved for future preview tooltip */}
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
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)

  if (!isProjectAssigned) return null

  // パス未設定の警告（タスクがまだないがプロジェクト紐付けはされている）
  if (!isRepoConfigured && !latestTask) {
    return (
      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
        <AlertCircle className="w-3 h-3 shrink-0" />
        <span>このプロジェクトにリポジトリパス未設定。</span>
        <Link href="/dashboard/settings#project-repos" className="underline hover:text-foreground inline-flex items-center gap-0.5">
          <Settings className="w-3 h-3" />
          設定
        </Link>
      </div>
    )
  }

  if (!latestTask) return null

  const isActive = ACTIVE_STATUSES.has(latestTask.status)
  const url = latestTask.remote_session_url
  const resultMessage = typeof latestTask.result === "object" && latestTask.result !== null
    ? (latestTask.result as { message?: string }).message
    : null

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
    <div className="mt-2 rounded-md border bg-background/60">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-muted/40 rounded-t-md"
      >
        <div className="flex items-center gap-1.5 min-w-0">
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
            "text-[11px] px-1.5 py-0.5 rounded font-medium",
            STATUS_COLOR[latestTask.status] ?? "bg-muted text-muted-foreground",
          )}>
            {STATUS_LABEL[latestTask.status] ?? latestTask.status}
          </span>
          <span className="text-[11px] text-muted-foreground truncate">
            Claude Code セッション
          </span>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t px-2.5 py-2 space-y-2">
          {/* セッションURLが取れるまでの待機表示 */}
          {isActive && !url && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              セッションを起動中...（最大 1 分）
            </div>
          )}

          {/* リモートセッションURL */}
          {url && (
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

          {/* 結果メッセージ */}
          {latestTask.status === "completed" && resultMessage && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">結果を表示</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[10px] font-mono">
                {resultMessage}
              </pre>
            </details>
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
