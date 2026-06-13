import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

const calendarEventsMock = vi.hoisted(() => ({
  broadcastCalendarOptimisticEvent: vi.fn(),
  broadcastCalendarOptimisticEventRemoval: vi.fn(),
  broadcastCalendarSync: vi.fn(),
  invalidateCalendarCache: vi.fn(),
}))

vi.mock("@/hooks/useCalendarEvents", () => ({
  useCalendarEvents: () => ({ events: [], isLoading: false }),
  broadcastCalendarOptimisticEvent: calendarEventsMock.broadcastCalendarOptimisticEvent,
  broadcastCalendarOptimisticEventRemoval: calendarEventsMock.broadcastCalendarOptimisticEventRemoval,
  broadcastCalendarSync: calendarEventsMock.broadcastCalendarSync,
  invalidateCalendarCache: calendarEventsMock.invalidateCalendarCache,
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

	  test("desktop opens as a compact right-side edit sheet with memo and schedule controls", async () => {
    const onClose = vi.fn()

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
        onClose={onClose}
        onPersistDir={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveClass("right-0")
    expect(dialog).toHaveClass("w-[min(92vw,460px)]")
    expect(screen.getByRole("heading", { name: "メモを編集" })).toHaveClass("sr-only")
    expect(screen.getByLabelText("見出し").tagName).toBe("INPUT")
    expect(screen.getByDisplayValue("新規案件に向けた準備と確認作業")).toBeInTheDocument()
    expect(screen.getByDisplayValue("初めての内容になるのでしっかりするということ")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "音声入力" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "見出し生成" })).toBeInTheDocument()
    expect(screen.queryByText("時刻")).not.toBeInTheDocument()
    expect(screen.queryByText("タグ")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "コピーしてCodexに送る" })).toHaveTextContent("Codexに送る")
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument()

    await waitFor(() => {
	      expect(global.fetch).toHaveBeenCalledWith("/api/tasks/task-1", { cache: "no-store" })
	    })

    const scheduleButton = screen.getByRole("button", { name: "予定を入れる" })
    await waitFor(() => expect(scheduleButton).not.toBeDisabled())

    fireEvent.click(scheduleButton)

    expect(await screen.findByTestId("codex-node-task-scheduler")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "予定フォームに戻る" })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
	  })

  test("keeps the scheduler open after dragging a task onto a time slot", async () => {
    const onClose = vi.fn()

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
        onClose={onClose}
        onPersistDir={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole("button", { name: "予定を入れる" }))

    const scheduler = await screen.findByTestId("codex-node-task-scheduler")
    const grid = screen.getByTestId("codex-node-scheduler-grid")
    const draft = screen.getByTestId("codex-node-scheduler-draft")
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 360,
      bottom: 1536,
      width: 360,
      height: 1536,
      toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(draft, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 640,
      top: 640,
      left: 0,
      right: 300,
      bottom: 680,
      width: 300,
      height: 40,
      toJSON: () => ({}),
    } as DOMRect)

    fireEvent.pointerDown(draft, { pointerId: 1, button: 0, clientY: 650 })
    fireEvent.pointerMove(draft, { pointerId: 1, clientY: 720 })
    fireEvent.pointerUp(draft, { pointerId: 1, clientY: 720 })

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/calendar/sync-task", expect.objectContaining({ method: "POST" }))
    })
    expect(scheduler).toBeInTheDocument()
    expect(screen.getByText("Googleカレンダーに登録しました")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  test("shows heading generation only after memo detail has text", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/tasks/task-1") {
        return jsonResponse({
          task: {
            id: "task-1",
            title: "空のメモ",
            memo: "",
            scheduled_at: null,
            estimated_time: null,
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

    render(
      <CodexNodePanel
        open
        node={{
          taskId: "task-1",
          title: "空のメモ",
          memo: "",
          cwd: "/repo/focusmap",
          status: "todo",
        }}
        candidates={["/repo/focusmap"]}
        onClose={vi.fn()}
        onPersistDir={vi.fn()}
      />,
    )

    expect(await screen.findByLabelText("見出し")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "見出し生成" })).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText("メモの詳細を書いてください"), {
      target: { value: "本文を入れたら見出し生成を出す" },
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "見出し生成" })).toBeInTheDocument()
    })
  })

  test("saves the generated heading as the node title when closing from the save button", async () => {
    const memo = "ノード生成ボタンの配置変更とUIデザイン案を整理したい"
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/tasks/task-1") {
        return jsonResponse({
          task: {
            id: "task-1",
            title: "えっとこのノードに関して長い文章を書いた",
            memo,
            scheduled_at: null,
            estimated_time: null,
            calendar_id: null,
            google_event_id: null,
          },
        })
      }
      if (url === "/api/tasks/task-1/attachments") {
        return jsonResponse({ attachments: [] })
      }
      if (url === "/api/ai/generate-memo-heading") {
        return jsonResponse({ heading: "ノード生成ボタンの配置改善" })
      }
      return jsonResponse({})
    }))
    const onSaveDraft = vi.fn()
    const onClose = vi.fn()

    render(
      <CodexNodePanel
        open
        node={{
          taskId: "task-1",
          title: "えっとこのノードに関して長い文章を書いた",
          memo,
          cwd: "/repo/focusmap",
          status: "todo",
        }}
        candidates={["/repo/focusmap"]}
        onClose={onClose}
        onPersistDir={vi.fn()}
        onSaveDraft={onSaveDraft}
      />,
    )

    fireEvent.click(await screen.findByRole("button", { name: "見出し生成" }))

    await waitFor(() => {
      expect(screen.getByDisplayValue("ノード生成ボタンの配置改善")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "保存" }))

    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenLastCalledWith("task-1", {
        title: "ノード生成ボタンの配置改善",
        memo,
      })
      expect(onClose).toHaveBeenCalled()
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

  test("shows a compact node delete button under the image add controls", async () => {
    const onClose = vi.fn()
    const onDelete = vi.fn()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)

    try {
      render(
        <CodexNodePanel
          open
          node={{
            taskId: "task-1",
            title: "削除対象ノード",
            memo: "削除ボタンの配置確認",
            cwd: "/repo/focusmap",
            status: "todo",
          }}
          candidates={["/repo/focusmap"]}
          onClose={onClose}
          onPersistDir={vi.fn()}
          onDelete={onDelete}
        />,
      )

      const imageSection = await screen.findByTestId("codex-node-image-section")
      const deleteButton = within(imageSection).getByRole("button", { name: "ノードを削除" })

      expect(deleteButton).toHaveClass("text-xs")

      fireEvent.click(deleteButton)

      expect(confirmSpy).toHaveBeenCalledWith("「削除対象ノード」を削除しますか？\nこの操作は取り消せません。")
      expect(onDelete).toHaveBeenCalledWith("task-1")
      expect(onClose).toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
})
	})
