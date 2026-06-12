import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

const codexAppLaunchMock = vi.hoisted(() => ({
  copyCodexImageToClipboard: vi.fn(async () => ({ copiedImageToClipboard: true })),
  copyPromptForCodexHandoff: vi.fn(async () => true),
  launchCodexViaLocalApi: vi.fn(),
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
	  copyCodexImageToClipboard: codexAppLaunchMock.copyCodexImageToClipboard,
	  copyPromptForCodexHandoff: codexAppLaunchMock.copyPromptForCodexHandoff,
	  getCurrentMobilePlatform: () => "desktop",
	  isLikelyMobileDevice: () => false,
	  launchCodexViaLocalApi: codexAppLaunchMock.launchCodexViaLocalApi,
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
	    codexAppLaunchMock.copyCodexImageToClipboard.mockClear()
	    codexAppLaunchMock.copyPromptForCodexHandoff.mockClear()
	    codexAppLaunchMock.launchCodexViaLocalApi.mockClear()
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

	  test("shows compact attachment copy controls and image preview without the date field", async () => {
	    const attachment = {
	      id: "image-1",
	      file_name: "IMG_3776.jpg",
	      file_url: "https://example.com/IMG_3776.jpg",
	      file_type: "image/jpeg",
	      file_size: 120 * 1024,
	    }
	    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
	      const url = String(input)
	      if (url === "/api/tasks/task-1") {
	        return jsonResponse({
	          task: {
	            id: "task-1",
	            title: "AI生成マインドマップのUIと処理ロジックの再構築",
	            memo: "既存のマインドマップを整理したい",
	            scheduled_at: null,
	            estimated_time: null,
	            calendar_id: null,
	            google_event_id: null,
	          },
	        })
	      }
	      if (url === "/api/tasks/task-1/attachments") {
	        return jsonResponse({ attachments: [attachment] })
	      }
	      return jsonResponse({})
	    }))

	    render(
	      <CodexNodePanel
	        open
	        node={{
	          taskId: "task-1",
	          title: "AI生成マインドマップのUIと処理ロジックの再構築",
	          memo: "既存のマインドマップを整理したい",
	          cwd: "/repo/focusmap",
	          status: "todo",
	        }}
	        candidates={["/repo/focusmap"]}
	        onClose={vi.fn()}
	        onPersistDir={vi.fn()}
	      />,
	    )

	    expect(await screen.findByText("IMG_3776.jpg")).toBeInTheDocument()
	    expect(screen.queryByText("画像コピー")).not.toBeInTheDocument()
	    expect(screen.queryByText("日付")).not.toBeInTheDocument()

	    fireEvent.click(screen.getByRole("button", { name: "IMG_3776.jpgをCodex貼り付け用にコピー" }))

	    await waitFor(() => {
	      expect(codexAppLaunchMock.copyCodexImageToClipboard).toHaveBeenCalledWith("https://example.com/IMG_3776.jpg")
	    })

	    fireEvent.click(screen.getByRole("button", { name: "IMG_3776.jpgをプレビュー" }))

	    expect(screen.getByRole("dialog", { name: "IMG_3776.jpgのプレビュー" })).toBeInTheDocument()
	    expect(screen.getByRole("button", { name: "プレビューを閉じる" })).toBeInTheDocument()
	  })
	})
