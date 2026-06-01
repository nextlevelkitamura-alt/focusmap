import { describe, expect, test } from "vitest"
import { buildCodexDeepLink, isLocalCodexOpenHost } from "./codex-app-launch"

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
