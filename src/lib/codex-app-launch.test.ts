import { afterEach, describe, expect, test, vi } from "vitest"
import {
  appendCodexHandoffToken,
  buildChatGptCodexMobileAppUrl,
  buildChatGptCodexMobileAppUrls,
  buildCodexDeepLink,
  buildCodexHandoffToken,
  buildCodexOpenTarget,
  detectMobilePlatform,
  isLocalCodexOpenHost,
  isLocalCodexOpenRequestHost,
  launchCodexViaLocalApi,
  openCodexMobileTargetViaFocusmapNativeApp,
} from "./codex-app-launch"

afterEach(() => {
  delete window.ReactNativeWebView
  vi.unstubAllGlobals()
})

describe("isLocalCodexOpenHost", () => {
  test("allows localhost, Mac Bonjour hosts, and Cloudflare phone preview hosts", () => {
    expect(isLocalCodexOpenHost("localhost")).toBe(true)
    expect(isLocalCodexOpenHost("localhost:3001")).toBe(true)
    expect(isLocalCodexOpenHost("127.0.0.1")).toBe(true)
    expect(isLocalCodexOpenHost("http://127.0.0.1:3001")).toBe(true)
    expect(isLocalCodexOpenHost("naononmac.local")).toBe(true)
    expect(isLocalCodexOpenHost("naononmac.local:3001")).toBe(true)
    expect(isLocalCodexOpenHost("abc-123.trycloudflare.com")).toBe(true)
  })

  test("does not allow production-style remote hosts", () => {
    expect(isLocalCodexOpenHost("focusmap.example.com")).toBe(false)
    expect(isLocalCodexOpenHost("local.evil.example")).toBe(false)
    expect(isLocalCodexOpenHost("trycloudflare.com.evil.example")).toBe(false)
  })

  test("checks request host headers when Next normalizes nextUrl to a bind host", () => {
    expect(isLocalCodexOpenRequestHost({
      nextHostname: "0.0.0.0",
      host: "localhost:3001",
      forwardedHost: null,
    })).toBe(true)
    expect(isLocalCodexOpenRequestHost({
      nextHostname: "0.0.0.0",
      host: null,
      forwardedHost: "naononmac.local:3001",
    })).toBe(true)
    expect(isLocalCodexOpenRequestHost({
      nextHostname: "0.0.0.0",
      host: "focusmap.example.com",
      forwardedHost: null,
    })).toBe(false)
  })
})

describe("buildCodexDeepLink", () => {
  test("opens the repo without putting the prompt in the codex URL", () => {
    const url = new URL(buildCodexDeepLink({
      prompt: "  日本語を直す\r\n\n",
      repoPath: "/Users/me/project",
      originUrl: "https://abc-123.trycloudflare.com/dashboard",
    }))

    expect(url.protocol).toBe("codex:")
    expect(url.searchParams.get("prompt")).toBeNull()
    expect(url.searchParams.get("path")).toBe("/Users/me/project")
    expect(url.searchParams.get("originUrl")).toBe("https://abc-123.trycloudflare.com/dashboard")
  })
})

describe("Codex handoff token", () => {
  test("builds a schedule-compatible token without exposing it in the prompt", () => {
    const token = buildCodexHandoffToken("task-123")
    expect(token).toMatch(/^FM-[A-Za-z0-9._:-]{8,120}$/)

    const prompt = appendCodexHandoffToken(" Fix this\n", token)
    expect(prompt).toBe("Fix this")
    expect(prompt).not.toContain("Focusmap同期ID")
    expect(appendCodexHandoffToken(prompt, token)).toBe(prompt)
  })
})

describe("ChatGPT mobile open target", () => {
  test("detects iPhone, Android and iPad desktop user agents", () => {
    expect(detectMobilePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios")
    expect(detectMobilePlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("android")
    expect(detectMobilePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 5)).toBe("ios")
  })

  test("uses the official Codex mobile URL first on iOS and Android intent on Android", () => {
    expect(buildChatGptCodexMobileAppUrl("ios")).toBe("https://chatgpt.com/codex/mobile/")
    expect(buildChatGptCodexMobileAppUrls("ios")).toEqual([
      "https://chatgpt.com/codex/mobile/",
      "chatgpt://codex/mobile",
      "chatgpt://codex",
      "com.openai.chat://codex/mobile",
      "chatgpt://",
      "com.openai.chat://",
    ])
    expect(buildChatGptCodexMobileAppUrl("android")).toBe(
      "intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end",
    )
  })

  test("prefers app links instead of browser URL for mobile Codex", () => {
    expect(buildCodexOpenTarget({ prompt: "hello", repoPath: null }, { preferMobile: true, mobilePlatform: "ios" }).url)
      .toBe("https://chatgpt.com/codex/mobile/")
    expect(buildCodexOpenTarget({ prompt: "hello", repoPath: null }, { preferMobile: true, mobilePlatform: "android" }).url)
      .toBe("intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end")
  })

  test("posts the Codex mobile URL to the Focusmap native app bridge", () => {
    const postMessage = vi.fn()
    window.ReactNativeWebView = { postMessage }
    const urls = buildChatGptCodexMobileAppUrls("ios")

    expect(openCodexMobileTargetViaFocusmapNativeApp(urls[0], undefined, urls)).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(JSON.stringify({
      type: "focusmap:openExternal",
      url: "https://chatgpt.com/codex/mobile/",
      urls,
    }))
  })

  test("posts native clipboard text before opening Codex in the Focusmap app", () => {
    const postMessage = vi.fn()
    window.ReactNativeWebView = { postMessage }
    const urls = buildChatGptCodexMobileAppUrls("ios")

    expect(openCodexMobileTargetViaFocusmapNativeApp(urls[0], "  実行して\r\n", urls)).toBe(true)
    expect(postMessage).toHaveBeenNthCalledWith(1, JSON.stringify({
      type: "focusmap:copyText",
      text: "実行して",
    }))
    expect(postMessage).toHaveBeenNthCalledWith(2, JSON.stringify({
      type: "focusmap:openExternal",
      url: "https://chatgpt.com/codex/mobile/",
      urls,
    }))
  })

  test("does not intercept unsupported URLs or missing native bridge", () => {
    expect(openCodexMobileTargetViaFocusmapNativeApp("https://chatgpt.com/codex/mobile/")).toBe(false)

    const postMessage = vi.fn()
    window.ReactNativeWebView = { postMessage }

    expect(openCodexMobileTargetViaFocusmapNativeApp("https://example.com/")).toBe(false)
    expect(postMessage).not.toHaveBeenCalled()
  })
})

describe("launchCodexViaLocalApi", () => {
  test("rejects prompt handoff when the local API could not copy the prompt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      copied_to_clipboard: false,
    }), { status: 200 })))

    await expect(launchCodexViaLocalApi({ prompt: "実行して", repoPath: "/repo" }))
      .rejects.toThrow("プロンプトをクリップボードにコピーできませんでした")
  })

  test("allows repo-only open without a copied prompt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      copied_to_clipboard: false,
    }), { status: 200 })))

    await expect(launchCodexViaLocalApi({ prompt: "   ", repoPath: "/repo" }))
      .resolves.toEqual({ mode: "local-api", copiedToClipboard: false })
  })
})
