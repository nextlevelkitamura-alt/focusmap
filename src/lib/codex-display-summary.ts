import { sanitizeCodexDisplayText } from "@/lib/codex-display-sanitize"
import { codexReportViewSummaryMessages } from "@/lib/codex-report-view"

export type CodexDisplaySummaryMessage = {
  role?: string | null
  kind?: string | null
  body: string
  created_at?: string | null
}

export type CodexDisplaySummary = {
  done: string
  current: string
  next: string
}

export type CodexDisplaySummaryInput = {
  title: string
  status?: string | null
  statusLabel?: string | null
  snippet?: string | null
  detailText?: string | null
  messages: CodexDisplaySummaryMessage[]
}

function compactLine(value: unknown, maxChars = 96) {
  const text = sanitizeCodexDisplayText(value, {
    maxChars,
    fallback: "",
    appendOmissionNotice: false,
  }).text
  return text.replace(/[`*_#>\-[\]]/g, "").replace(/\s+/g, " ").trim()
}

function splitSentences(value: unknown) {
  return sanitizeCodexDisplayText(value, {
    maxChars: 1_600,
    fallback: "",
    appendOmissionNotice: false,
  }).text
    .split(/[\n。！？!?]+/u)
    .map(sentence => compactLine(sentence, 120))
    .filter(sentence => sentence.length >= 3)
}

function isUserMessage(message: CodexDisplaySummaryMessage) {
  return message.role === "user" || message.kind === "sent" || message.kind === "user_answer"
}

function collectCandidate(
  sources: string[],
  matcher: RegExp,
  fallback: string,
  maxChars = 96,
) {
  for (const source of sources) {
    for (const sentence of splitSentences(source)) {
      if (!matcher.test(sentence)) continue
      return compactLine(sentence, maxChars)
    }
  }
  return compactLine(fallback, maxChars)
}

function statusNext(status: string | null | undefined, statusLabel: string | null | undefined) {
  const source = `${status ?? ""} ${statusLabel ?? ""}`
  if (/running|実行中/u.test(source)) return "完了後の差分を確認"
  if (/awaiting|approval|needs_input|確認待ち/u.test(source)) return "確認待ちの内容を確認"
  if (/failed|接続失敗|失敗/u.test(source)) return "接続状態と再実行要否を確認"
  return "マップへ配置するか判断"
}

export function normalizeCodexDisplaySummaryInput(input: CodexDisplaySummaryInput): CodexDisplaySummaryInput {
  const messages = input.messages.flatMap(message => {
    const body = sanitizeCodexDisplayText(message.body, {
      maxChars: 1_600,
      fallback: "",
    }).text
    return body ? [{ ...message, body }] : []
  })

  return {
    ...input,
    title: compactLine(input.title, 120),
    snippet: compactLine(input.snippet, 600) || null,
    detailText: null,
    messages: codexReportViewSummaryMessages(messages),
  }
}

export function buildFallbackCodexDisplaySummary(rawInput: CodexDisplaySummaryInput): CodexDisplaySummary {
  const input = normalizeCodexDisplaySummaryInput(rawInput)
  const codexTexts = input.messages.filter(message => !isUserMessage(message)).map(message => message.body)
  const userTexts = input.messages.filter(isUserMessage).map(message => message.body)
  const allTexts = [...codexTexts, input.detailText ?? "", input.snippet ?? "", input.title].filter(Boolean)
  const latestCodex = [...codexTexts].reverse().find(Boolean)
  const latestUser = [...userTexts].reverse().find(Boolean)

  const done = collectCandidate(
    allTexts,
    /確認|整理|修正|追加|実装|反映|保存|更新|完了|削除|戻し|コミット|デプロイ|調査/u,
    latestCodex || latestUser || input.title || "チャット内容を確認",
  )
  const current = collectCandidate(
    allTexts,
    /方針|判断|仕様|変更|差分|原因|対象|状態|確認待ち|配置|表示|維持|優先/u,
    input.statusLabel || latestCodex || "状況を確認中",
  )
  const next = collectCandidate(
    [...codexTexts].reverse(),
    /次|確認|再確認|残|必要|TODO|レビュー|判断|ノード|配置|コミット|デプロイ|API|差分/u,
    statusNext(input.status, input.statusLabel),
  )

  return {
    done: done || "チャット内容を確認",
    current: current || "状況を確認中",
    next: next || statusNext(input.status, input.statusLabel),
  }
}

export function codexDisplaySummarySignature(input: CodexDisplaySummaryInput) {
  const normalized = normalizeCodexDisplaySummaryInput(input)
  const latestMessages = normalized.messages.slice(-8).map(message => [
    message.role ?? "",
    message.kind ?? "",
    message.created_at ?? "",
    message.body.slice(0, 240),
  ].join(":"))
  return JSON.stringify({
    title: normalized.title,
    status: normalized.status,
    statusLabel: normalized.statusLabel,
    snippet: normalized.snippet?.slice(0, 240) ?? "",
    detailText: normalized.detailText?.slice(0, 240) ?? "",
    latestMessages,
  })
}
