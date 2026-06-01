export type CodexLaunchMode = "thread" | "browser-deep-link" | "chatgpt-mobile" | "local-api"

export type CodexLaunchPayload = {
  prompt: string
  repoPath: string | null
  threadUrl?: string | null
  originUrl?: string | null
}

export type CodexLaunchResult = {
  mode: CodexLaunchMode
  url?: string
  copiedToClipboard?: boolean
}

const LOCAL_CODEX_API_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const LOCAL_CODEX_PREVIEW_HOST_SUFFIXES = [".trycloudflare.com"]
export const CHATGPT_CODEX_MOBILE_URL = "https://chatgpt.com/codex/mobile/"

export function isLocalCodexOpenHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  if (LOCAL_CODEX_API_HOSTS.has(normalized)) return true
  return LOCAL_CODEX_PREVIEW_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix))
}

export function normalizeCodexPrompt(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim()
}

export function canUseLocalCodexOpenApi() {
  if (typeof window === "undefined") return false
  return isLocalCodexOpenHost(window.location.hostname)
}

export function isLikelyMobileDevice() {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent || ""
  const mobileUa = /Android|iPhone|iPod|IEMobile|Mobile/i.test(ua)
  const iPadDesktopUa = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1
  return mobileUa || iPadDesktopUa
}

export function buildCodexDeepLink({ prompt, repoPath, threadUrl, originUrl }: CodexLaunchPayload) {
  if (threadUrl?.trim()) return threadUrl.trim()

  const url = new URL("codex://")
  const normalizedPrompt = normalizeCodexPrompt(prompt)
  if (normalizedPrompt) url.searchParams.set("prompt", normalizedPrompt)
  if (repoPath?.trim()) url.searchParams.set("path", repoPath.trim())
  if (originUrl?.trim()) url.searchParams.set("originUrl", originUrl.trim())
  return url.toString()
}

export function buildCodexOpenTarget(payload: CodexLaunchPayload, options: { preferMobile?: boolean } = {}) {
  if (options.preferMobile) {
    return { mode: "chatgpt-mobile" as const, url: CHATGPT_CODEX_MOBILE_URL }
  }
  return {
    mode: payload.threadUrl ? "thread" as const : "browser-deep-link" as const,
    url: buildCodexDeepLink(payload),
  }
}

export function launchCodexFromBrowser(payload: CodexLaunchPayload): CodexLaunchResult {
  const url = buildCodexDeepLink({
    ...payload,
    originUrl: payload.originUrl ?? (typeof window !== "undefined" ? window.location.href : null),
  })
  window.location.href = url
  return { mode: payload.threadUrl ? "thread" : "browser-deep-link", url }
}

export async function launchCodexViaLocalApi(payload: CodexLaunchPayload): Promise<CodexLaunchResult> {
  const res = await fetch("/api/codex/open-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_path: payload.repoPath?.trim() || null,
      prompt: normalizeCodexPrompt(payload.prompt),
      codex_url: payload.threadUrl?.trim() || null,
      origin_url: payload.originUrl ?? window.location.href,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `Codex.app を開けませんでした (${res.status})`)
  }
  const data = await res.json().catch(() => ({})) as { copied_to_clipboard?: boolean }

  return { mode: "local-api", copiedToClipboard: data.copied_to_clipboard === true }
}

export function launchFeedbackForMode(mode: CodexLaunchMode) {
  if (mode === "local-api") return "Codex.app のチャットを開いています"
  if (mode === "chatgpt-mobile") return "ChatGPTアプリのCodex画面を開くリクエストを出しました"
  return "Codex.app を開くリクエストを出しました。確認ダイアログが出たら Open Codex を選んでください"
}
