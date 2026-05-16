"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Send, Sparkles, Check, AlertCircle, FilePlus2, FilePen, Search, Calendar, Clock, CalendarSearch } from "lucide-react"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface MemoSource {
  id: string
  title: string
  description?: string
  repo_path?: string
}

// OpenAI 互換の会話履歴メッセージ
type AgentMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

interface ToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

interface ToolAction {
  tool: string
  args: Record<string, unknown>
  result: { success?: boolean; message?: string; error?: string; memo_id?: string; count?: number }
}

// UI 表示用の項目
type DisplayItem =
  | { kind: "user"; content: string }
  | { kind: "assistant"; content: string }
  | { kind: "tool"; action: ToolAction }

interface MemoRefineChatProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: MemoSource
  model: string
  /** ツール実行で何かが変更されたとき呼ばれる（メモ一覧リフレッシュ用）*/
  onTouched?: () => void
}

export function MemoRefineChat({ open, onOpenChange, source, model, onTouched }: MemoRefineChatProps) {
  // フロントが保持する OpenAI 形式履歴（API に送る）
  const [history, setHistory] = useState<AgentMessage[]>([])
  // UI 表示用（user / assistant text / tool action のフラットリスト）
  const [items, setItems] = useState<DisplayItem[]>([])
  const [input, setInput] = useState("")
  const [isWaiting, setIsWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 1セッション = 1 UUID。チャット保存の upsert キー
  const [sessionId, setSessionId] = useState<string>("")
  const scrollRef = useRef<HTMLDivElement>(null)

  // シートを開いたとき初期メッセージを GLM から取得
  useEffect(() => {
    if (open && history.length === 0) {
      // セッションID生成（チャットシート1回ぶん）
      setSessionId(crypto.randomUUID())
      // 初回: system は backend で付与されるので、user の "start" 的なシード必要なし
      // ただし GLM が黙ったままになるとUX悪いので、明示的に一発「読みました、まず質問します」を引き出すために
      // ユーザーロールで「（自動: 元メモを見て会話を始めて）」を送る
      const seed: AgentMessage = { role: "user", content: "元メモを読んで、整理を手伝ってください。まず何が必要か質問してください。" }
      void runTurn([seed], false)
    }
    if (!open) {
      // 閉じたらリセット
      setHistory([])
      setItems([])
      setInput("")
      setError(null)
      setSessionId("")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [items, isWaiting])

  const runTurn = async (nextHistory: AgentMessage[], displaySeedAsUser: boolean) => {
    setIsWaiting(true)
    setError(null)
    try {
      const res = await fetch("/api/ai/memo-refine-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory,
          source,
          model,
          session_id: sessionId || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error || `HTTP ${res.status}`)
      }
      const data = await res.json() as {
        response: string
        actions: ToolAction[]
        touched: boolean
        history_appended: AgentMessage[]
      }

      // 履歴更新（シード user は表示用にしない場合がある）
      setHistory([...nextHistory, ...data.history_appended])

      // 表示項目追加
      const newItems: DisplayItem[] = []
      const lastUserMsg = nextHistory[nextHistory.length - 1]
      if (displaySeedAsUser && lastUserMsg?.role === "user") {
        newItems.push({ kind: "user", content: lastUserMsg.content })
      }
      for (const action of data.actions) {
        newItems.push({ kind: "tool", action })
      }
      if (data.response && data.response.trim()) {
        newItems.push({ kind: "assistant", content: data.response })
      }
      setItems(prev => [...prev, ...newItems])

      // データ変更があったら親に通知
      if (data.touched && onTouched) onTouched()
    } catch (e) {
      setError(e instanceof Error ? e.message : "通信エラー")
    } finally {
      setIsWaiting(false)
    }
  }

  const sendUserMessage = async (text: string) => {
    if (!text.trim() || isWaiting) return
    setInput("")
    const trimmed = text.trim()
    const userMsg: AgentMessage = { role: "user", content: trimmed }
    // ① まずユーザーメッセージを即時表示（API応答待たない）
    setItems(prev => [...prev, { kind: "user", content: trimmed }])
    // ② API 呼び出し（"GLM が考えています..." がスピナーで出る）
    const nextHistory = [...history, userMsg]
    await runTurn(nextHistory, false)  // ユーザー表示は既に済んでいるので displaySeedAsUser=false
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] p-0 flex flex-col rounded-t-3xl">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-amber-500" />
              対話で詰める
            </SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-base text-primary px-2 py-1 -mr-2 min-h-[44px]"
            >
              閉じる
            </button>
          </div>
        </SheetHeader>

        {/* 元メモ（折りたたみ） */}
        <details className="border-b shrink-0 bg-muted/30">
          <summary className="px-4 py-2.5 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
            元メモを見る
          </summary>
          <div className="px-4 pb-3 space-y-1.5">
            <div className="text-sm font-medium">{source.title}</div>
            {source.description && (
              <div className="text-xs text-muted-foreground whitespace-pre-wrap">{source.description}</div>
            )}
            {source.repo_path && (
              <div className="text-[10px] text-muted-foreground font-mono">{source.repo_path}</div>
            )}
          </div>
        </details>

        {/* チャット履歴 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
          {items.length === 0 && !isWaiting && (
            <div className="text-center text-sm text-muted-foreground py-12">
              GLM があなたのメモを読んで、質問を考えます...
            </div>
          )}
          {items.map((item, i) => (
            <DisplayRow key={i} item={item} />
          ))}
          {isWaiting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              GLM が考えています...
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* 入力欄 */}
        <div className="border-t px-3 py-2 shrink-0 bg-background">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendUserMessage(input) } }}
              placeholder="返信を入力..."
              disabled={isWaiting}
              className="flex-1 min-h-[44px] rounded-xl bg-muted/60 px-3 text-base outline-none focus:bg-muted disabled:opacity-50"
            />
            <Button
              type="button"
              onClick={() => sendUserMessage(input)}
              disabled={!input.trim() || isWaiting}
              className="min-h-[44px] min-w-[56px]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="px-1 pt-1 text-[10px] text-muted-foreground leading-3">
            「2つに分けて」「明日朝8時に30分でやりたい」「カレンダーに入れて」など自然な指示で OK
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DisplayRow({ item }: { item: DisplayItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-primary text-primary-foreground px-3 py-2 text-sm whitespace-pre-wrap">
          {item.content}
        </div>
      </div>
    )
  }
  if (item.kind === "assistant") {
    return (
      <div className="flex items-start gap-1.5">
        <div className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 text-[10px] font-bold">G</div>
        <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
          {item.content}
        </div>
      </div>
    )
  }
  // tool
  return <ToolChip action={item.action} />
}

function ToolChip({ action }: { action: ToolAction }) {
  const success = action.result?.success !== false  // undefined or true は成功扱い
  const args = action.args || {}

  const formatScheduledAt = (iso: unknown): string => {
    if (typeof iso !== "string") return ""
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ""
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short" })
  }

  const config = {
    update_current_memo: {
      icon: <FilePen className="h-3 w-3" />,
      label: "メモ更新",
      detail: typeof args.title === "string" ? `「${args.title.slice(0, 30)}」` : "",
    },
    create_new_memo: {
      icon: <FilePlus2 className="h-3 w-3" />,
      label: "新規メモ作成",
      detail: typeof args.title === "string" ? `「${args.title.slice(0, 30)}」` : "",
    },
    list_my_memos: {
      icon: <Search className="h-3 w-3" />,
      label: "他メモ検索",
      detail: typeof args.query === "string" ? `「${args.query}」(${action.result?.count ?? 0}件)` : `(${action.result?.count ?? 0}件)`,
    },
    schedule_memo: {
      icon: <Clock className="h-3 w-3" />,
      label: "予定設定",
      detail: `${formatScheduledAt(args.scheduled_at)} / ${args.duration_minutes ?? "?"}分`,
    },
    add_to_calendar: {
      icon: <Calendar className="h-3 w-3" />,
      label: "カレンダー登録",
      detail: "",
    },
    list_calendar_events: {
      icon: <CalendarSearch className="h-3 w-3" />,
      label: "予定確認",
      detail: typeof args.date === "string" ? `${args.date} (${action.result?.count ?? 0}件)` : "",
    },
  }[action.tool] ?? { icon: null, label: action.tool, detail: "" }

  return (
    <div className="flex justify-center">
      <div className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]",
        success
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
      )}>
        {success ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
        {config.icon}
        <span className="font-medium">{config.label}</span>
        {config.detail && <span className="text-muted-foreground">{config.detail}</span>}
        {!success && action.result?.error && (
          <span className="text-muted-foreground">— {action.result.error}</span>
        )}
      </div>
    </div>
  )
}
