"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight, History, Loader2, MessageSquare, X, Clock } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

interface ChatLogSummary {
  session_id: string
  source_memo_title: string | null
  turn_count: number
  created_at: string
  updated_at: string
  action_count: number
}

interface ChatLogDetail {
  id: string
  session_id: string
  source_memo_title: string | null
  source_snapshot: { title?: string; description?: string | null; repo_path?: string | null } | null
  messages: Array<{ role: string; content?: string | null; tool_call_id?: string; tool_calls?: unknown[] }>
  actions: Array<{ tool: string; args: Record<string, unknown>; result: { success?: boolean; message?: string; error?: string } }>
  turn_count: number
  created_at: string
  updated_at: string
}

interface MemoChatHistoryProps {
  memoId: string
  /** リスト表示の上限。デフォルト3件、「もっと見る」で全件展開 */
  initialLimit?: number
}

export function MemoChatHistory({ memoId, initialLimit = 3 }: MemoChatHistoryProps) {
  const [logs, setLogs] = useState<ChatLogSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/ai/memo-chat-logs?memo_id=${memoId}`)
      if (res.ok) {
        const data = await res.json() as { logs: ChatLogSummary[] }
        setLogs(data.logs ?? [])
      }
    } finally {
      setIsLoading(false)
    }
  }, [memoId])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40px] text-xs text-muted-foreground gap-2">
        <Loader2 className="h-3 w-3 animate-spin" /> 対話履歴を読み込み中
      </div>
    )
  }

  if (logs.length === 0) {
    // 履歴がない場合は何も表示しない（ノイズ回避）
    return null
  }

  const visibleLogs = showAll ? logs : logs.slice(0, initialLimit)

  return (
    <>
      <div className="space-y-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <History className="h-3 w-3" />
          対話履歴（{logs.length}件、30日保存）
        </div>
        <div className="rounded-2xl bg-card overflow-hidden divide-y divide-border/40 border">
          {visibleLogs.map(log => (
            <button
              key={log.session_id}
              type="button"
              onClick={() => setSelectedSession(log.session_id)}
              className="w-full flex items-center gap-2 min-h-[52px] px-3 py-2 text-left active:bg-muted/60"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">
                  {log.turn_count} ターン
                  {log.action_count > 0 && (
                    <span className="ml-1 text-muted-foreground">/ {log.action_count}件のアクション</span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5" />
                  {formatRelativeTime(log.updated_at)}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </button>
          ))}
        </div>
        {logs.length > initialLimit && !showAll && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-[11px] text-primary px-2 py-1"
          >
            残り {logs.length - initialLimit} 件を表示
          </button>
        )}
      </div>

      {/* セッション詳細シート */}
      <ChatLogDetailSheet
        sessionId={selectedSession}
        onClose={() => setSelectedSession(null)}
      />
    </>
  )
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "今"
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}日前`
  return new Date(iso).toLocaleDateString("ja-JP")
}

function ChatLogDetailSheet({
  sessionId,
  onClose,
}: {
  sessionId: string | null
  onClose: () => void
}) {
  const [detail, setDetail] = useState<ChatLogDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!sessionId) {
      setDetail(null)
      return
    }
    setIsLoading(true)
    fetch(`/api/ai/memo-chat-logs?session_id=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setDetail(data))
      .finally(() => setIsLoading(false))
  }, [sessionId])

  const open = !!sessionId

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="h-[90vh] p-0 flex flex-col rounded-t-3xl">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base flex items-center gap-1.5">
              <History className="h-4 w-4" />
              対話履歴
            </SheetTitle>
            <button
              type="button"
              onClick={onClose}
              className="text-base text-primary px-2 py-1 -mr-2 min-h-[44px]"
              aria-label="閉じる"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> 読み込み中
            </div>
          )}

          {detail && (
            <>
              {/* メタ情報 */}
              <div className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
                <div>開始: {new Date(detail.created_at).toLocaleString("ja-JP")}</div>
                <div>更新: {new Date(detail.updated_at).toLocaleString("ja-JP")}</div>
                <div>{detail.turn_count} ターン、{detail.actions.length} 件のアクション実行</div>
              </div>

              {/* 元メモスナップショット */}
              {detail.source_snapshot && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    開始時のメモ内容
                  </summary>
                  <div className="mt-1 rounded-lg bg-muted/30 p-2 space-y-1">
                    <div className="font-medium">{detail.source_snapshot.title}</div>
                    {detail.source_snapshot.description && (
                      <div className="text-[11px] text-muted-foreground whitespace-pre-wrap">
                        {detail.source_snapshot.description}
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* メッセージ + アクション履歴 */}
              <div className="space-y-2">
                {detail.messages.map((m, i) => {
                  if (m.role === "system") return null
                  if (m.role === "tool") {
                    // ツール実行結果は actions 配列で見やすく表示するので、ここはスキップ
                    return null
                  }
                  const content = typeof m.content === "string" ? m.content : ""
                  const hasToolCalls = m.tool_calls && (m.tool_calls as unknown[]).length > 0
                  if (!content && !hasToolCalls) return null
                  return (
                    <div key={i} className={cn(
                      "flex",
                      m.role === "user" ? "justify-end" : "items-start gap-1.5",
                    )}>
                      {m.role === "assistant" && (
                        <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold">G</div>
                      )}
                      <div className={cn(
                        "max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-tr-md"
                          : "bg-muted rounded-tl-md",
                      )}>
                        {content || (hasToolCalls ? <span className="italic text-muted-foreground">（ツール呼び出しのみ）</span> : "")}
                      </div>
                    </div>
                  )
                })}

                {/* 実行されたアクション一覧 */}
                {detail.actions.length > 0 && (
                  <div className="mt-3 pt-3 border-t space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      実行されたアクション
                    </div>
                    {detail.actions.map((a, i) => {
                      const success = a.result?.success !== false
                      const args = a.args || {}
                      return (
                        <div key={i} className={cn(
                          "text-[11px] rounded-md px-2 py-1.5 border",
                          success ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300" : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
                        )}>
                          <span className="font-mono">{a.tool}</span>
                          {typeof args.title === "string" && <span className="ml-1">「{args.title.slice(0, 40)}」</span>}
                          {a.result?.error && <span className="ml-1 text-muted-foreground">— {a.result.error}</span>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
