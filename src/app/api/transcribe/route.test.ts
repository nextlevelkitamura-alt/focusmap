import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
}))

vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
    })
  ),
}))

import { POST } from "./route"

function requestWithAudio() {
  const body = new FormData()
  body.append("audio", new File(["audio"], "recording.webm", { type: "audio/webm" }))
  return new Request("http://localhost/api/transcribe", {
    method: "POST",
    body,
  })
}

describe("POST /api/transcribe", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("GROQ_API_KEY", "test-groq-key")
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test("returns ignored when Groq responds with a silence-only filler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ text: "ありがとうございました。" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    )

    const response = await POST(requestWithAudio())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      text: "",
      ignored: true,
      reason: "silence_only_transcription",
    })
  })

  test("returns trimmed transcription text for meaningful speech", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ text: "  今日のメモを作る  " }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    )

    const response = await POST(requestWithAudio())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({ text: "今日のメモを作る" })
  })
})
