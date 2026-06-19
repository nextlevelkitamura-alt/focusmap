type ActivityLike = {
  id?: string | null
  role?: string | null
  kind?: string | null
  body: string
  created_at?: string | null
  importance?: string | null
}

const NOISY_PROGRESS_PATTERNS = [
  /起動待ち|ready|Ready|dev server|localhost|3001|ポート|PID|tmux|nohup/u,
  /curl|HTTP smoke|HTTP 400|route|fake key|DB照会|コンパイル/u,
  /git status|worktree|ステージ|amend|push処理中|再push|origin\/main/u,
  /確認中です|待っています|実行中です|取得中です|起動します|停止します/u,
]

const GENERIC_CODEX_STATUS_PATTERNS = [
  /Codex\.appの稼働シグナルを確認中/u,
  /Codex実行を開始しました/u,
  /Codexが実行を開始しました/u,
  /Codexが承認を待っています/u,
  /Codexセッションは確認待ち/u,
  /Codex thread/u,
  /^状態:\s*/u,
]

function createdAtMs(message: ActivityLike) {
  const time = new Date(message.created_at ?? "").getTime()
  return Number.isFinite(time) ? time : 0
}

function messageKey(message: ActivityLike) {
  return message.id || `${message.created_at ?? ""}:${message.role}:${message.kind}:${message.body}`
}

function isUserRequestMessage(message: ActivityLike) {
  return message.role === "user" || message.kind === "sent" || message.kind === "user_answer"
}

function normalizedUserRequestKey(message: ActivityLike) {
  const body = message.body.replace(/\s+/g, " ").trim()
  return body ? `user:${body}` : messageKey(message)
}

function reportDedupeKey(message: ActivityLike) {
  if (isUserRequestMessage(message)) return normalizedUserRequestKey(message)
  return messageKey(message)
}

function preferReportMessage<T extends ActivityLike>(current: T, next: T) {
  const currentTime = createdAtMs(current)
  const nextTime = createdAtMs(next)
  if (nextTime !== currentTime) return nextTime > currentTime ? next : current
  if (isUserRequestMessage(current) && isUserRequestMessage(next)) {
    if (current.kind === "sent" && next.kind !== "sent") return next
  }
  return next
}

function isGenericStatusBody(body: string) {
  return GENERIC_CODEX_STATUS_PATTERNS.some(pattern => pattern.test(body))
}

function isFineGrainedProgress(message: ActivityLike) {
  if (message.role === "status" || message.role === "system") return true
  if (message.kind !== "progress" && message.kind !== "prompt_waiting" && message.kind !== "resumed") return false
  const body = message.body.trim()
  if (!body || isGenericStatusBody(body)) return true
  return NOISY_PROGRESS_PATTERNS.some(pattern => pattern.test(body))
}

function isReportMessage(message: ActivityLike) {
  if (isUserRequestMessage(message)) return false
  if (message.role === "status" || message.role === "system") return false
  if (isGenericStatusBody(message.body)) return false
  if (message.kind === "completed" || message.kind === "failed" || message.kind === "question" || message.kind === "approval") return true
  if (message.importance === "important" && !isFineGrainedProgress(message)) return true
  return false
}

function fallbackLatestCodexReport(messages: ActivityLike[]) {
  return [...messages]
    .reverse()
    .find(message =>
      !isUserRequestMessage(message) &&
      message.role !== "status" &&
      message.role !== "system" &&
      !isGenericStatusBody(message.body) &&
      !isFineGrainedProgress(message)
    )
}

function dedupeReportMessages<T extends ActivityLike>(messages: T[]) {
  const byKey = new Map<string, T>()
  for (const message of messages) {
    const key = reportDedupeKey(message)
    const current = byKey.get(key)
    byKey.set(key, current ? preferReportMessage(current, message) : message)
  }
  return Array.from(byKey.values()).sort((a, b) => createdAtMs(a) - createdAtMs(b))
}

export function codexReportViewMessages<T extends ActivityLike>(messages: T[], options?: {
  maxUserMessages?: number
  maxReportMessages?: number
}) {
  const maxUserMessages = options?.maxUserMessages ?? 3
  const maxReportMessages = options?.maxReportMessages ?? 2
  const normalized = dedupeReportMessages(messages.filter(message => message.body.trim()))
  const userMessages = normalized.filter(isUserRequestMessage)
  const reportMessages = normalized.filter(isReportMessage)
  const fallbackReport = reportMessages.length > 0 ? null : fallbackLatestCodexReport(normalized)
  const selected = [
    ...userMessages.slice(0, 1),
    ...userMessages.slice(1).slice(-Math.max(0, maxUserMessages - 1)),
    ...(reportMessages.length > 0 ? reportMessages.slice(-maxReportMessages) : fallbackReport ? [fallbackReport] : []),
  ]
  return dedupeReportMessages(selected)
}

export function codexReportViewSummaryMessages(messages: ActivityLike[]) {
  return codexReportViewMessages(messages, {
    maxUserMessages: 4,
    maxReportMessages: 3,
  })
}
