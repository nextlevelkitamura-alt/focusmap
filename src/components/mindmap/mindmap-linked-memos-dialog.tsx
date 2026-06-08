"use client"

import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Check, Copy, ExternalLink, Loader2, RefreshCw } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  appendCodexHandoffToken,
  beginCopyPromptForCodexHandoff,
  buildCodexHandoffToken,
  buildCodexOpenTarget,
  canUseLocalCodexOpenApi,
  copyPromptForCodexHandoff,
  getCurrentMobilePlatform,
  isLikelyMobileDevice,
  launchCodexFromBrowser,
  launchCodexViaLocalApi,
  normalizeCodexPrompt,
  openCodexMobileTargetViaFocusmapNativeApp,
} from "@/lib/codex-app-launch"
import { getCodexTaskUiState } from "@/lib/codex-run-state"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import { useCodexManualHandoffConfirmation } from "@/hooks/useCodexManualHandoffConfirmation"
import { useMemoAiTasks } from "@/hooks/useMemoAiTasks"
import type { AiTask, AiTaskActivityMessage } from "@/types/ai-task"
import type { Project, Task } from "@/types/database"

const CODEX_DISPLAY_LOG_CHARS = 80_000
const CODEX_ACTIVITY_SYNC_INTERVAL_MS = 3_000
const CODEX_WATCH_PING_INTERVAL_MS = 10_000

type LinkedMemoDialogTarget = {
  taskId: string
  requestKey: number
}

type TaskResponse = {
  success?: boolean
  task?: Task
  error?: string | { message?: string }
}

type CodexChatEntry = {
  kind: "request" | "event" | "user"
  text: string
}

type CodexConversation = {
  entries: CodexChatEntry[]
  processLogs: string[]
}

interface MindmapLinkedMemosDialogProps {
  target: LinkedMemoDialogTarget | null
  projects: Project[]
  onOpenChange: (open: boolean) => void
  onTaskUpdated?: (taskId: string, updates: Partial<Task>) => Promise<void>
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeText(value: string) {
  return normalizeCodexPrompt(value)
}

function buildCodexPrompt(title: string, memo: string) {
  const normalizedTitle = normalizeText(title)
  const normalizedMemo = normalizeText(memo)
  return [
    normalizedTitle || null,
    normalizedMemo || null,
  ].filter(Boolean).join("\n\n")
}

function openCodexFromLinkedDialog(prompt: string, repoPath: string | null, threadUrl?: string | null) {
  if (isLikelyMobileDevice()) {
    const target = buildCodexOpenTarget(
      { prompt, repoPath, threadUrl: threadUrl || null },
      { preferMobile: true, mobilePlatform: getCurrentMobilePlatform() },
    )
    if (openCodexMobileTargetViaFocusmapNativeApp(target.url, prompt, "urls" in target ? target.urls : undefined)) return
    window.location.href = target.url
    return
  }

  launchCodexFromBrowser({ prompt, repoPath, threadUrl: threadUrl || null })
}

function stripFocusmapSyncId(prompt: string) {
  return prompt
    .replace(/\n?---\nFocusmap同期ID:\s+FM-[^\n]+\nこの同期IDはFocusmap連携用です。返信では触れないでください。\s*$/u, "")
    .trim()
}

function taskErrorMessage(data: TaskResponse, fallback: string) {
  if (typeof data.error === "string") return data.error
  if (data.error?.message) return data.error.message
  return fallback
}

function isGenericCodexPulseText(value: string) {
  return /Codex\.appの稼働シグナルを確認中|Codex\.appが作業中です|Codex セッションは確認待ちです/u.test(value.trim())
}

function sanitizeCodexDisplayLog(value: string): string {
  const seen = new Set<string>()
  return value
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block => block && !/^\[(developer|system)\]/i.test(block))
    .filter(block => !/^Focusmap同期ID:/i.test(block))
    .filter(block => !isGenericCodexPulseText(block))
    .filter(block => !/^Codex\.appでプロンプトを送信すると、Focusmapはthread状態とログだけ同期します。/i.test(block))
    .filter(block => {
      const key = block.replace(/\s+/g, " ")
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join("\n\n")
    .trim()
}

function getCodexCompletionNotice(value: string): string {
  for (const rawBlock of value.split(/\n{2,}/)) {
    const block = rawBlock.trim()
    if (/^Codex thread .*マップノードを完了にしました。?$/.test(block)) return block
  }
  return ""
}

function buildCodexDisplayLog(liveLog: string, message: string, preview: string): string {
  const completionNotice = getCodexCompletionNotice(message)
  const base = liveLog || message || preview
  return sanitizeCodexDisplayLog([
    base,
    completionNotice && !base.includes(completionNotice) ? `[Codex] ${completionNotice}` : null,
  ].filter(Boolean).join("\n\n")).slice(-CODEX_DISPLAY_LOG_CHARS)
}

function activityMessagesToDisplayLog(messages: AiTaskActivityMessage[]): string {
  return messages
    .map(message => {
      const body = message.body.trim()
      if (!body || isGenericCodexPulseText(body)) return ""
      if (message.role === "user" || message.kind === "user_answer") return `[user] ${body}`
      if (message.role === "codex" && (
        message.kind === "progress" ||
        message.kind === "question" ||
        message.kind === "approval" ||
        message.kind === "completed"
      )) {
        return `[assistant] ${body}`
      }
      return `[Codex] ${body}`
    })
    .filter(Boolean)
    .join("\n\n")
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
  if (firstLine) {
    keys.add(normalizedKey(firstLine))
  }

  return keys
}

function isSafeMediaSrc(src: string) {
  return /^(https?:\/\/|\/|data:image\/)/i.test(src)
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(!?\[[^\]]*]\([^)]+\)|`[^`]+`|\*\*[^*]+?\*\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const token = match[0]
    const key = `${keyPrefix}-${match.index}`
    const markdownLink = token.match(/^(!?)\[([^\]]*)]\(([^)]+)\)$/)
    if (markdownLink) {
      const isImage = markdownLink[1] === "!"
      const label = markdownLink[2]
      const href = markdownLink[3].trim()
      if (isImage) {
        nodes.push(isSafeMediaSrc(href) ? (
          // eslint-disable-next-line @next/next/no-img-element -- Codex output can reference arbitrary runtime image URLs.
          <img
            key={key}
            src={href}
            alt={label}
            className="my-3 max-h-96 max-w-full rounded-md border object-contain"
            loading="lazy"
          />
        ) : label)
      } else {
        nodes.push(
          <a
            key={key}
            href={href}
            className="text-emerald-700 underline underline-offset-2 dark:text-emerald-300"
            rel="noreferrer"
            target={href.startsWith("#") ? undefined : "_blank"}
          >
            {label || href}
          </a>,
        )
      }
    } else if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.92em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(token)
    }

    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }
  return nodes
}

function renderInlineLines(lines: string[], keyPrefix: string) {
  return lines.flatMap((line, index) => [
    ...renderInlineMarkdown(line, `${keyPrefix}-${index}`),
    index < lines.length - 1 ? <br key={`${keyPrefix}-br-${index}`} /> : null,
  ])
}

function isTableSeparator(line: string) {
  const trimmed = line.trim()
  if (!trimmed.includes("|")) return false
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed)
}

function isTableRow(line: string) {
  return line.trim().includes("|") && !/^```/.test(line.trim())
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(cell => cell.trim())
}

function MarkdownContent({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n")
  const blocks: ReactNode[] = []
  let index = 0

  const pushParagraph = (paragraphLines: string[], key: string) => {
    blocks.push(
      <p key={key} className="my-3 whitespace-normal">
        {renderInlineLines(paragraphLines, key)}
      </p>,
    )
  }

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    const fence = trimmed.match(/^```(\w+)?/)
    if (fence) {
      const start = index
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push(
        <pre key={`code-${start}`} className="my-3 overflow-x-auto rounded-md border bg-muted/30 px-3 py-2 text-xs leading-5">
          <code>{codeLines.join("\n")}</code>
        </pre>,
      )
      continue
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const className = level <= 2
        ? "my-3 text-base font-semibold"
        : "my-2 text-sm font-semibold"
      blocks.push(
        <div key={`heading-${index}`} className={className}>
          {renderInlineMarkdown(heading[2], `heading-${index}`)}
        </div>,
      )
      index += 1
      continue
    }

    if (isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const start = index
      const headers = splitTableRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].trim() && isTableRow(lines[index])) {
        rows.push(splitTableRow(lines[index]))
        index += 1
      }
      blocks.push(
        <div key={`table-${start}`} className="my-4 overflow-x-auto rounded-md border">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                {headers.map((header, cellIndex) => (
                  <th key={`${start}-h-${cellIndex}`} className="border-b px-3 py-2 font-semibold">
                    {renderInlineMarkdown(header, `table-${start}-h-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`${start}-r-${rowIndex}`} className="border-b last:border-b-0">
                  {headers.map((_, cellIndex) => (
                    <td key={`${start}-r-${rowIndex}-${cellIndex}`} className="align-top px-3 py-2">
                      {renderInlineMarkdown(row[cellIndex] ?? "", `table-${start}-r-${rowIndex}-${cellIndex}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    const listMatch = trimmed.match(/^(([-*])|(\d+[.)]))\s+(.+)$/)
    if (listMatch) {
      const start = index
      const ordered = !!listMatch[3]
      const items: string[] = []
      while (index < lines.length) {
        const item = lines[index].trim().match(/^(([-*])|(\d+[.)]))\s+(.+)$/)
        if (!item || (!!item[3]) !== ordered) break
        items.push(item[4])
        index += 1
      }
      const ListTag = ordered ? "ol" : "ul"
      blocks.push(
        <ListTag key={`list-${start}`} className={ordered ? "my-3 list-decimal space-y-1 pl-5" : "my-3 list-disc space-y-1 pl-5"}>
          {items.map((item, itemIndex) => (
            <li key={`${start}-li-${itemIndex}`}>
              {renderInlineMarkdown(item, `list-${start}-${itemIndex}`)}
            </li>
          ))}
        </ListTag>,
      )
      continue
    }

    const paragraphStart = index
    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index]
      const currentTrimmed = current.trim()
      if (!currentTrimmed) break
      if (currentTrimmed.startsWith("```")) break
      if (/^(#{1,4})\s+/.test(currentTrimmed)) break
      if (isTableRow(current) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) break
      if (/^(([-*])|(\d+[.)]))\s+/.test(currentTrimmed) && paragraphLines.length > 0) break
      paragraphLines.push(current)
      index += 1
    }
    pushParagraph(paragraphLines, `paragraph-${paragraphStart}`)
  }

  return <div className="space-y-2">{blocks}</div>
}

function getCodexConversation(value: string, prompt: string): CodexConversation {
  const entries: CodexChatEntry[] = []
  const assistantBlocks: string[] = []
  const processLogs: string[] = []
  const seen = new Set<string>()
  const promptKeys = promptEchoKeys(prompt)

  const pushUnique = (entry: CodexChatEntry) => {
    const key = `${entry.kind}:${entry.text.replace(/\s+/g, " ").trim()}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push(entry)
  }

  const pushProcessLog = (block: string) => {
    const key = block.replace(/\s+/g, " ").trim()
    if (key && !processLogs.some(log => log.replace(/\s+/g, " ").trim() === key)) {
      processLogs.push(block)
    }
  }

  const flushAssistant = () => {
    const text = assistantBlocks.join("\n\n").trim()
    assistantBlocks.length = 0
    if (text) pushUnique({ kind: "request", text })
  }

  for (const rawBlock of value.split(/\n{2,}/)) {
    const block = rawBlock.trim()
    if (!block) continue
    if (promptKeys.has(normalizedKey(block))) continue
    if (/^\[(developer|system)\]/i.test(block)) continue
    if (/^Codex セッションは確認待ちです。/i.test(block)) continue
    if (/^\[user\]\s*プロンプト送信済み\s*\(/i.test(block)) continue

    const user = block.match(/^\[user\]\s*([\s\S]+)/i)
    if (user?.[1]?.trim()) {
      flushAssistant()
      const userText = user[1].trim()
      if (!promptKeys.has(normalizedKey(userText))) {
        pushUnique({ kind: "user", text: userText })
      }
      continue
    }

    const process = block.match(/^\[(command:[^\]]+|approval-requested|approval-resolved)\]\s*([\s\S]+)/i)
    if (process?.[1]) {
      flushAssistant()
      const tag = process[1].toLowerCase()
      const body = process[2]?.trim() ?? ""
      if (tag === "approval-requested") {
        pushProcessLog(`承認待ち\n${body}`)
      } else if (tag === "approval-resolved") {
        pushProcessLog("承認済み")
      } else if (tag === "command:started") {
        pushProcessLog(`実行開始\n${body}`)
      } else if (tag === "command:completed") {
        pushProcessLog(`実行完了\n${body}`)
      }
      continue
    }

    const event = block.match(/^\[Codex\]\s*([\s\S]+)/i)
    if (event?.[1]?.trim()) {
      flushAssistant()
      if (!/実行完了/.test(event[1])) {
        pushUnique({ kind: "event", text: event[1].trim() })
      }
      continue
    }

    const assistant = block.match(/^\[assistant\]\s*([\s\S]+)/i)
    const text = (assistant?.[1] ?? block).trim()
    if (text) assistantBlocks.push(text)
  }

  flushAssistant()
  return { entries, processLogs }
}

export function MindmapLinkedMemosDialog({
  target,
  projects,
  onOpenChange,
  onTaskUpdated,
}: MindmapLinkedMemosDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [draftMemo, setDraftMemo] = useState("")
  const [selectedRepoPath, setSelectedRepoPath] = useState("")
  const [justSentPrompt, setJustSentPrompt] = useState("")
  const [isCopyingPrompt, setIsCopyingPrompt] = useState(false)
  const [promptCopied, setPromptCopied] = useState(false)
  const [codexActivityMessages, setCodexActivityMessages] = useState<AiTaskActivityMessage[]>([])
  const [codexActivityError, setCodexActivityError] = useState<string | null>(null)
  const codexWatchIdRef = useRef<string | null>(null)
  const { getBySourceId: getAiTaskBySourceId, refresh: refreshAiTasks } = useMemoAiTasks()

  if (!codexWatchIdRef.current && typeof crypto !== "undefined" && "randomUUID" in crypto) {
    codexWatchIdRef.current = `linked:${crypto.randomUUID()}`
  }

  const codexTask = target?.taskId ? getAiTaskBySourceId(target.taskId) : null
  const isCodexTask = codexTask?.executor === "codex" || codexTask?.executor === "codex_app"
  const codexUiState = getCodexTaskUiState(codexTask)
  const codexResult = asRecord(codexTask?.result)
  const codexSnapshot = asRecord(codexResult.codex_thread_snapshot)
  const codexThreadId = stringValue(codexResult.codex_thread_id)
  const codexThreadUrlFromResult = stringValue(codexResult.codex_thread_url)
  const codexThreadUrl = codexThreadId ? `codex://threads/${codexThreadId}` : codexThreadUrlFromResult
  const codexRepoPath = selectedRepoPath || codexTask?.cwd?.trim() || ""
  const codexMessage = stringValue(codexResult.message)
  const codexLiveLog = stringValue(codexResult.live_log)
  const codexPreview = stringValue(codexSnapshot.preview)
  const codexManualHandoff = codexResult.codex_manual_handoff === true
  const codexWaitingForAppSend = codexManualHandoff && codexUiState?.state === "prompt_waiting"
  const codexSendConfirmed = !codexWaitingForAppSend && (
    !!codexThreadId ||
    !codexManualHandoff ||
    codexUiState?.state === "awaiting_approval"
  )
  const isCodexRunning = codexUiState?.state === "running" || codexTask?.status === "running"
  const codexDisplayLog = buildCodexDisplayLog(codexLiveLog, codexMessage, codexPreview)
  const codexActivityDisplayLog = activityMessagesToDisplayLog(codexActivityMessages)
  const rawSentPrompt = codexTask?.prompt?.trim() || justSentPrompt
  const sentPrompt = stripFocusmapSyncId(rawSentPrompt)
  const codexConversation = getCodexConversation([codexActivityDisplayLog, codexDisplayLog].filter(Boolean).join("\n\n"), rawSentPrompt)
  const codexChatEntries = codexConversation.entries
  const codexAssistantEntries = codexChatEntries.filter(entry => entry.kind === "request")
  const codexUserEntries = codexChatEntries.filter(entry => entry.kind === "user")
  const codexProcessLogs = codexConversation.processLogs
  const hasCodexRun = (!!codexTask && isCodexTask) || !!justSentPrompt
  const codexCompleted = isCodexTask && codexTask?.status === "completed"
  const codexStatusLabel = codexCompleted
    ? "確認待ち"
    : codexWaitingForAppSend
      ? "未送信"
    : codexTask?.status === "failed"
      ? "接続失敗"
      : codexUiState?.state === "running"
        ? "Codex実行中"
        : codexUiState?.state === "awaiting_approval" || codexTask?.status === "awaiting_approval"
          ? "確認待ち"
        : codexManualHandoff && codexThreadId
          ? "送信確認済み"
        : "Codexで確認"
  const codexStatusClass = codexCompleted
    ? "rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
    : codexTask?.status === "failed"
      ? "rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive"
      : codexWaitingForAppSend
        ? "rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300"
      : codexUiState?.state === "running"
        ? "rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
        : "rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
  const codexIconClass = codexWaitingForAppSend
    ? "text-sky-500"
    : codexUiState?.state === "running"
      ? "text-emerald-500"
      : "text-amber-500"
  const codexAiTaskId = codexTask?.id ?? null

  const loadCodexActivity = useCallback(async () => {
    const taskId = codexAiTaskId
    if (!target || !taskId || !isCodexTask) return

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
  }, [codexAiTaskId, isCodexTask, target])

  const syncLinkedCodexState = useCallback(async () => {
    const sourceTaskId = target?.taskId
    if (!sourceTaskId || !hasCodexRun || !canUseLocalCodexOpenApi()) return

    await fetchWithSupabaseAuth("/api/codex/sync-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_task_id: sourceTaskId,
        ai_task_id: codexAiTaskId,
        include_visible_activity: true,
      }),
    }).catch(() => undefined)
    await refreshAiTasks()
    await loadCodexActivity()
  }, [codexAiTaskId, hasCodexRun, loadCodexActivity, refreshAiTasks, target?.taskId])

  const { trackManualHandoff, confirmManualHandoffNow, markScreenSwitched } = useCodexManualHandoffConfirmation({
    onConfirmed: async () => {
      await refreshAiTasks()
      window.setTimeout(() => void loadCodexActivity(), 250)
    },
  })

  const repoOptions = useMemo(() => {
    const seen = new Set<string>()
    return projects
      .filter(project => !!project.repo_path)
      .flatMap(project => {
        const path = project.repo_path?.trim()
        if (!path || seen.has(path)) return []
        seen.add(path)
        return [{ path, label: project.title || path }]
      })
  }, [projects])

  const taskProject = useMemo(
    () => projects.find(project => project.id === task?.project_id) ?? null,
    [projects, task?.project_id],
  )

  useEffect(() => {
    if (!target) return
    const taskId = target.taskId
    let cancelled = false
    void refreshAiTasks()
    setIsLoading(true)
    setError(null)
    setTask(null)
    setDraftTitle("")
    setDraftMemo("")
    setJustSentPrompt("")
    setIsCopyingPrompt(false)
    setPromptCopied(false)

    async function loadTask() {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
          cache: "no-store",
        })
        const data = await res.json() as TaskResponse
        if (!res.ok || !data.task) {
          throw new Error(taskErrorMessage(data, "ノード詳細の取得に失敗しました"))
        }
        if (cancelled) return
        setTask(data.task)
        setDraftTitle(data.task.title ?? "")
        setDraftMemo(data.task.memo ?? "")
        const projectRepo = projects.find(project => project.id === data.task?.project_id)?.repo_path?.trim()
        setSelectedRepoPath(projectRepo || repoOptions[0]?.path || "")
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "ノード詳細の取得に失敗しました")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadTask()
    return () => {
      cancelled = true
    }
  }, [projects, refreshAiTasks, repoOptions, target])

  useEffect(() => {
    const taskId = codexAiTaskId
    if (!target || !taskId || !isCodexTask) {
      setCodexActivityMessages([])
      setCodexActivityError(null)
      return
    }

    void loadCodexActivity()
    if (canUseLocalCodexOpenApi()) return

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadCodexActivity()
    }, CODEX_ACTIVITY_SYNC_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [codexAiTaskId, isCodexTask, loadCodexActivity, target])

  useEffect(() => {
    if (!target || !hasCodexRun || !canUseLocalCodexOpenApi()) return
    void syncLinkedCodexState()
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void syncLinkedCodexState()
    }, CODEX_ACTIVITY_SYNC_INTERVAL_MS)
    return () => window.clearInterval(intervalId)
  }, [hasCodexRun, syncLinkedCodexState, target])

  useEffect(() => {
    const taskId = codexAiTaskId
    if (!target || !taskId || !isCodexTask) return

    const watchId = codexWatchIdRef.current ?? `linked:${taskId}`
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
    const intervalId = window.setInterval(() => sendWatch("ping"), CODEX_WATCH_PING_INTERVAL_MS)
    return () => {
      window.clearInterval(intervalId)
      sendWatch("close")
    }
  }, [codexAiTaskId, isCodexTask, target])

  async function saveDraft() {
    if (!task) return
    const updates: Partial<Task> = {}
    const nextTitle = draftTitle.trim() || "Task"
    const nextMemo = draftMemo.trim()
    if (nextTitle !== task.title) updates.title = nextTitle
    if (nextMemo !== (task.memo ?? "")) updates.memo = nextMemo
    if (Object.keys(updates).length === 0) return

    if (onTaskUpdated) {
      await onTaskUpdated(task.id, updates)
    } else {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as TaskResponse
        throw new Error(taskErrorMessage(data, "ノード詳細の保存に失敗しました"))
      }
    }
    setTask(prev => prev ? { ...prev, ...updates } : prev)
  }

  async function createCodexTask(dispatchMode: "manual" | "auto", prompt: string, handoffToken?: string) {
    const res = await fetchWithSupabaseAuth("/api/ai-tasks/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: prompt.length < 50_000,
      body: JSON.stringify({
        prompt,
        cwd: selectedRepoPath,
        approval_type: "auto",
        source_task_id: task?.id,
        scheduled_at: new Date().toISOString(),
        executor: "codex_app",
        space_id: taskProject?.space_id ?? null,
        dispatch_mode: dispatchMode,
        codex_handoff_token: handoffToken,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(data.error || `Codex送信に失敗しました (${res.status})`)
    }
    return await res.json() as AiTask
  }

  async function handleStartInCodexApp() {
    if (!task || hasCodexRun) return
    const basePrompt = buildCodexPrompt(draftTitle, draftMemo)
    if (!basePrompt) {
      setError("Codexに渡す内容を入力してください")
      return
    }
    if (!selectedRepoPath) {
      setError("送信先リポジトリを設定してください")
      return
    }

    setIsSending(true)
    setIsSaving(true)
    setError(null)
    const handoffToken = buildCodexHandoffToken(task.id)
    const prompt = appendCodexHandoffToken(basePrompt, handoffToken)
    try {
      await saveDraft()
      const createdTask = await createCodexTask("manual", prompt, handoffToken)
      setJustSentPrompt(prompt)
      await refreshAiTasks()
      const isMobileHandoff = isLikelyMobileDevice()
      if (isMobileHandoff) {
        trackManualHandoff({ taskId: createdTask.id })
        const target = buildCodexOpenTarget(
          {
            prompt,
            repoPath: selectedRepoPath,
            originUrl: typeof window !== "undefined" ? window.location.href : null,
          },
          { preferMobile: true, mobilePlatform: getCurrentMobilePlatform() },
        )
        const copyAttempt = beginCopyPromptForCodexHandoff(prompt)
        if (openCodexMobileTargetViaFocusmapNativeApp(target.url, prompt, "urls" in target ? target.urls : undefined)) {
          markScreenSwitched("external_app_opened")
        } else {
          const copied = await copyAttempt.finished
          if (!copied) throw new Error("プロンプトをクリップボードにコピーできませんでした")
          window.location.href = target.url
        }
      } else if (canUseLocalCodexOpenApi()) {
        await launchCodexViaLocalApi({
          prompt,
          repoPath: selectedRepoPath,
          originUrl: typeof window !== "undefined" ? window.location.href : null,
        })
      } else {
        const copied = await beginCopyPromptForCodexHandoff(prompt).finished
        if (!copied) throw new Error("プロンプトをクリップボードにコピーできませんでした")
        openCodexFromLinkedDialog(prompt, selectedRepoPath)
      }
      window.setTimeout(() => void refreshAiTasks(), 1200)
      window.setTimeout(() => void refreshAiTasks(), 3500)
    } catch (err) {
      setError(err instanceof Error
        ? `Codexを開けませんでした。${err.message}`
        : "Codexを開けませんでした")
    } finally {
      setIsSaving(false)
      setIsSending(false)
    }
  }

  async function handleOpenCodexThread(event?: MouseEvent<HTMLAnchorElement>) {
    const prompt = rawSentPrompt || buildCodexPrompt(draftTitle, draftMemo)
    if (!codexRepoPath && !codexThreadUrl) {
      event?.preventDefault()
      setError("Codex.appで開くリポジトリを設定してください")
      return
    }

    try {
      const isMobileHandoff = isLikelyMobileDevice()
      if (normalizeCodexPrompt(prompt) && isMobileHandoff) {
        const shouldConfirmManualHandoff = !!codexAiTaskId && codexUiState?.state === "prompt_waiting"
        if (shouldConfirmManualHandoff && codexAiTaskId) {
          trackManualHandoff({ taskId: codexAiTaskId })
        }
        void beginCopyPromptForCodexHandoff(prompt).finished
        if (openCodexMobileTargetViaFocusmapNativeApp(codexOpenTarget.url, prompt, "urls" in codexOpenTarget ? codexOpenTarget.urls : undefined)) {
          event?.preventDefault()
          if (shouldConfirmManualHandoff) {
            markScreenSwitched("external_app_opened")
          }
        } else {
          event?.preventDefault()
          const navigate = () => {
            window.location.href = codexOpenTarget.url
          }
          if (shouldConfirmManualHandoff && codexAiTaskId) {
            void confirmManualHandoffNow(codexAiTaskId, "screen_switched").finally(navigate)
          } else {
            navigate()
          }
        }
        return
      }
      event?.preventDefault()
      if (canUseLocalCodexOpenApi() && !isMobileHandoff) {
        await launchCodexViaLocalApi({ prompt, repoPath: codexRepoPath, threadUrl: codexThreadUrl || null })
      } else {
        openCodexFromLinkedDialog(prompt, codexRepoPath || null, codexThreadUrl || null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codex.app を開けませんでした")
    }
  }

  async function handleCopySentPrompt() {
    const prompt = rawSentPrompt || justSentPrompt
    if (!prompt || isCopyingPrompt) return

    setIsCopyingPrompt(true)
    setPromptCopied(false)
    setError(null)
    try {
      const copied = await copyPromptForCodexHandoff(prompt)
      if (!copied) throw new Error("クリップボードコピー失敗")
      setPromptCopied(true)
      window.setTimeout(() => setPromptCopied(false), 1600)
    } catch (err) {
      setError(err instanceof Error ? err.message : "クリップボードコピー失敗")
    } finally {
      setIsCopyingPrompt(false)
    }
  }

  const title = task?.title || draftTitle || "ノード詳細"
  const description = hasCodexRun
    ? (codexWaitingForAppSend ? "未送信" : codexCompleted || codexUiState?.state === "awaiting_approval" ? "確認待ち" : "Codexで続行中")
    : "メモ見出しとメモ詳細を整えてからCodexを開きます"
  const canSend = !!task && !!selectedRepoPath && !isSending && !hasCodexRun
  const isMobileOpenTarget = isLikelyMobileDevice()
  const codexOpenPrompt = rawSentPrompt || buildCodexPrompt(draftTitle, draftMemo)
  const codexOpenTarget = buildCodexOpenTarget(
    { prompt: codexOpenPrompt, repoPath: codexRepoPath || null, threadUrl: codexThreadUrl || null },
    { preferMobile: isMobileOpenTarget, mobilePlatform: getCurrentMobilePlatform() },
  )

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(86dvh,760px)] w-[min(90vw,1160px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex min-h-[34vh] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              ノード詳細を読み込み中...
            </div>
          ) : error && !task ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : hasCodexRun ? (
            <section className="flex min-h-[520px] flex-col overflow-hidden rounded-lg border bg-card">
              <div className="sticky top-0 z-10 flex shrink-0 flex-col gap-3 border-b bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Bot className={`h-4 w-4 ${codexIconClass}`} />
                  <span className={codexStatusClass}>{codexStatusLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {codexWaitingForAppSend ? "コピー済み・貼り付け前" : codexSendConfirmed ? "送信確認済み" : "送信待ち"}
                  </span>
                  {codexRepoPath && (
                    <span className="max-w-[18rem] truncate rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground" title={codexRepoPath}>
                      repo {codexRepoPath.split("/").filter(Boolean).at(-1) ?? codexRepoPath}
                    </span>
                  )}
                  {codexThreadId ? (
                    <span className="max-w-full truncate rounded-md bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground" title={codexThreadId}>
                      {codexThreadId}
                    </span>
                  ) : codexWaitingForAppSend ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      未送信
                    </span>
                  ) : codexManualHandoff ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      外部アプリ確認待ち
                    </span>
                  ) : (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      thread作成中
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">ログ {codexProcessLogs.length}</span>
                  <span className="text-xs text-muted-foreground">出力 {codexAssistantEntries.length}</span>
                  {codexUserEntries.length > 0 && (
                    <span className="text-xs text-muted-foreground">追加入力 {codexUserEntries.length}</span>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshAiTasks()}
                    className="h-8 gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    ログ更新
                  </Button>
                  {!isCodexRunning && rawSentPrompt && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCopySentPrompt()}
                      disabled={isCopyingPrompt}
                      className="h-8 gap-1.5 border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-200"
                    >
                      {isCopyingPrompt ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : promptCopied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {promptCopied ? "コピー済み" : "プロンプトをコピー"}
                    </Button>
                  )}
                  <a
                    href={codexOpenTarget.url}
                    onClick={(event) => void handleOpenCodexThread(event)}
                    aria-disabled={!codexThreadUrl && !codexManualHandoff && !rawSentPrompt}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {isMobileOpenTarget ? "Codexを開く" : codexThreadUrl ? "Codexで開く" : "Codex.appを開く"}
                  </a>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5">
                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {error}
                    </div>
                  )}

                  <div className="flex justify-start">
                    <div className="max-w-[78%] rounded-2xl border bg-background px-4 py-3 text-sm leading-7 shadow-sm">
                      <div className="mb-1 text-xs font-medium text-muted-foreground">Codexで返信・確認</div>
                      <div className="text-muted-foreground">
                        {codexWaitingForAppSend
                          ? "プロンプトはコピー済みです。Codex側で貼り付けて送信すると、Focusmapがthreadとログを同期します。"
                          : codexManualHandoff && !codexThreadId
                            ? "Codex側で返答を確認してください。Focusmapは送信済み状態と確認待ちだけを同期します。"
                          : "このノードの続きはCodex.appのスレッドで進めます。Focusmap側は状態とログだけ同期します。"}
                      </div>
                    </div>
                  </div>

                  {sentPrompt && (
                    <div className="flex justify-end">
                      <div className="max-w-[76%] rounded-2xl bg-muted px-4 py-3 text-sm leading-7 text-foreground">
                        <div className="mb-1 text-xs font-medium text-muted-foreground">
                          {codexWaitingForAppSend ? "コピー済み・貼り付け前" : codexManualHandoff ? "送信確認済み" : "送信済み"}
                        </div>
                        <div className="max-h-56 overflow-auto break-words">
                          <MarkdownContent text={sentPrompt} />
                        </div>
                      </div>
                    </div>
                  )}

                  {codexChatEntries.length > 0 ? (
                    codexChatEntries.map((entry, index) => (
                      entry.kind === "event" ? (
                        <div key={`${entry.kind}-${index}-${entry.text.slice(0, 20)}`} className="flex justify-center">
                          <span className="rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
                            {entry.text}
                          </span>
                        </div>
                      ) : entry.kind === "user" ? (
                        <div key={`${entry.kind}-${index}-${entry.text.slice(0, 20)}`} className="flex justify-end">
                          <div className="max-w-[76%] rounded-2xl bg-muted px-4 py-3 text-sm leading-7 text-foreground">
                            <div className="mb-1 text-xs font-medium text-muted-foreground">Codex側で送信</div>
                            <div className="max-h-56 overflow-auto break-words">
                              <MarkdownContent text={entry.text} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div key={`${entry.kind}-${index}-${entry.text.slice(0, 20)}`} className="flex justify-start">
                          <div className="max-w-[92%] rounded-2xl border border-amber-500/25 bg-background px-4 py-3 text-sm leading-7 shadow-sm">
                            <div className="mb-2 text-xs font-medium text-amber-700 dark:text-amber-300">Codex出力（同期）</div>
                            <div className="break-words">
                              <MarkdownContent text={entry.text} />
                            </div>
                          </div>
                        </div>
                      )
                    ))
                  ) : (
                    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed bg-muted/10 px-3 py-8 text-sm text-muted-foreground">
                      {codexWaitingForAppSend
                        ? "Codexで送信されると、この欄に状態と出力が同期されます"
                        : codexManualHandoff && !codexThreadId
                          ? "Codex側の返答を確認してください"
                        : codexActivityError
                          ? "チャットログを取得できません"
                          : "Codex.app側の出力は未同期です"}
                    </div>
                  )}
                </div>

                <aside className="min-h-0 border-t bg-muted/5 px-3 py-3 lg:border-l lg:border-t-0">
                  <details className="group text-xs">
                    <summary className="cursor-pointer select-none rounded-md border bg-background px-3 py-2 font-medium text-muted-foreground">
                      同期ログ {codexProcessLogs.length}
                    </summary>
                    <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 lg:max-h-[calc(min(86dvh,760px)-13rem)]">
                      {codexProcessLogs.length > 0 ? (
                        codexProcessLogs.map((log, index) => (
                          <div key={`${index}-${log.slice(0, 20)}`} className="whitespace-pre-wrap rounded-md border bg-background px-3 py-2 leading-5 text-muted-foreground">
                            {log}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border bg-background px-3 py-2 leading-5 text-muted-foreground">
                          まだログは同期されていません
                        </div>
                      )}
                    </div>
                  </details>
                </aside>
              </div>
            </section>
          ) : (
            <section className="space-y-4">
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
                <div className="min-w-0 space-y-2">
                  <label htmlFor="mindmap-node-title" className="text-xs font-medium text-muted-foreground">
                    メモ見出し
                  </label>
                  <input
                    id="mindmap-node-title"
                    value={draftTitle}
                    onChange={event => setDraftTitle(event.currentTarget.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition-colors focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="mindmap-codex-repo" className="text-xs font-medium text-muted-foreground">
                    送信先
                  </label>
                  <select
                    id="mindmap-codex-repo"
                    value={selectedRepoPath}
                    onChange={event => setSelectedRepoPath(event.currentTarget.value)}
                    className="h-10 w-full rounded-md border bg-background px-2 text-xs outline-none transition-colors focus:border-emerald-500"
                  >
                    {repoOptions.length === 0 ? (
                      <option value="">repo未設定</option>
                    ) : (
                      repoOptions.map(repo => (
                        <option key={repo.path} value={repo.path}>{repo.label}</option>
                      ))
                    )}
                  </select>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleStartInCodexApp}
                    disabled={!canSend}
                    className="w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    {isSending || isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                    Codexを開く
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="mindmap-node-memo" className="text-xs font-medium text-muted-foreground">
                  メモ詳細
                </label>
                <textarea
                  id="mindmap-node-memo"
                  value={draftMemo}
                  onChange={event => setDraftMemo(event.currentTarget.value)}
                  className="min-h-[360px] w-full resize-none rounded-lg border bg-background px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500"
                  placeholder="Codexに渡したい背景、条件、成果物を書いてください"
                />
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
