export type CodexLaunchMode = "thread" | "browser-deep-link" | "chatgpt-mobile" | "local-api"
export type MobilePlatform = "ios" | "android" | "mobile" | "desktop"

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
export const CHATGPT_CODEX_MOBILE_APP_URL = `com.openai.chat://${CHATGPT_CODEX_MOBILE_URL}`
export const CHATGPT_ANDROID_PACKAGE = "com.openai.chatgpt"

export function isLocalCodexOpenHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return false
  if (LOCAL_CODEX_API_HOSTS.has(normalized)) return true
  return LOCAL_CODEX_PREVIEW_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix))
}

export function normalizeCodexPrompt(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim()
}

function randomHandoffSuffix() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}

function sanitizeHandoffSeed(value: string | null | undefined) {
  return value?.trim().replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 24) || null
}

export function buildCodexHandoffToken(seed?: string | null) {
  const suffix = sanitizeHandoffSeed(seed)
  return `FM-${Date.now().toString(36)}-${randomHandoffSuffix()}${suffix ? `-${suffix}` : ""}`
}

export function appendCodexHandoffToken(prompt: string, token: string | null | undefined) {
  const normalizedPrompt = normalizeCodexPrompt(prompt)
  if (token?.trim()) return normalizedPrompt
  return normalizedPrompt
}

export function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text.replace(/\r\n?/g, "\n")
  let copied = false

  if (typeof document !== "undefined") {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const textarea = document.createElement("textarea")
    textarea.value = value
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

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value)
      .then(() => true)
      .catch(() => copied)
  }

  return Promise.resolve(copied)
}

export function canUseLocalCodexOpenApi() {
  if (typeof window === "undefined") return false
  return isLocalCodexOpenHost(window.location.hostname)
}

export function detectMobilePlatform(userAgent: string, maxTouchPoints = 0): MobilePlatform {
  const ua = userAgent || ""
  if (/Android/i.test(ua)) return "android"
  if (/iPhone|iPod|iPad/i.test(ua)) return "ios"
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios"
  if (/IEMobile|Mobile/i.test(ua)) return "mobile"
  return "desktop"
}

export function isLikelyMobileDevice() {
  if (typeof navigator === "undefined") return false
  return detectMobilePlatform(navigator.userAgent || "", navigator.maxTouchPoints) !== "desktop"
}

export async function copyCodexPromptViaLocalApi(prompt: string): Promise<boolean> {
  const res = await fetch("/api/codex/open-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: normalizeCodexPrompt(prompt),
      repo_path: null,
      open_app: false,
      origin_url: typeof window !== "undefined" ? window.location.href : null,
    }),
  })
  if (!res.ok) return false
  const data = await res.json().catch(() => ({})) as { copied_to_clipboard?: boolean }
  return data.copied_to_clipboard === true
}

export async function copyPromptForCodexHandoff(prompt: string): Promise<boolean> {
  const copied = await copyTextToClipboard(prompt)
  if (copied) return true
  if (canUseLocalCodexOpenApi() && !isLikelyMobileDevice()) {
    return copyCodexPromptViaLocalApi(prompt)
  }
  return false
}

export function getCurrentMobilePlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "desktop"
  return detectMobilePlatform(navigator.userAgent || "", navigator.maxTouchPoints)
}

export function buildChatGptCodexMobileAppUrl(platform: MobilePlatform) {
  if (platform === "android") {
    const fallbackUrl = encodeURIComponent(CHATGPT_CODEX_MOBILE_URL)
    return `intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=${CHATGPT_ANDROID_PACKAGE};S.browser_fallback_url=${fallbackUrl};end`
  }
  return CHATGPT_CODEX_MOBILE_APP_URL
}

export function buildChatGptCodexMobileWebUrl() {
  return CHATGPT_CODEX_MOBILE_URL
}

export function isLikelyChatGptMobileAppTarget(url: string) {
  return url.startsWith("com.openai.chat:") || url.startsWith("intent://")
}

export function isLikelyChatGptMobileWebTarget(url: string) {
  return url.startsWith("https://chatgpt.com/")
}

export function isLikelyMobileUserAgent(userAgent: string, maxTouchPoints = 0) {
  return detectMobilePlatform(userAgent, maxTouchPoints) !== "desktop"
}

export function buildCodexDeepLink({ repoPath, threadUrl, originUrl }: CodexLaunchPayload) {
  if (threadUrl?.trim()) return threadUrl.trim()

  const url = new URL("codex://")
  if (repoPath?.trim()) url.searchParams.set("path", repoPath.trim())
  if (originUrl?.trim()) url.searchParams.set("originUrl", originUrl.trim())
  return url.toString()
}

export function buildCodexOpenTarget(payload: CodexLaunchPayload, options: { preferMobile?: boolean; mobilePlatform?: MobilePlatform } = {}) {
  if (options.preferMobile) {
    return {
      mode: "chatgpt-mobile" as const,
      url: buildChatGptCodexMobileAppUrl(options.mobilePlatform ?? "mobile"),
      fallbackUrl: buildChatGptCodexMobileWebUrl(),
    }
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
