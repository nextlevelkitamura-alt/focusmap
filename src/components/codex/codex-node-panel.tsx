"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CodexDirPicker } from "@/components/codex/codex-dir-picker"

type NodeInfo = {
  taskId: string
  title: string
  memo: string
  cwd: string | null
  status: string | null
}

type CodexNodePanelProps = {
  open: boolean
  node: NodeInfo
  /** 作業場所の履歴候補 */
  candidates: string[]
  onClose: () => void
  /** codex_work_dir を tasks に保存 */
  onPersistDir: (taskId: string, dir: string) => Promise<void> | void
}

function buildDefaultPrompt(title: string, memo: string): string {
  const t = title.trim()
  const m = memo.trim()
  return m ? `${t}\n\n${m}` : t
}

function statusLabel(status: string | null): { dot: string; text: string } | null {
  if (status === "running") return { dot: "bg-amber-400 animate-pulse", text: "作業中" }
  if (status === "done") return { dot: "bg-emerald-500", text: "完了" }
  if (status === "failed") return { dot: "bg-rose-500", text: "失敗" }
  return null
}

// マインドマップのノードから Codex を「メニューで」操作するパネル。
//   - 実行/往復は全部ここから（プロンプト編集ボックスで毎回確認して再注入）
//   - 作業場所(cwd) と 状態 と 最新の返信 を一元表示
//   - 1ノード=1会話: thread があれば「続けて送る」(resume)、無ければ新規(thread/start)
export function CodexNodePanel({ open, node, candidates, onClose, onPersistDir }: CodexNodePanelProps) {
  const [cwd, setCwd] = useState<string>(node.cwd ?? "")
  const [promptText, setPromptText] = useState<string>(buildDefaultPrompt(node.title, node.memo))
  const [threadId, setThreadId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(node.status)
  const [reply, setReply] = useState<string>("")
  const [showFull, setShowFull] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 開いたら最新の実行(返信/スレッド/状態)を取得
  useEffect(() => {
    if (!open) return
    setCwd(node.cwd ?? "")
    setPromptText(buildDefaultPrompt(node.title, node.memo))
    setSent(false)
    setErr(null)
    let aborted = false
    ;(async () => {
      try {
        const res = await fetch(`/api/codex/node-thread?taskId=${encodeURIComponent(node.taskId)}`)
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        if (aborted || !data?.task) return
        setThreadId(data.task.thread_id ?? null)
        setStatus(data.task.status === "running" ? "running" : data.task.status === "failed" ? "failed" : data.task.status ? "done" : node.status)
        setReply(typeof data.task.reply === "string" ? data.task.reply : "")
        if (!node.cwd && data.task.cwd) setCwd(data.task.cwd)
      } catch {
        /* ignore */
      }
    })()
    return () => { aborted = true }
  }, [open, node.taskId, node.cwd, node.title, node.memo, node.status])

  const run = useCallback(async () => {
    const prompt = promptText.trim()
    if (!prompt || sending) return
    if (!cwd.trim()) { setPickerOpen(true); return }
    setSending(true)
    setErr(null)
    try {
      const res = await fetch("/api/ai-tasks/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          cwd: cwd.trim(),
          executor: "codex",
          source_task_id: node.taskId,
          codex_resume_thread_id: threadId || undefined,
          approval_type: "auto",
          scheduled_at: new Date().toISOString(),
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setErr(e?.error ?? `送信失敗 (${res.status})`)
        return
      }
      setSent(true)
      setStatus("running")
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [promptText, sending, cwd, node.taskId, threadId])

  const st = statusLabel(status)

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              {st && <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />}
              <span className="truncate">Codex作業 — {node.title}</span>
            </DialogTitle>
          </DialogHeader>

          {/* 状態・作業場所 */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">状態</span>
              <span>{st ? st.text : "未実行"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-muted-foreground">作業場所</span>
              <span className="flex-1 truncate font-mono text-[11px]" title={cwd}>{cwd || "未設定"}</span>
              <button type="button" onClick={() => setPickerOpen(true)}
                className="shrink-0 rounded-md border border-border/60 px-2 py-0.5 hover:bg-muted">変更</button>
            </div>
          </div>

          {/* プロンプト編集（再注入） */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">送るプロンプト（編集可）</span>
              <button type="button" onClick={() => setPromptText(buildDefaultPrompt(node.title, node.memo))}
                className="text-[11px] text-primary hover:underline">↻ ノード内容から作り直す</button>
            </div>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm"
              placeholder="Codex に送る指示…"
            />
            <button
              type="button"
              onClick={run}
              disabled={sending || !promptText.trim()}
              className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {sending ? "送信中…" : threadId ? "続けて送る（この会話に注入）" : "注入して実行"}
            </button>
            {sent && <p className="text-[11px] text-emerald-500">送信しました（最大1分でMacが実行 → 完了で🟢）</p>}
            {err && <p className="text-[11px] text-rose-500">{err}</p>}
          </div>

          {/* 返信 */}
          {reply && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">Codexの返信</span>
                <button type="button" onClick={() => setShowFull((v) => !v)}
                  className="text-[11px] text-primary hover:underline">{showFull ? "要約" : "全文"}</button>
              </div>
              <div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-xs">
                {showFull ? reply : reply.slice(0, 280) + (reply.length > 280 ? "…" : "")}
              </div>
            </div>
          )}

          {threadId && (
            <p className="text-[10px] text-muted-foreground">
              スレッド {threadId.slice(0, 8)} — Codexアプリ / ペアリング済みスマホにも表示されます
            </p>
          )}
        </DialogContent>
      </Dialog>

      <CodexDirPicker
        open={pickerOpen}
        nodeTitle={node.title}
        candidates={candidates}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(dir) => {
          setPickerOpen(false)
          setCwd(dir)
          void onPersistDir(node.taskId, dir)
        }}
      />
    </>
  )
}
