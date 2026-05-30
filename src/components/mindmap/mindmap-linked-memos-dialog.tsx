"use client"

import { useEffect, useState } from "react"
import { Bot, ExternalLink, Loader2, StickyNote } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { getCodexTaskUiState } from "@/lib/codex-run-state"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import type { IdealGoalWithItems } from "@/types/database"

type LinkedMemoDialogTarget = {
  taskId: string
  requestKey: number
}

type LinkedNote = {
  id: string
  title?: string | null
  content?: string | null
  body?: string | null
  updated_at?: string | null
}

type LinkedMemoResponse = {
  task?: {
    id: string
    title?: string | null
  } | null
  items?: IdealGoalWithItems[]
  source_items?: IdealGoalWithItems[]
  notes?: LinkedNote[]
  error?: string
}

interface MindmapLinkedMemosDialogProps {
  target: LinkedMemoDialogTarget | null
  onOpenChange: (open: boolean) => void
  onOpenMemoHome?: () => void
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("ja-JP", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function memoStatusLabel(memo: IdealGoalWithItems) {
  if (memo.is_completed || memo.memo_status === "completed") return "完了"
  if (memo.google_event_id || memo.scheduled_at || memo.memo_status === "scheduled") return "予定済み"
  if (memo.is_today) return "今日する"
  if ((memo as { mindmap_link_count?: number | null }).mindmap_link_count) return "マップ追加済み"
  return "未予定"
}

function durationLabel(minutes: number | null | undefined) {
  if (!minutes) return null
  return `${minutes}分`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function reviewReasonLabel(value: string | null) {
  if (value === "completed") return "実行完了"
  if (value === "aborted") return "停止"
  if (value === "archived") return "アーカイブ"
  if (value === "monitoring_lost") return "監視確認"
  if (value === "started") return "実行開始"
  return value || null
}

function sanitizeCodexDisplayLog(value: string): string {
  const seen = new Set<string>()
  return value
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block && !/^\[(developer|system|user)\]/i.test(block))
    .filter(block => {
      const key = block.replace(/\s+/g, " ")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join("\n\n")
    .trim()
}

export function MindmapLinkedMemosDialog({
  target,
  onOpenChange,
  onOpenMemoHome,
}: MindmapLinkedMemosDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskTitle, setTaskTitle] = useState("")
  const [memos, setMemos] = useState<IdealGoalWithItems[]>([])
  const [notes, setNotes] = useState<LinkedNote[]>([])
  const { getBySourceId: getAiTaskBySourceId } = useMemoAiTasks()
  const codexTask = target?.taskId ? getAiTaskBySourceId(target.taskId) : null
  const isCodexTask = codexTask?.executor === "codex" || codexTask?.executor === "codex_app"
  const codexUiState = getCodexTaskUiState(codexTask)
  const codexResult = asRecord(codexTask?.result)
  const codexSnapshot = asRecord(codexResult.codex_thread_snapshot)
  const codexThreadId = stringValue(codexResult.codex_thread_id) || codexTask?.codex_thread_id || ""
  const codexReviewReason = reviewReasonLabel(stringValue(codexResult.codex_review_reason) || null)
  const codexLastActivity = formatDate(stringValue(codexResult.last_activity_at))
  const codexMessage = stringValue(codexResult.message)
  const codexLiveLog = stringValue(codexResult.live_log)
  const codexPreview = stringValue(codexSnapshot.preview)
  const codexLogCandidates = [codexMessage, codexLiveLog, codexPreview]
    .map(sanitizeCodexDisplayLog)
    .filter(Boolean)
  const codexLogBlocks = codexLogCandidates
    .filter((value, index, arr) => arr.findIndex(other => other.includes(value)) === index)
  const codexDisplayLog = codexLogBlocks.join("\n\n").slice(-6000)
  const hasCodexRun = !!codexTask && isCodexTask

  useEffect(() => {
    if (!target) return
    const taskId = target.taskId
    let cancelled = false
    setIsLoading(true)
    setError(null)
    setTaskTitle("")
    setMemos([])
    setNotes([])

    async function loadLinkedMemos() {
      try {
        const res = await fetch(`/api/mindmap/memo-links?task_id=${encodeURIComponent(taskId)}`, {
          cache: "no-store",
        })
        const data = await res.json() as LinkedMemoResponse
        if (!res.ok) throw new Error(data?.error || "関連メモの取得に失敗しました")
        if (cancelled) return

        const legacyItems = Array.isArray(data.items) ? data.items : []
        const sourceItems = Array.isArray(data.source_items) ? data.source_items : []
        const linkedItems = [...new Map([...legacyItems, ...sourceItems].map(item => [item.id, item])).values()]

        setTaskTitle(typeof data.task?.title === "string" ? data.task.title : "")
        setMemos(linkedItems)
        setNotes(Array.isArray(data.notes) ? data.notes : [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "関連メモの取得に失敗しました")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadLinkedMemos()
    return () => {
      cancelled = true
    }
  }, [target])

  const totalCount = memos.length + notes.length
  const title = taskTitle ? `「${taskTitle}」の関連メモ` : "関連メモ"
  const description = isLoading
    ? "読み込み中..."
    : error
      ? error
      : `${totalCount}件のメモ${hasCodexRun && codexUiState ? ` / Codex ${codexUiState.label}` : ""}`

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1rem)] max-w-7xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base">{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </div>
            {onOpenMemoHome && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenMemoHome}
                className="mr-3 hidden shrink-0 gap-1.5 sm:inline-flex"
              >
                <StickyNote className="h-4 w-4" />
                全メモ
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex min-h-[34vh] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              関連メモを読み込み中...
            </div>
          ) : error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : totalCount === 0 && !hasCodexRun ? (
            <div className="flex min-h-[34vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>このノードに紐付くメモはありません</p>
              {onOpenMemoHome && (
                <Button type="button" variant="outline" onClick={onOpenMemoHome}>
                  全メモを開く
                </Button>
              )}
            </div>
          ) : (
            <section className="mx-auto w-full max-w-6xl space-y-4">
              {hasCodexRun && (
                <section className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-emerald-500" />
                        <h3 className="text-sm font-semibold">Codex状況</h3>
                        {codexUiState && (
                          <span className={codexUiState.state === "running"
                            ? "rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                            : "rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"}
                          >
                            {codexUiState.label}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        15秒ごとにCodexログを同期しています
                        {codexReviewReason ? ` / ${codexReviewReason}` : ""}
                        {codexLastActivity ? ` / 最終活動 ${codexLastActivity}` : ""}
                      </p>
                    </div>
                    {codexThreadId && (
                      <span className="rounded bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
                        thread {codexThreadId.slice(0, 8)}
                      </span>
                    )}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
                    <div className="min-w-0 space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">送信プロンプト</div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border bg-background/80 p-3 text-xs leading-5">
                        {codexTask?.prompt?.trim() || "プロンプトは記録されていません"}
                      </pre>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Codexログ / 回答</div>
                      {codexDisplayLog ? (
                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border bg-background/80 p-3 font-mono text-xs leading-5">
                          {codexDisplayLog}
                        </pre>
                      ) : (
                        <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed bg-background/50 px-3 py-8 text-sm text-muted-foreground">
                          まだログはありません
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {totalCount > 0 ? (
                <section className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">メモ詳細</h3>
                    <span className="text-xs text-muted-foreground">{totalCount}件</span>
                  </div>
                  <div className="space-y-3">
                {memos.map(memo => {
                  const body = memo.description?.trim()
                  const scheduledAt = formatDate(memo.scheduled_at)
                  const updatedAt = formatDate(memo.updated_at)
                  const createdAt = formatDate(memo.created_at)
                  const tags = memo.tags ?? []
                  const subItems = memo.ideal_items ?? []

                  return (
                    <article key={memo.id} className="min-w-0 rounded-lg border bg-background p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <h4 className="min-w-0 break-words text-base font-semibold leading-6">{memo.title}</h4>
                        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {memoStatusLabel(memo)}
                        </span>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
                        <div className="min-w-0 space-y-3">
                          {body ? (
                            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/90">{body}</p>
                          ) : (
                            <p className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                              本文はありません
                            </p>
                          )}
                          {subItems.length > 0 && (
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-muted-foreground">サブタスク候補</div>
                              <ul className="space-y-1.5">
                                {subItems.map(subItem => (
                                  <li key={subItem.id} className="flex items-start gap-2 rounded-md border bg-muted/10 px-2.5 py-2 text-xs">
                                    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-muted-foreground/50" />
                                    <span className="min-w-0 flex-1 break-words">{subItem.title}</span>
                                    {subItem.session_minutes > 0 && (
                                      <span className="shrink-0 text-muted-foreground">{subItem.session_minutes}分</span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        <aside className="min-w-0 space-y-3 rounded-md bg-muted/20 p-3 text-xs">
                          <div className="space-y-1">
                            <div className="text-muted-foreground">状態</div>
                            <div className="font-medium">{memoStatusLabel(memo)}</div>
                          </div>
                          {memo.category && (
                            <div className="space-y-1">
                              <div className="text-muted-foreground">カテゴリ</div>
                              <div className="font-medium">{memo.category}</div>
                            </div>
                          )}
                          {tags.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-muted-foreground">タグ</div>
                              <div className="flex flex-wrap gap-1">
                                {tags.map(tag => (
                                  <span key={tag} className="rounded bg-background px-1.5 py-0.5">{tag}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {scheduledAt && (
                            <div className="space-y-1">
                              <div className="text-muted-foreground">予定</div>
                              <div className="font-medium">{scheduledAt}</div>
                            </div>
                          )}
                          {durationLabel(memo.duration_minutes) && (
                            <div className="space-y-1">
                              <div className="text-muted-foreground">所要時間</div>
                              <div className="font-medium">{durationLabel(memo.duration_minutes)}</div>
                            </div>
                          )}
                          {(updatedAt || createdAt) && (
                            <div className="space-y-1">
                              <div className="text-muted-foreground">更新</div>
                              <div>{updatedAt ?? createdAt}</div>
                            </div>
                          )}
                        </aside>
                      </div>
                    </article>
                  )
                })}

                {notes.map(note => {
                  const body = (note.content ?? note.body ?? "").trim()
                  return (
                    <article key={note.id} className="min-w-0 rounded-lg border bg-background p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                        <h4 className="min-w-0 break-words text-base font-semibold leading-6">{note.title || "ノート"}</h4>
                        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">note</span>
                      </div>
                      {body ? (
                        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-foreground/90">{body}</p>
                      ) : (
                        <p className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
                          本文はありません
                        </p>
                      )}
                      {formatDate(note.updated_at) && (
                        <div className="mt-3 text-xs text-muted-foreground">更新: {formatDate(note.updated_at)}</div>
                      )}
                    </article>
                  )
                })}
                  </div>
                </section>
              ) : (
                <div className="rounded-md border border-dashed bg-muted/10 px-3 py-5 text-center text-sm text-muted-foreground">
                  このノードに紐付くメモはありません
                </div>
              )}
            </section>
          )}
        </div>

        {onOpenMemoHome && (
          <div className="shrink-0 border-t px-5 py-3 sm:hidden">
            <Button type="button" variant="outline" onClick={onOpenMemoHome} className="w-full gap-1.5">
              <ExternalLink className="h-4 w-4" />
              全メモを開く
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
