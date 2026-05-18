import { execFileSync } from "child_process"
import { promises as fs } from "fs"
import type { Dirent } from "fs"
import path from "path"
import os from "os"
import type {
  AiTaskProgressState,
  AiTaskProgressSummary,
  AiTaskSessionHealth,
} from "@/types/ai-task"

export const MAX_PROGRESS_LOG_CHARS = 12_000

export type AiTaskProgressTask = {
  id: string
  prompt: string
  status: string
  error: string | null
  result: Record<string, unknown> | null
  executor: "claude" | "codex" | "codex_app" | string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  remote_session_url: string | null
  tmux_session_name: string | null
  codex_thread_id: string | null
  cwd?: string | null
}

export type ProgressEvidence = {
  task_id: string
  executor: string | null
  status: string
  checked_at: string
  started_at: string | null
  completed_at: string | null
  created_at: string
  remote_session_url: string | null
  codex_thread_id: string | null
  tmux_session_name: string | null
  tmux_alive: boolean | null
  run_dir: string | null
  stdout_log_path: string | null
  tmp_log_path: string | null
  transcript_path: string | null
  log_tail: string
  log_chars: number
  events: ProgressHookEvent[]
  transcript: TranscriptEvidence
  last_activity_at: string | null
  last_tool: string | null
  files_touched: string[]
  tests_seen: string[]
  done_evidence: string[]
  remaining_work: string[]
  blocked_reason: string | null
  session_health: AiTaskSessionHealth
  has_permission_denied: boolean
  has_question_or_notification: boolean
  has_error: boolean
}

export type ProgressHookEvent = {
  event_name?: string
  observed_at?: string
  tool_name?: string | null
  notification_type?: string | null
  transcript_path?: string | null
  raw?: unknown
}

export type TranscriptEvidence = {
  path: string | null
  line_count: number
  last_text: string
  last_assistant_text: string
  last_stop_reason: string | null
  tool_names: string[]
  files_touched: string[]
  tests_seen: string[]
  errors: string[]
  done_evidence: string[]
  remaining_work: string[]
  last_timestamp: string | null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function stripAnsi(text: string) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}

export function tail(text: string, length = MAX_PROGRESS_LOG_CHARS) {
  return stripAnsi(text).replace(/\r\n?/g, "\n").slice(-length)
}

function uniq(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => !!value && value.trim().length > 0))]
}

function safeText(value: unknown): string {
  if (!value) return ""
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join("\n")
  if (!isRecord(value)) return ""
  if (typeof value.text === "string") return value.text
  if (typeof value.content === "string") return value.content
  if (Array.isArray(value.content)) return value.content.map(safeText).filter(Boolean).join("\n")
  return ""
}

function parseJsonl(raw: string) {
  return raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line) as unknown
      } catch {
        return null
      }
    })
    .filter((value): value is Record<string, unknown> => isRecord(value))
}

function commandLooksLikeTest(command: string) {
  return /\b(npm|pnpm|yarn|bun|vitest|jest|playwright|tsc|eslint|lint|test|build)\b/i.test(command)
}

function extractFilePathFromTool(toolName: string, input: Record<string, unknown>) {
  const pathValue =
    input.file_path ??
    input.path ??
    input.notebook_path ??
    input.filename
  if (typeof pathValue === "string") return pathValue
  if (toolName === "Bash" && typeof input.command === "string") {
    const match = input.command.match(/\b(?:src|app|components|lib|scripts|supabase|docs)\/[^\s'"]+/)
    return match?.[0] ?? null
  }
  return null
}

function scanTextEvidence(text: string) {
  const done: string[] = []
  const remaining: string[] = []
  const errors: string[] = []

  for (const line of text.split("\n").map(l => l.trim()).filter(Boolean).slice(-80)) {
    if (/完了|実装しました|修正しました|成功|passed|passing|build succeeded|done/i.test(line)) {
      done.push(line.slice(0, 180))
    }
    if (/残り|未完了|TODO|next|次|確認待ち|要確認|should|failed to|error|失敗/i.test(line)) {
      remaining.push(line.slice(0, 180))
    }
    if (/error|failed|exception|traceback|permission denied|認証|権限|失敗/i.test(line)) {
      errors.push(line.slice(0, 180))
    }
  }

  return {
    done: done.slice(-5),
    remaining: remaining.slice(-5),
    errors: errors.slice(-5),
  }
}

async function readFileIfExists(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch {
    return ""
  }
}

function homePath(...parts: string[]) {
  return path.join(os.homedir(), ...parts)
}

export function getAiRunDir(taskId: string) {
  return homePath(".focusmap", "ai-runs", taskId)
}

function sanitizeClaudeProjectPath(cwd: string) {
  return path.resolve(cwd).replace(/[^A-Za-z0-9]/g, "-")
}

async function findFileByName(root: string, fileName: string, maxDepth = 3): Promise<string | null> {
  async function walk(dir: string, depth: number): Promise<string | null> {
    if (depth > maxDepth) return null
    let entries: Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === fileName) return full
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found = await walk(path.join(dir, entry.name), depth + 1)
      if (found) return found
    }
    return null
  }
  return walk(root, 0)
}

async function findClaudeTranscript(task: AiTaskProgressTask, events: ProgressHookEvent[]) {
  const fromEvents = events
    .map(event => typeof event.transcript_path === "string" ? event.transcript_path : null)
    .find(Boolean)
  if (fromEvents) return fromEvents

  const fileName = `${task.id}.jsonl`
  const projectsDir = homePath(".claude", "projects")
  if (task.cwd) {
    const candidate = path.join(projectsDir, sanitizeClaudeProjectPath(task.cwd), fileName)
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // fall through
    }
  }
  return findFileByName(projectsDir, fileName, 3)
}

export function parseTranscript(raw: string, transcriptPath: string | null): TranscriptEvidence {
  const rows = parseJsonl(raw)
  const toolNames: string[] = []
  const filesTouched: string[] = []
  const testsSeen: string[] = []
  const errors: string[] = []
  const textBlocks: string[] = []
  let lastAssistantText = ""
  let lastStopReason: string | null = null
  let lastTimestamp: string | null = null

  for (const row of rows) {
    if (typeof row.timestamp === "string") lastTimestamp = row.timestamp
    const message = isRecord(row.message) ? row.message : null
    const content = message?.content

    if (message?.role === "assistant" && Array.isArray(content)) {
      const assistantTexts = content.map(part => {
        if (!isRecord(part)) return ""
        if (part.type === "text") return safeText(part)
        if (part.type === "tool_use") {
          const toolName = typeof part.name === "string" ? part.name : "tool"
          toolNames.push(toolName)
          const input = isRecord(part.input) ? part.input : {}
          const filePath = extractFilePathFromTool(toolName, input)
          if (filePath) filesTouched.push(filePath)
          if (toolName === "Bash" && typeof input.command === "string" && commandLooksLikeTest(input.command)) {
            testsSeen.push(input.command.slice(0, 180))
          }
        }
        return ""
      }).filter(Boolean)
      if (assistantTexts.length > 0) {
        lastAssistantText = assistantTexts.join("\n")
        textBlocks.push(lastAssistantText)
      }
      if (typeof message.stop_reason === "string") lastStopReason = message.stop_reason
    }

    if (message?.role === "user" && Array.isArray(content)) {
      for (const part of content) {
        if (!isRecord(part)) continue
        if (part.type === "tool_result") {
          const text = safeText(part.content)
          if (text) textBlocks.push(text)
          if (part.is_error === true && text) errors.push(text.slice(0, 180))
          if (commandLooksLikeTest(text)) testsSeen.push(text.slice(0, 180))
        }
      }
    }

    const toolUseResult = isRecord(row.toolUseResult) ? row.toolUseResult : null
    if (toolUseResult) {
      const stdout = typeof toolUseResult.stdout === "string" ? toolUseResult.stdout : ""
      const stderr = typeof toolUseResult.stderr === "string" ? toolUseResult.stderr : ""
      if (stdout) textBlocks.push(stdout)
      if (stderr) {
        textBlocks.push(stderr)
        errors.push(stderr.slice(0, 180))
      }
      if (commandLooksLikeTest(`${stdout}\n${stderr}`)) testsSeen.push(`${stdout}\n${stderr}`.slice(0, 180))
    }
  }

  const textEvidence = scanTextEvidence(textBlocks.join("\n"))

  return {
    path: transcriptPath,
    line_count: rows.length,
    last_text: tail(textBlocks.join("\n"), 2500),
    last_assistant_text: lastAssistantText.slice(-1200),
    last_stop_reason: lastStopReason,
    tool_names: uniq(toolNames).slice(-20),
    files_touched: uniq(filesTouched).slice(-20),
    tests_seen: uniq(testsSeen).slice(-10),
    errors: uniq([...errors, ...textEvidence.errors]).slice(-8),
    done_evidence: uniq(textEvidence.done).slice(-8),
    remaining_work: uniq(textEvidence.remaining).slice(-8),
    last_timestamp: lastTimestamp,
  }
}

export function tmuxAlive(sessionName: string | null): boolean | null {
  if (!sessionName) return null
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore", timeout: 3000 })
    return true
  } catch {
    return false
  }
}

export async function collectProgressEvidence(task: AiTaskProgressTask, checkedAt = new Date().toISOString()): Promise<ProgressEvidence> {
  const result = isRecord(task.result) ? task.result : {}
  const runDirValue = typeof result.run_dir === "string" ? result.run_dir : getAiRunDir(task.id)
  const eventsPath = path.join(runDirValue, "events.jsonl")
  const stdoutLogPath = path.join(runDirValue, "stdout.log")
  const tmpLogPath = task.executor === "codex"
    ? `/tmp/codex-exec-${task.id}.log`
    : task.executor === "codex_app"
      ? ""
      : `/tmp/claude-rc-${task.id}.log`

  const eventsRaw = await readFileIfExists(eventsPath)
  const events = parseJsonl(eventsRaw) as ProgressHookEvent[]
  const transcriptPath = await findClaudeTranscript(task, events)
  const transcriptRaw = transcriptPath ? await readFileIfExists(transcriptPath) : ""
  const transcript = parseTranscript(transcriptRaw, transcriptPath)
  const stdoutLog = await readFileIfExists(stdoutLogPath)
  const tmpLog = tmpLogPath ? await readFileIfExists(tmpLogPath) : ""
  const resultMessage = typeof result.message === "string" ? result.message : ""
  const liveLog = typeof result.live_log === "string" ? result.live_log : ""
  const logTail = tail([
    resultMessage && `--- result.message ---\n${resultMessage}`,
    liveLog && `--- result.live_log ---\n${liveLog}`,
    stdoutLog && `--- persistent stdout.log ---\n${stdoutLog}`,
    tmpLog && `--- tmp log: ${tmpLogPath} ---\n${tmpLog}`,
    transcript.last_text && `--- claude transcript ---\n${transcript.last_text}`,
  ].filter(Boolean).join("\n\n"))

  const alive = tmuxAlive(task.tmux_session_name)
  const eventNames = events.map(event => event.event_name).filter(Boolean)
  const eventToolNames = events.map(event => event.tool_name).filter((toolName): toolName is string => typeof toolName === "string")
  const eventFilesTouched = events.map(event => {
    const raw = isRecord(event.raw) ? event.raw : {}
    const toolName = typeof event.tool_name === "string" ? event.tool_name : ""
    const input = isRecord(raw.tool_input) ? raw.tool_input : {}
    return toolName ? extractFilePathFromTool(toolName, input) : null
  })
  const eventTestsSeen = events.map(event => {
    const raw = isRecord(event.raw) ? event.raw : {}
    const input = isRecord(raw.tool_input) ? raw.tool_input : {}
    return typeof input.command === "string" && commandLooksLikeTest(input.command)
      ? input.command.slice(0, 180)
      : null
  })
  const hasStopEvent = eventNames.includes("Stop") || eventNames.includes("SessionEnd")
  const hasPermissionDenied = eventNames.includes("PermissionDenied") || /permission denied|権限|許可/i.test(logTail)
  const hasQuestionOrNotification =
    eventNames.includes("Notification") ||
    eventNames.includes("Elicitation") ||
    eventNames.includes("PermissionRequest") ||
    /入力待ち|確認してください|confirm|approve|permission|許可|承認/i.test(logTail)
  const hasError = !!task.error || transcript.errors.length > 0 || /error|failed|exception|失敗/i.test(logTail)
  const lastActivityAt = [
    transcript.last_timestamp,
    ...events.map(event => typeof event.observed_at === "string" ? event.observed_at : null),
    task.completed_at,
    task.started_at,
    task.created_at,
  ].filter(Boolean).sort().at(-1) ?? null

  let sessionHealth: AiTaskSessionHealth = "unknown"
  if (alive === true) sessionHealth = "active"
  else if (hasStopEvent || task.status === "completed" || task.status === "failed") sessionHealth = "stopped"
  else if (task.status === "running" && transcript.path) sessionHealth = "transcript_only"
  else if (task.status === "running" && task.tmux_session_name && alive === false && !transcript.path) sessionHealth = "lost_after_restart"

  const filesTouched = uniq([...transcript.files_touched, ...eventFilesTouched])
  const testsSeen = uniq([...transcript.tests_seen, ...eventTestsSeen])
  const doneEvidence = uniq([
    ...transcript.done_evidence,
    hasStopEvent ? "Claude Stop/SessionEnd hook を検知" : null,
    task.status === "completed" ? "ai_tasks.status が completed" : null,
    filesTouched.length > 0 ? `変更/参照ファイル: ${filesTouched.slice(0, 3).join(", ")}` : null,
    testsSeen.length > 0 ? `テスト/検証コマンドを検知: ${testsSeen[0]}` : null,
  ])
  const remainingWork = uniq([
    ...transcript.remaining_work,
    hasQuestionOrNotification ? "ユーザー確認または通知イベントあり" : null,
    hasPermissionDenied ? "権限/PermissionDenied の可能性あり" : null,
  ])

  let blockedReason: string | null = null
  if (hasPermissionDenied) blockedReason = "権限または許可待ちの可能性があります。"
  else if (hasQuestionOrNotification) blockedReason = "ユーザー確認または入力待ちの可能性があります。"
  else if (sessionHealth === "lost_after_restart") blockedReason = "running のままですが tmux と transcript が見つからず、Mac再起動などで実行状態を失った可能性があります。"
  else if (sessionHealth === "active" && lastActivityAt && Date.now() - new Date(lastActivityAt).getTime() > 15 * 60_000) {
    blockedReason = "セッションは生存していますが15分以上新しい活動がありません。"
  }

  return {
    task_id: task.id,
    executor: task.executor,
    status: task.status,
    checked_at: checkedAt,
    started_at: task.started_at,
    completed_at: task.completed_at,
    created_at: task.created_at,
    remote_session_url: task.remote_session_url,
    codex_thread_id: task.codex_thread_id,
    tmux_session_name: task.tmux_session_name,
    tmux_alive: alive,
    run_dir: runDirValue,
    stdout_log_path: stdoutLog ? stdoutLogPath : null,
    tmp_log_path: tmpLog ? tmpLogPath : null,
    transcript_path: transcript.path,
    log_tail: logTail,
    log_chars: logTail.length,
    events,
    transcript,
    last_activity_at: lastActivityAt,
    last_tool: transcript.tool_names.at(-1) ?? eventToolNames.at(-1) ?? null,
    files_touched: filesTouched,
    tests_seen: testsSeen,
    done_evidence: doneEvidence.slice(-10),
    remaining_work: remainingWork.slice(-10),
    blocked_reason: blockedReason,
    session_health: sessionHealth,
    has_permission_denied: hasPermissionDenied,
    has_question_or_notification: hasQuestionOrNotification,
    has_error: hasError,
  }
}

export function deterministicProgress(task: AiTaskProgressTask, evidence: ProgressEvidence): AiTaskProgressSummary {
  const checkedAt = evidence.checked_at
  let state: AiTaskProgressState = "unknown"
  let progressPercent = 30
  let confidence = 0.45
  let summary = "利用できる証拠が少ないため、状態を確定できません。"
  let currentStep = evidence.last_tool ? `${evidence.last_tool} 実行後` : "状態確認"
  let recommendedAction = "Claude/Codex画面を開いて状況を確認してください。"
  let canMarkCompleted = false

  if (task.status === "pending") {
    state = "not_started"
    progressPercent = 5
    confidence = 0.8
    summary = "まだMac側の task-runner が実行を開始していません。"
    currentStep = "実行待ち"
    recommendedAction = "次の task-runner サイクルを待ってください。"
  } else if (task.status === "failed" || task.error) {
    state = "failed"
    progressPercent = 100
    confidence = 0.9
    summary = "タスクは失敗扱いです。"
    currentStep = "エラー確認"
    recommendedAction = "エラー内容を確認して、再実行または修正指示を出してください。"
  } else if (evidence.blocked_reason) {
    state = evidence.has_permission_denied || evidence.has_question_or_notification ? "needs_review" : "blocked"
    progressPercent = evidence.files_touched.length > 0 ? 70 : 45
    confidence = 0.78
    summary = evidence.blocked_reason
    currentStep = evidence.has_question_or_notification ? "ユーザー確認待ち" : "停止状態の確認"
    recommendedAction = "Claude画面またはログ詳細を開いて、入力待ち・権限待ち・停止理由を確認してください。"
  } else if (evidence.session_health === "active") {
    state = "running"
    progressPercent = 25
      + Math.min(evidence.files_touched.length * 8, 25)
      + Math.min(evidence.tests_seen.length * 10, 20)
      + Math.min(evidence.done_evidence.length * 5, 20)
    progressPercent = clamp(progressPercent, 25, 85)
    confidence = 0.72
    summary = evidence.last_tool
      ? `${evidence.last_tool} まで進んでいます。`
      : "Claude/Codex セッションは生存しており作業中です。"
    currentStep = evidence.last_tool ? `${evidence.last_tool} 実行後` : "作業中"
    recommendedAction = "必要なら画面を開いてライブ状況を確認してください。"
  } else if (
    evidence.session_health === "stopped" &&
    evidence.done_evidence.length > 0 &&
    !evidence.has_error &&
    !evidence.has_permission_denied &&
    !evidence.has_question_or_notification
  ) {
    state = "likely_completed"
    progressPercent = evidence.tests_seen.length > 0 ? 95 : 88
    confidence = evidence.tests_seen.length > 0 ? 0.9 : 0.86
    summary = "セッションは停止済みで、完了を示す証拠があります。"
    currentStep = "最終確認"
    recommendedAction = "結果を確認して問題なければ完了にしてください。"
    canMarkCompleted = confidence >= 0.85
  } else if (evidence.session_health === "transcript_only") {
    state = "unknown"
    progressPercent = evidence.files_touched.length > 0 ? 65 : 45
    confidence = 0.58
    summary = "tmuxはありませんがClaude transcriptは残っています。再起動後の履歴から推定しています。"
    currentStep = "履歴から復元"
    recommendedAction = "Claude URLまたはtranscriptの最終出力を確認してください。"
  } else if (evidence.session_health === "lost_after_restart") {
    state = "blocked"
    progressPercent = 35
    confidence = 0.7
    summary = "running のままですが実行プロセスとtranscriptを確認できません。"
    currentStep = "実行状態の復旧確認"
    recommendedAction = "Mac再起動後の取り残しの可能性があります。必要なら再実行してください。"
  } else if (task.status === "completed") {
    state = "likely_completed"
    progressPercent = 100
    confidence = 0.9
    summary = "既に完了ステータスです。"
    currentStep = "結果確認"
    recommendedAction = "結果ログを確認してください。"
    canMarkCompleted = true
  }

  return {
    state,
    progress_percent: Math.round(progressPercent),
    summary,
    comment: `ここまで: ${evidence.done_evidence[0] ?? summary} 残り: ${evidence.remaining_work[0] ?? "最終確認"} 次: ${recommendedAction}`,
    current_step: currentStep,
    evidence: evidence.done_evidence[0] ?? evidence.blocked_reason ?? summary,
    recommended_action: recommendedAction,
    can_mark_completed: canMarkCompleted,
    confidence: Number(confidence.toFixed(2)),
    checked_at: checkedAt,
    source: "rule",
    tmux_alive: evidence.tmux_alive,
    log_chars: evidence.log_chars,
    done_evidence: evidence.done_evidence,
    remaining_work: evidence.remaining_work,
    blocked_reason: evidence.blocked_reason,
    last_activity_at: evidence.last_activity_at,
    last_tool: evidence.last_tool,
    files_touched: evidence.files_touched,
    tests_seen: evidence.tests_seen,
    session_health: evidence.session_health,
  }
}

const STATES: AiTaskProgressState[] = [
  "not_started",
  "running",
  "likely_completed",
  "needs_review",
  "blocked",
  "failed",
  "unknown",
]

function normalizeState(value: unknown): AiTaskProgressState {
  return typeof value === "string" && STATES.includes(value as AiTaskProgressState)
    ? value as AiTaskProgressState
    : "unknown"
}

function stringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 12)
}

export function normalizeGeminiProgress(
  raw: Record<string, unknown>,
  fallback: AiTaskProgressSummary,
): AiTaskProgressSummary {
  const rawProgressPercent = Number(raw.progress_percent)
  const rawConfidence = Number(raw.confidence)
  const progressPercent = Number.isFinite(rawProgressPercent)
    ? clamp(rawProgressPercent, 0, 100)
    : fallback.progress_percent
  const confidence = Number.isFinite(rawConfidence)
    ? clamp(rawConfidence, 0, 1)
    : fallback.confidence

  return {
    ...fallback,
    state: normalizeState(raw.state) === "unknown" ? fallback.state : normalizeState(raw.state),
    progress_percent: Math.round(progressPercent),
    summary: typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, 240) : fallback.summary,
    comment: typeof raw.comment === "string" && raw.comment.trim() ? raw.comment.trim().slice(0, 320) : fallback.comment,
    current_step: typeof raw.current_step === "string" && raw.current_step.trim() ? raw.current_step.trim().slice(0, 120) : fallback.current_step,
    evidence: typeof raw.evidence === "string" && raw.evidence.trim() ? raw.evidence.trim().slice(0, 240) : fallback.evidence,
    recommended_action: typeof raw.recommended_action === "string" && raw.recommended_action.trim()
      ? raw.recommended_action.trim().slice(0, 160)
      : fallback.recommended_action,
    can_mark_completed: raw.can_mark_completed === true && fallback.can_mark_completed,
    confidence: Number(confidence.toFixed(2)),
    done_evidence: stringArray(raw.done_evidence, fallback.done_evidence ?? []),
    remaining_work: stringArray(raw.remaining_work, fallback.remaining_work ?? []),
    blocked_reason: typeof raw.blocked_reason === "string" ? raw.blocked_reason.slice(0, 180) : fallback.blocked_reason,
  }
}

export function progressObservationPayload(progress: AiTaskProgressSummary, evidence: ProgressEvidence) {
  return {
    state: progress.state,
    progress_percent: progress.progress_percent,
    confidence: progress.confidence,
    session_health: progress.session_health ?? evidence.session_health,
    summary: progress.summary,
    comment: progress.comment ?? "",
    evidence: {
      done_evidence: progress.done_evidence ?? evidence.done_evidence,
      remaining_work: progress.remaining_work ?? evidence.remaining_work,
      blocked_reason: progress.blocked_reason ?? evidence.blocked_reason,
      last_activity_at: progress.last_activity_at ?? evidence.last_activity_at,
      last_tool: progress.last_tool ?? evidence.last_tool,
      files_touched: progress.files_touched ?? evidence.files_touched,
      tests_seen: progress.tests_seen ?? evidence.tests_seen,
      tmux_alive: evidence.tmux_alive,
      run_dir: evidence.run_dir,
      stdout_log_path: evidence.stdout_log_path,
      tmp_log_path: evidence.tmp_log_path,
      transcript_path: evidence.transcript_path,
      log_chars: evidence.log_chars,
    },
    raw: {
      progress,
      evidence: {
        ...evidence,
        log_tail: evidence.log_tail.slice(-3000),
        events: evidence.events.slice(-30),
      },
    },
  }
}
