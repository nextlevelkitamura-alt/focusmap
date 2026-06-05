import { describe, expect, test } from "vitest"
import {
  appendCodexHandoffToken,
  buildChatGptCodexMobileAppUrl,
  buildCodexDeepLink,
  buildCodexHandoffToken,
  buildCodexOpenTarget,
  detectMobilePlatform,
  isLocalCodexOpenHost,
} from "./codex-app-launch"

describe("isLocalCodexOpenHost", () => {
  test("allows localhost and Cloudflare phone preview hosts", () => {
    expect(isLocalCodexOpenHost("localhost")).toBe(true)
    expect(isLocalCodexOpenHost("127.0.0.1")).toBe(true)
    expect(isLocalCodexOpenHost("abc-123.trycloudflare.com")).toBe(true)
  })

  test("does not allow production-style remote hosts", () => {
    expect(isLocalCodexOpenHost("focusmap.example.com")).toBe(false)
    expect(isLocalCodexOpenHost("trycloudflare.com.evil.example")).toBe(false)
  })
})

describe("buildCodexDeepLink", () => {
  test("injects prompt and repository path into codex URL", () => {
    const url = new URL(buildCodexDeepLink({
      prompt: "  fix this\r\n\n",
      repoPath: "/Users/me/project",
      originUrl: "https://abc-123.trycloudflare.com/dashboard",
    }))

    expect(url.protocol).toBe("codex:")
    expect(url.searchParams.get("prompt")).toBe("fix this")
    expect(url.searchParams.get("path")).toBe("/Users/me/project")
    expect(url.searchParams.get("originUrl")).toBe("https://abc-123.trycloudflare.com/dashboard")
  })
})

describe("Codex handoff token", () => {
  test("builds a schedule-compatible token and appends it once", () => {
    const token = buildCodexHandoffToken("task-123")
    expect(token).toMatch(/^FM-[A-Za-z0-9._:-]{8,120}$/)

    const prompt = appendCodexHandoffToken("Fix this", token)
    expect(prompt).toContain(`Focusmap同期ID: ${token}`)
    expect(appendCodexHandoffToken(prompt, token)).toBe(prompt)
  })
})

describe("ChatGPT mobile open target", () => {
  test("detects iPhone, Android and iPad desktop user agents", () => {
    expect(detectMobilePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios")
    expect(detectMobilePlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe("android")
    expect(detectMobilePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", 5)).toBe("ios")
  })

  test("uses ChatGPT app scheme on iOS and Android intent on Android", () => {
    expect(buildChatGptCodexMobileAppUrl("ios")).toBe("com.openai.chat://https://chatgpt.com/codex/mobile/")
    expect(buildChatGptCodexMobileAppUrl("android")).toBe(
      "intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end",
    )
  })

  test("prefers app links instead of browser URL for mobile Codex", () => {
    expect(buildCodexOpenTarget({ prompt: "hello", repoPath: null }, { preferMobile: true, mobilePlatform: "ios" }).url)
      .toBe("com.openai.chat://https://chatgpt.com/codex/mobile/")
    expect(buildCodexOpenTarget({ prompt: "hello", repoPath: null }, { preferMobile: true, mobilePlatform: "android" }).url)
      .toBe("intent://chatgpt.com/codex/mobile/#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=https%3A%2F%2Fchatgpt.com%2Fcodex%2Fmobile%2F;end")
  })
})
