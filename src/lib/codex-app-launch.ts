export type CodexLaunchMode = "thread" | "browser-deep-link" | "local-api"

export type CodexLaunchPayload = {
  prompt: string
  repoPath: string | null
  threadUrl?: string | null
  originUrl?: string | null
}

export type CodexLaunchResult = {
  mode: CodexLaunchMode
  url?: string
}

const LOCAL_CODEX_API_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])

export function normalizeCodexPrompt(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim()
}

export function canUseLocalCodexOpenApi() {
  if (typeof window === "undefined") return false
  return LOCAL_CODEX_API_HOSTS.has(window.location.hostname)
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

export function launchCodexFromBrowser(payload: CodexLaunchPayload): CodexLaunchResult {
  const url = buildCodexDeepLink({
    ...payload,
    originUrl: payload.originUrl ?? (typeof window !== "undefined" ? window.location.href : null),
  })
  window.location.href = url
  return { mode: payload.threadUrl ? "thread" : "browser-deep-link", url }
}

export async function launchCodexViaLocalApi(payload: CodexLaunchPayload): Promise<CodexLaunchResult> {
  if (payload.threadUrl?.trim()) {
    return launchCodexFromBrowser(payload)
  }
  if (!payload.repoPath?.trim()) {
    throw new Error("Codex.appで開くリポジトリを設定してください")
  }

  const res = await fetch("/api/codex/open-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repo_path: payload.repoPath.trim(),
      prompt: normalizeCodexPrompt(payload.prompt),
      origin_url: payload.originUrl ?? window.location.href,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error || `Codex.app を開けませんでした (${res.status})`)
  }

  return { mode: "local-api" }
}

export function launchFeedbackForMode(mode: CodexLaunchMode) {
  if (mode === "local-api") return "Codex.app のチャットを開いています"
  return "Codex.app を開くリクエストを出しました。確認ダイアログが出たら Open Codex を選んでください"
}
