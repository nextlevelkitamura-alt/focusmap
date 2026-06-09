export type CodexLaunchMode = "thread" | "browser-deep-link" | "chatgpt-mobile" | "local-api" | "electron-bridge"
export type MobilePlatform = "ios" | "android" | "mobile" | "desktop"

export type CodexLaunchPayload = {
  prompt: string
  repoPath: string | null
  threadUrl?: string | null
  originUrl?: string | null
  clipboardImageUrl?: string | null
}

export type CodexLaunchResult = {
  mode: CodexLaunchMode
  url?: string
  copiedToClipboard?: boolean
}

export type CodexPromptCopyAttempt = {
  copiedSynchronously: boolean
  finished: Promise<boolean>
}

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void
    }
  }
}

const LOCAL_CODEX_API_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const LOCAL_CODEX_PREVIEW_HOST_SUFFIXES = [".local", ".trycloudflare.com"]
export const CHATGPT_CODEX_MOBILE_URL = "https://chatgpt.com/codex/mobile/"
export const CHATGPT_ANDROID_PACKAGE = "com.openai.chatgpt"

type FocusmapNativeAppMessage =
  | { type: "focusmap:copyText"; text: string }
  | { type: "focusmap:copyCodexHandoff"; text: string; imageUrl?: string | null }
  | { type: "focusmap:copyAndOpenExternal"; text?: string; imageUrl?: string | null; url: string; urls?: string[] }
  | { type: "focusmap:openExternal"; url: string; urls?: string[] }

type FocusmapDesktopCodexBridge = {
  copyText?: (text: string) => Promise<{ ok?: boolean; copied?: boolean; error?: string } | boolean>
  launchCodex?: (payload: {
    prompt?: string
    repoPath?: string | null
    threadUrl?: string | null
    codexUrl?: string | null
    originUrl?: string | null
    clipboardImageUrl?: string | null
  }) => Promise<{
    ok?: boolean
    error?: string
    mode?: string
    url?: string
    copiedToClipboard?: boolean
  } | boolean>
}

function focusmapDesktopCodexBridge() {
  if (typeof window === "undefined") return null
  return (window as Window & { focusmapDesktop?: FocusmapDesktopCodexBridge }).focusmapDesktop ?? null
}

export function canUseElectronCodexBridge() {
  return Boolean(focusmapDesktopCodexBridge()?.launchCodex)
}

export function isLocalCodexOpenHost(hostname: string) {
  const normalized = normalizeHostForCodexOpen(hostname)
  if (!normalized) return false
  if (LOCAL_CODEX_API_HOSTS.has(normalized)) return true
  return LOCAL_CODEX_PREVIEW_HOST_SUFFIXES.some(suffix => normalized.endsWith(suffix))
}

export function normalizeHostForCodexOpen(hostnameOrHost: string | null | undefined) {
  const first = (hostnameOrHost ?? "").split(",")[0]?.trim().toLowerCase() ?? ""
  if (!first) return ""

  const withoutProtocol = first.includes("://")
    ? (() => {
        try {
          return new URL(first).host
        } catch {
          return first.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        }
      })()
    : first

  if (withoutProtocol.startsWith("[")) {
    const end = withoutProtocol.indexOf("]")
    return end > 0 ? withoutProtocol.slice(1, end) : withoutProtocol
  }

  return withoutProtocol.split(":")[0] ?? ""
}

export function isLocalCodexOpenRequestHost(input: {
  nextHostname?: string | null
  host?: string | null
  forwardedHost?: string | null
}) {
  return [input.nextHostname, input.host, input.forwardedHost].some(value => isLocalCodexOpenHost(value ?? ""))
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

export function beginCopyTextToClipboard(text: string): CodexPromptCopyAttempt {
  const value = text.replace(/\r\n?/g, "\n")
  let copied = false

  if (typeof document !== "undefined" && document.body) {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "0"
    textarea.style.width = "1px"
    textarea.style.height = "1px"
    textarea.style.fontSize = "16px"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    document.body.appendChild(textarea)
    try {
      textarea.focus({ preventScroll: true })
      textarea.select()
      textarea.setSelectionRange(0, value.length)
      copied = document.execCommand("copy")
    } catch {
      copied = false
    } finally {
      document.body.removeChild(textarea)
      activeElement?.focus({ preventScroll: true })
    }
  }

  const useAsyncClipboard = !canUseFocusmapNativeAppBridge()
  const finished = useAsyncClipboard && typeof navigator !== "undefined" && navigator.clipboard?.writeText
    ? navigator.clipboard.writeText(value)
      .then(() => true)
      .catch(() => copied)
    : Promise.resolve(copied)

  return { copiedSynchronously: copied, finished }
}

export function copyTextToClipboard(text: string): Promise<boolean> {
  return beginCopyTextToClipboard(text).finished
}

export function canUseLocalCodexOpenApi() {
  if (typeof window === "undefined") return false
  if (canUseElectronCodexBridge()) return true
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
  const bridge = focusmapDesktopCodexBridge()
  if (bridge?.copyText) {
    try {
      const result = await bridge.copyText(normalizeCodexPrompt(prompt))
      if (result === true || (typeof result === "object" && (result.ok === true || result.copied === true))) return true
    } catch {
      // Fall through to the local API when available.
    }
  }

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

export function beginCopyPromptForCodexHandoff(prompt: string): CodexPromptCopyAttempt {
  const attempt = beginCopyTextToClipboard(prompt)
  return {
    copiedSynchronously: attempt.copiedSynchronously,
    finished: attempt.finished.then(async copied => {
      if (copied) return true
      if (canUseLocalCodexOpenApi() && !isLikelyMobileDevice()) {
        return copyCodexPromptViaLocalApi(prompt).catch(() => false)
      }
      return false
    }),
  }
}

export async function copyPromptForCodexHandoff(prompt: string): Promise<boolean> {
  return beginCopyPromptForCodexHandoff(prompt).finished
}

export function getCurrentMobilePlatform(): MobilePlatform {
  if (typeof navigator === "undefined") return "desktop"
  return detectMobilePlatform(navigator.userAgent || "", navigator.maxTouchPoints)
}

export function buildChatGptCodexMobileAppUrls(platform: MobilePlatform) {
  if (platform === "android") {
    return [buildChatGptCodexMobileAppUrl(platform), CHATGPT_CODEX_MOBILE_URL]
  }
  if (platform === "ios") {
    return [
      CHATGPT_CODEX_MOBILE_URL,
      "chatgpt://codex/mobile",
      "chatgpt://codex",
      "com.openai.chat://codex/mobile",
      "chatgpt://",
      "com.openai.chat://",
    ]
  }
  return [CHATGPT_CODEX_MOBILE_URL]
}

export function buildChatGptCodexMobileAppUrl(platform: MobilePlatform) {
  if (platform === "android") {
    const fallbackUrl = encodeURIComponent(CHATGPT_CODEX_MOBILE_URL)
    return `intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=${CHATGPT_ANDROID_PACKAGE};S.browser_fallback_url=${fallbackUrl};end`
  }
  if (platform === "ios") return CHATGPT_CODEX_MOBILE_URL
  return CHATGPT_CODEX_MOBILE_URL
}

export function buildChatGptCodexMobileWebUrl() {
  return CHATGPT_CODEX_MOBILE_URL
}

export function isLikelyChatGptMobileAppTarget(url: string) {
  return url === CHATGPT_CODEX_MOBILE_URL || url.startsWith("com.openai.chat:") || url.startsWith("chatgpt:") || url.startsWith("intent://")
}

export function isLikelyChatGptMobileWebTarget(url: string) {
  return url.startsWith("https://chatgpt.com/")
}

function postFocusmapNativeAppMessage(payload: FocusmapNativeAppMessage) {
  if (typeof window === "undefined") return false
  const postMessage = window.ReactNativeWebView?.postMessage
  if (!postMessage) return false

  try {
    postMessage(JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function canUseFocusmapNativeAppBridge() {
  return typeof window !== "undefined" && Boolean(window.ReactNativeWebView?.postMessage)
}

export function copyTextViaFocusmapNativeApp(text: string) {
  const value = normalizeCodexPrompt(text)
  if (!value) return false
  return postFocusmapNativeAppMessage({ type: "focusmap:copyText", text: value })
}

export function copyCodexHandoffViaFocusmapNativeApp(text: string, imageUrl?: string | null) {
  const value = normalizeCodexPrompt(text)
  if (!value) return false
  return postFocusmapNativeAppMessage({
    type: "focusmap:copyCodexHandoff",
    text: value,
    imageUrl: imageUrl?.trim() || null,
  })
}

function uniqueUrls(urls: string[]) {
  return [...new Set(urls.map(url => url.trim()).filter(Boolean))]
}

export function openExternalUrlViaFocusmapNativeApp(url: string, urls?: string[]) {
  const candidates = urls ? uniqueUrls([url, ...urls]) : undefined
  return postFocusmapNativeAppMessage({ type: "focusmap:openExternal", url, urls: candidates })
}

export function openCodexMobileTargetViaFocusmapNativeApp(url: string, prompt?: string, urls?: string[], clipboardImageUrl?: string | null) {
  if (!isLikelyChatGptMobileAppTarget(url) && !isLikelyChatGptMobileWebTarget(url)) return false
  const candidates = urls ? uniqueUrls([url, ...urls]) : undefined
  if (prompt) {
    return postFocusmapNativeAppMessage({
      type: "focusmap:copyAndOpenExternal",
      text: normalizeCodexPrompt(prompt),
      imageUrl: clipboardImageUrl?.trim() || null,
      url,
      urls: candidates,
    })
  }
  return openExternalUrlViaFocusmapNativeApp(url, urls)
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
    const mobilePlatform = options.mobilePlatform ?? "mobile"
    const urls = buildChatGptCodexMobileAppUrls(mobilePlatform)
    return {
      mode: "chatgpt-mobile" as const,
      url: urls[0],
      fallbackUrl: buildChatGptCodexMobileWebUrl(),
      urls,
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
  const bridge = focusmapDesktopCodexBridge()
  if (bridge?.launchCodex) {
    const normalizedPrompt = normalizeCodexPrompt(payload.prompt)
    const result = await bridge.launchCodex({
      prompt: normalizedPrompt,
      repoPath: payload.repoPath?.trim() || null,
      threadUrl: payload.threadUrl?.trim() || null,
      codexUrl: payload.threadUrl?.trim() || null,
      originUrl: payload.originUrl ?? window.location.href,
      clipboardImageUrl: payload.clipboardImageUrl?.trim() || null,
    })
    if (result !== true && (!result || typeof result !== "object" || result.ok === false)) {
      throw new Error(
        typeof result === "object" && result?.error
          ? result.error
          : "Codex.app を開けませんでした",
      )
    }
    const bridgeResult = typeof result === "object" ? result : {}
    const copiedToClipboard = bridgeResult.copiedToClipboard === true
    if (normalizedPrompt && !copiedToClipboard) {
      throw new Error("プロンプトをクリップボードにコピーできませんでした")
    }
    return {
      mode: "electron-bridge",
      url: bridgeResult.url,
      copiedToClipboard,
    }
  }

  const res = await fetch("/api/codex/open-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_path: payload.repoPath?.trim() || null,
      prompt: normalizeCodexPrompt(payload.prompt),
      codex_url: payload.threadUrl?.trim() || null,
      origin_url: payload.originUrl ?? window.location.href,
      clipboard_image_url: payload.clipboardImageUrl?.trim() || null,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `Codex.app を開けませんでした (${res.status})`)
  }
  const data = await res.json().catch(() => ({})) as { copied_to_clipboard?: boolean }
  const copiedToClipboard = data.copied_to_clipboard === true
  if (normalizeCodexPrompt(payload.prompt) && !copiedToClipboard) {
    throw new Error("プロンプトをクリップボードにコピーできませんでした")
  }

  return { mode: "local-api", copiedToClipboard }
}

export function launchFeedbackForMode(mode: CodexLaunchMode) {
  if (mode === "local-api" || mode === "electron-bridge") return "Codex.app のチャットを開いています"
  if (mode === "chatgpt-mobile") return "Codexを開くリクエストを出しました"
  return "Codex.app を開くリクエストを出しました。確認ダイアログが出たら Open Codex を選んでください"
}
