"use client"

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder"
import {
  buildCodexOpenTarget,
  canUseLocalCodexOpenApi,
  isLikelyMobileDevice,
  launchCodexViaLocalApi,
  launchFeedbackForMode,
  normalizeCodexPrompt,
  type CodexLaunchMode,
} from "@/lib/codex-app-launch"
import { ExternalLink, Laptop, Loader2, Mic, Save, Smartphone, Sparkles, Square, TriangleAlert } from "lucide-react"

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

const RUNNER_ONLINE_WINDOW_MS = 2 * 60 * 1000
const RUNNER_STATUS_POLL_MS = 10_000

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
  const [heading, setHeading] = useState(node.title)
  const [detail, setDetail] = useState(node.memo)
  const [error, setError] = useState<string | null>(null)
  const [codexFeedback, setCodexFeedback] = useState<string | null>(null)
  const [codexSendStatus, setCodexSendStatus] = useState<CodexSendStatus>("idle")
  const [codexRunnerStatus, setCodexRunnerStatus] = useState<CodexRunnerStatus>({ checked: false, ready: false })
  const [isMobileOpenTarget, setIsMobileOpenTarget] = useState(false)
  const [isGeneratingHeading, setIsGeneratingHeading] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const saveVersionRef = useRef(0)

  useEffect(() => {
    if (!open) return
    setIsMobileOpenTarget(isLikelyMobileDevice())
    setHeading(node.title)
    setDetail(node.memo)
    setError(null)
    setCodexFeedback(null)
    setCodexSendStatus("idle")
    setCodexRunnerStatus({ checked: false, ready: false })
    setIsGeneratingHeading(false)
    setSaveStatus("saved")
  }, [open, node.taskId, node.title, node.memo])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const fetchRunnerStatus = async () => {
      try {
        const res = await fetch("/api/ai-runners", { cache: "no-store" })
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
  const codexOpenTarget = buildCodexOpenTarget(
    { prompt: codexPrompt, repoPath: codexRepoPath || null },
    { preferMobile: isMobileOpenTarget },
  )
  const codexHref = codexOpenTarget.url

  const sendToCodex = useCallback(async (event?: MouseEvent<HTMLAnchorElement>) => {
    const promptHeading = heading || node.title
    if (!normalizeCodexPrompt(promptHeading) && !normalizeCodexPrompt(detail)) {
      event?.preventDefault()
      setError("Codexに渡す内容を入力してください")
      return
    }

    const prompt = buildCodexPrompt(promptHeading, detail)
    const repoPath = (node.cwd?.trim() || candidates.find(candidate => candidate.trim()) || "").trim()
    const openTarget = buildCodexOpenTarget(
      {
        prompt,
        repoPath: repoPath || null,
        originUrl: typeof window !== "undefined" ? window.location.href : null,
      },
      { preferMobile: isMobileOpenTarget },
    )
    const useLocalApi = canUseLocalCodexOpenApi() && !isMobileOpenTarget
    event?.preventDefault()
    let launchMode: CodexLaunchMode | null = null
    setError(null)
    setCodexFeedback(null)
    setCodexSendStatus("sending")

    try {
      const clipboardPromise = copyPromptToClipboard(prompt)
      const dispatchMode = repoPath && (useLocalApi || codexRunnerStatus.ready) ? "auto" : "manual"
      const savePromise = saveDraft(heading, detail)
      const schedulePromise = fetch("/api/ai-tasks/schedule", {
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
        }),
      })
      const launchPromise = useLocalApi
        ? launchCodexViaLocalApi({ prompt, repoPath: repoPath || null })
          .then(result => ({ result, error: null }))
          .catch(error => ({ result: null, error }))
        : Promise.resolve({ result: { mode: openTarget.mode, url: openTarget.url, copiedToClipboard: false }, error: null })

      if (!useLocalApi && typeof window !== "undefined") {
        launchMode = openTarget.mode
        window.location.href = openTarget.url
      }

      let copiedToClipboard = await clipboardPromise
      await savePromise
      const scheduleRes = await schedulePromise
      let handoffWarning: string | null = null
      if (!scheduleRes.ok && scheduleRes.status !== 409) {
        const data = await scheduleRes.json().catch(() => ({})) as { error?: string }
        handoffWarning = data.error || `Codex送信準備に失敗しました (${scheduleRes.status})`
      }

      const launchOutcome = await launchPromise
      if (launchOutcome.error) throw launchOutcome.error
      launchMode = launchOutcome.result?.mode ?? launchMode ?? openTarget.mode
      if (launchOutcome.result?.copiedToClipboard) copiedToClipboard = true

      setCodexSendStatus("sent")
      const copyFeedback = copiedToClipboard ? "プロンプトはコピー済みです。" : "プロンプトのコピーに失敗しました。"
      if (handoffWarning) {
        setError(`${copyFeedback} ${handoffWarning}`)
      } else {
        const dispatchFeedback = dispatchMode === "auto"
          ? "MacのrunnerにもCodex.app実行を依頼しました。"
          : isMobileOpenTarget
            ? "ChatGPTアプリのCodex画面で貼り付けて開始してください。"
            : repoPath
            ? "Macセットアップ未完了のため、今回はCodex.appで貼り付けて開始してください。"
            : "リポジトリ未設定のため、Codex.appで貼り付けて開始してください。"
        setCodexFeedback(
          `${launchFeedbackForMode(launchMode ?? "browser-deep-link")} ${copyFeedback} ${dispatchFeedback}`,
        )
      }
    } catch (err) {
      setCodexSendStatus(launchMode ? "sent" : "idle")
      setError(err instanceof Error ? err.message : "Codexに送れませんでした")
    }
  }, [candidates, codexRunnerStatus.ready, detail, heading, isMobileOpenTarget, node.cwd, node.taskId, node.title, saveDraft])

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
            <textarea
              value={detail}
              onChange={(event) => handleDetailChange(event.target.value)}
              className="min-h-[44dvh] w-full resize-y rounded-lg border border-border/70 bg-background px-4 py-3 text-base leading-relaxed outline-none focus:border-primary"
              placeholder="メモの詳細を書いてください"
            />

            {showCodexSetupPrompt && (
              <div className="rounded-md border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-1.5 font-medium">
                    <TriangleAlert className="h-3.5 w-3.5" />
                    Codex自動実行はMac未接続
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
                  今回はコピーとCodex.app起動だけ実行します。セットアップ後はこのボタンからMac側で実行できます。
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
