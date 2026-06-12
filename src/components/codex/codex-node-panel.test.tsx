import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, test, vi, beforeEach } from "vitest"

import { CodexNodePanel } from "./codex-node-panel"

const fetchWithSupabaseAuthMock = vi.hoisted(() => ({
  fetchWithSupabaseAuth: vi.fn(),
}))

const codexRunnerStatusMock = vi.hoisted(() => ({
  status: {
    checked: true,
    loading: false,
    ready: true,
    lastSeenAt: "2026-05-21T00:00:00.000Z",
    refresh: vi.fn(),
  },
}))

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => false,
}))

vi.mock("@/hooks/useCalendars", () => ({
  useCalendars: () => ({ calendars: [] }),
}))

vi.mock("@/hooks/useMemoAiTasks", () => ({
  useMemoAiTasks: () => ({
    getBySourceId: () => null,
    refresh: vi.fn(),
    refreshStatus: vi.fn(),
  }),
}))

vi.mock("@/hooks/useCodexRunnerStatus", () => ({
  useCodexRunnerStatus: () => codexRunnerStatusMock.status,
}))

vi.mock("@/hooks/useVoiceRecorder", () => ({
  useVoiceRecorder: () => ({
    isRecording: false,
    isTranscribing: false,
    error: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}))

vi.mock("@/hooks/useCodexManualHandoffConfirmation", () => ({
  useCodexManualHandoffConfirmation: () => ({
    trackManualHandoff: vi.fn(),
    confirmManualHandoffNow: vi.fn(),
    markScreenSwitched: vi.fn(),
  }),
}))

vi.mock("@/lib/auth/supabase-auth-fetch", () => ({
  fetchWithSupabaseAuth: fetchWithSupabaseAuthMock.fetchWithSupabaseAuth,
}))

vi.mock("@/lib/codex-app-launch", () => ({
  appendCodexHandoffToken: (prompt: string) => prompt,
  beginCopyPromptForCodexHandoff: () => ({
    copiedSynchronously: true,
    finished: Promise.resolve(true),
  }),
  buildCodexOpenTarget: () => ({ url: "#codex", mode: "browser-deep-link" }),
  buildCodexHandoffToken: () => "handoff-token",
  canUseLocalCodexOpenApi: () => false,
  copyCodexImageToClipboard: vi.fn(async () => ({ copiedImageToClipboard: true })),
  copyPromptForCodexHandoff: vi.fn(async () => true),
  getCurrentMobilePlatform: () => "desktop",
  isLikelyMobileDevice: () => false,
  launchCodexViaLocalApi: vi.fn(),
  launchFeedbackForMode: () => "Codexを開きました。",
  normalizeCodexPrompt: (value: string) => value.trim(),
  openCodexMobileTargetViaFocusmapNativeApp: () => false,
}))

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

describe("CodexNodePanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/tasks/task-1") {
        return jsonResponse({
          task: {
            id: "task-1",
            title: "新規案件に向けた準備と確認作業",
            memo: "初めての内容になるのでしっかりするということ",
            scheduled_at: null,
            estimated_time: 15,
            calendar_id: null,
            google_event_id: null,
          },
        })
      }
      if (url === "/api/tasks/task-1/attachments") {
        return jsonResponse({ attachments: [] })
      }
      return jsonResponse({})
    }))
    fetchWithSupabaseAuthMock.fetchWithSupabaseAuth.mockReset()
    fetchWithSupabaseAuthMock.fetchWithSupabaseAuth.mockResolvedValue(jsonResponse({ runners: [] }))
    codexRunnerStatusMock.status = {
      checked: true,
      loading: false,
      ready: true,
      lastSeenAt: "2026-05-21T00:00:00.000Z",
      refresh: vi.fn(),
    }
  })

  test("desktop opens as a right-side edit sheet with the memo-style controls", async () => {
    render(
      <CodexNodePanel
        open
        node={{
          taskId: "task-1",
          title: "新規案件に向けた準備と確認作業",
          memo: "初めての内容になるのでしっかりするということ",
          cwd: "/repo/focusmap",
          status: "todo",
          estimatedLabel: "15分",
        }}
        candidates={["/repo/focusmap"]}
        onClose={vi.fn()}
        onPersistDir={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveClass("right-0")
    expect(dialog).toHaveClass("w-[min(92vw,460px)]")
    expect(screen.getByRole("heading", { name: "メモを編集" })).toBeInTheDocument()
    expect(screen.getByDisplayValue("新規案件に向けた準備と確認作業")).toBeInTheDocument()
    expect(screen.getByDisplayValue("初めての内容になるのでしっかりするということ")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "コピーしてCodexに送る" })).toHaveTextContent("Codexに送る")
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument()

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-1", { cache: "no-store" })
    })
  })
})
