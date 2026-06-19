import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CODEX_CHAT_IMPORT_DRAG_TYPE, readCodexChatImportDragPayload } from "@/lib/codex-chat-import-dnd"
import { CodexChatImportSidebar, type CodexChatImportItem } from "./codex-chat-import-sidebar"

const refreshRepos = vi.fn()
const requestRescan = vi.fn()
const runnerStatusMock = vi.hoisted(() => ({ ready: false }))

vi.mock("@/hooks/useAvailableRepos", () => ({
  useAvailableRepos: () => ({
    repos: [
      {
        id: "repo-1",
        hostname: "mac",
        absolute_path: "/Users/me/focusmap",
        display_name: "focusmap",
        last_git_commit_at: null,
        last_seen_at: "2026-06-11T00:00:00.000Z",
        source: "codex",
      },
    ],
    isLoading: false,
    error: null,
    refresh: refreshRepos,
    requestRescan,
  }),
}))

vi.mock("@/hooks/useCodexRunnerStatus", () => ({
  useCodexRunnerStatus: () => ({
    ready: runnerStatusMock.ready,
    loading: false,
    checked: true,
    metadata: {
      codex_thread_import: {
        state_db_found: true,
        last_scope_refresh_at: "2026-06-17T00:00:00.000Z",
        last_reconcile_at: "2026-06-17T00:00:00.000Z",
        last_reconcile_imported: 0,
        scopes: [
          {
            project_id: "project-1",
            repo_path: "/Users/me/focusmap",
            enabled_since: "2026-06-11T00:00:00.000Z",
            cwd_paths: ["/Users/me/focusmap", "/Users/me/focusmap-worktree"],
          },
        ],
      },
    },
  }),
}))

const chatItems: CodexChatImportItem[] = [
  {
    id: "chat-node-1",
    aiTaskId: "ai-task-1",
    title: "Codexスレッド連携UI",
    snippet: "右側サイドバーにチャット一覧を表示する",
    repoPath: "/Users/me/focusmap",
    threadId: "thread-abcdef123456",
    status: "awaiting_approval",
    projectTitle: "仕事",
    placementLabel: "未配置",
    statusLabel: "確認待ち",
    updatedLabel: "3時間前",
    placed: false,
  },
]

function jsonResponse(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  }
}

function minutesAgo(minutes: number) {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

function renderSidebar(options: {
  chatItems?: CodexChatImportItem[]
  detailItems?: CodexChatImportItem[]
  initialSelectedChatId?: string | null
  onInitialSelectedChatClear?: ReturnType<typeof vi.fn>
  onPlaceChatItem?: ReturnType<typeof vi.fn>
  onReturnPlacedChatItem?: ReturnType<typeof vi.fn>
  onChatDragStateChange?: ReturnType<typeof vi.fn>
} = {}) {
  const onSelectRepoPath = vi.fn().mockResolvedValue(undefined)
  const onToggleImport = vi.fn().mockResolvedValue(undefined)
  const onDeleteChatItem = vi.fn().mockResolvedValue(undefined)
  const onPlaceChatItem = options.onPlaceChatItem ?? vi.fn().mockResolvedValue(undefined)
  const onReturnPlacedChatItem = options.onReturnPlacedChatItem ?? vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()

  const view = render(
    <CodexChatImportSidebar
      projectTitle="仕事"
      selectedRepoPath="/Users/me/focusmap"
      importEnabled
      importOwnerLabel="仕事"
      chatItems={options.chatItems ?? chatItems}
      detailItems={options.detailItems}
      initialSelectedChatId={options.initialSelectedChatId}
      onInitialSelectedChatClear={options.onInitialSelectedChatClear}
      onClose={onClose}
      onSelectRepoPath={onSelectRepoPath}
      onToggleImport={onToggleImport}
      onDeleteChatItem={onDeleteChatItem}
      onPlaceChatItem={onPlaceChatItem}
      onReturnPlacedChatItem={onReturnPlacedChatItem}
      onChatDragStateChange={options.onChatDragStateChange}
    />,
  )

  const rerenderSidebar = (nextOptions: Partial<typeof options> = {}) => {
    view.rerender(
      <CodexChatImportSidebar
        projectTitle="仕事"
        selectedRepoPath="/Users/me/focusmap"
        importEnabled
        importOwnerLabel="仕事"
        chatItems={nextOptions.chatItems ?? options.chatItems ?? chatItems}
        detailItems={nextOptions.detailItems ?? options.detailItems}
        initialSelectedChatId={nextOptions.initialSelectedChatId ?? options.initialSelectedChatId}
        onInitialSelectedChatClear={nextOptions.onInitialSelectedChatClear ?? options.onInitialSelectedChatClear}
        onClose={onClose}
        onSelectRepoPath={onSelectRepoPath}
        onToggleImport={onToggleImport}
        onDeleteChatItem={onDeleteChatItem}
        onPlaceChatItem={onPlaceChatItem}
        onReturnPlacedChatItem={onReturnPlacedChatItem}
        onChatDragStateChange={nextOptions.onChatDragStateChange ?? options.onChatDragStateChange}
      />,
    )
  }

  return { ...view, rerenderSidebar, onSelectRepoPath, onToggleImport, onDeleteChatItem, onPlaceChatItem, onReturnPlacedChatItem, onClose }
}

function buttonContainingText(text: string | RegExp) {
  const button = screen.getByText(text).closest("button")
  if (!button) throw new Error(`button not found for text: ${String(text)}`)
  return button
}

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}

function chatMessageText(text: string) {
  const element = screen.getAllByText(text).find(candidate => candidate.className.includes("text-[15px]"))
  if (!element) throw new Error(`chat message not found for text: ${text}`)
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
  runnerStatusMock.ready = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  window.sessionStorage.clear()
  delete (window as Window & { focusmapDesktop?: unknown }).focusmapDesktop
})

describe("CodexChatImportSidebar", () => {
  test("renders chat import wording, repo monitor switch, selected repo, and unplaced chats", () => {
    runnerStatusMock.ready = true
    renderSidebar()

    expect(screen.getByRole("complementary", { name: "チャット取り込み" })).toBeInTheDocument()
    expect(screen.getByLabelText("リポ監視")).toBeChecked()
    expect(buttonContainingText("Codexプロジェクトから選択")).toBeInTheDocument()
    expect(screen.getByText("選択中")).toBeInTheDocument()
    expect(screen.getByText("Codexプロジェクト")).toBeInTheDocument()
    expect(screen.getByText("agent反映済み")).toBeInTheDocument()
    expect(screen.queryByLabelText("対象リポを選択 focusmap")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("プロジェクトのリポフォルダ")).not.toBeInTheDocument()
    expect(screen.getByText("未配置 1件")).toBeInTheDocument()
    const row = screen.getByTestId("codex-chat-import-row-chat-node-1")
    expect(within(row).getByText("Codexスレッド連携UI")).toBeInTheDocument()
    expect(within(row).queryByText("未配置")).not.toBeInTheDocument()
    expect(screen.queryByText(/thread-abcdef123456/)).not.toBeInTheDocument()
    expect(within(row).getByText("focusmap")).toBeInTheDocument()
    expect(within(row).queryByText("仕事")).not.toBeInTheDocument()
    expect(within(row).getByRole("link", { name: /Codexで開く Codexスレッド連携UI/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    expect(screen.getByRole("button", { name: "チャットを削除 Codexスレッド連携UI" })).toBeVisible()
    expect(screen.getByRole("button", { name: "AI実行を閉じる" })).toBeInTheDocument()
    expect(screen.queryByText("閉じる")).not.toBeInTheDocument()
  })

  test("keeps visible counts for unplaced and searched chats", () => {
    renderSidebar({
      chatItems: [
        chatItems[0],
        {
          ...chatItems[0],
          id: "chat-node-2",
          aiTaskId: "ai-task-2",
          title: "AI要約の横幅を拡張",
          snippet: "要約カードを読みやすくする",
          threadId: "thread-ai-summary",
          updatedLabel: "7分前",
        },
      ],
    })

    expect(screen.getByText("未配置 2件")).toBeInTheDocument()
    expect(screen.queryByText("表示 1件")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("チャットを検索"), { target: { value: "横幅" } })

    expect(screen.getByText("未配置 2件")).toBeInTheDocument()
    expect(screen.getByText("表示 1件")).toBeInTheDocument()
    expect(screen.getByText("AI要約の横幅を拡張")).toBeInTheDocument()
    expect(screen.queryByText("Codexスレッド連携UI")).not.toBeInTheDocument()
  })

  test("renders running chats as compact green history cards with a fallback status pill", () => {
    renderSidebar({
      chatItems: [
        {
          ...chatItems[0],
          id: "chat-running",
          title: "AI要約の横幅を拡張",
          status: "running",
          statusLabel: null,
          placementLabel: "配置済み: アプリの修正",
          placed: true,
          updatedLabel: "7分",
        },
      ],
    })

    const row = screen.getByTestId("codex-chat-import-row-chat-running")
    expect(row.className).toContain("rounded-lg")
    expect(row.className).toContain("py-2")
    expect(row.className).toContain("border-emerald-400/75")
    expect(within(row).getByLabelText("Codex 実行中")).toHaveClass("codex-monitor-running-orbit")
    expect(within(row).getByText("実行中")).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: /Codexで開く AI要約の横幅を拡張/ }).className).toContain("min-h-8")
  })

  test("renders completed work time from one-rally timing on the history card", () => {
    renderSidebar({
      chatItems: [
        {
          ...chatItems[0],
          workStartedAt: "2026-06-18T00:00:00.000Z",
          workAwaitingApprovalAt: "2026-06-18T00:00:27.000Z",
          workCompletedAt: "2026-06-18T00:00:27.000Z",
        },
      ],
    })

    const row = screen.getByTestId("codex-chat-import-row-chat-node-1")
    expect(within(row).getByText("作業時間 27s")).toBeInTheDocument()
  })

  test("shows finished age next to the confirmation status in the detail header", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-finished-age" })
      if (url.startsWith("/api/ai-tasks/ai-task-finished-age/activity")) {
        return jsonResponse({ messages: [] })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar({
      chatItems: [
        {
          ...chatItems[0],
          id: "chat-finished-age",
          aiTaskId: "ai-task-finished-age",
          status: "awaiting_approval",
          statusLabel: "返信待ち",
          updatedLabel: "3時間前",
          workStartedAt: minutesAgo(2),
          workAwaitingApprovalAt: minutesAgo(0.5),
          workCompletedAt: minutesAgo(0.5),
        },
      ],
    })

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-finished-age"))

    await waitFor(() => {
      expect(screen.getByLabelText("確認待ち 1分前")).toBeInTheDocument()
    })
    expect(screen.getByText("focusmap")).toBeInTheDocument()
    expect(screen.queryByText("3時間前")).not.toBeInTheDocument()
    expect(screen.getByText("作業時間 1m 30s")).toBeInTheDocument()
  })

  test("keeps running and completed work time from local status transitions when server timing is missing", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-19T00:00:00.000Z"))
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-local-timer" })
      if (url.startsWith("/api/ai-tasks/ai-task-local-timer/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-current-user",
              task_id: "ai-task-local-timer",
              user_id: "user-1",
              role: "user",
              kind: "sent",
              body: "ローカルで時間を測る",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-19T00:00:00.000Z",
            },
          ],
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    const runningItem = {
      ...chatItems[0],
      id: "chat-local-timer",
      aiTaskId: "ai-task-local-timer",
      status: "running",
      statusLabel: "実行中",
      snippet: "ローカルで時間を測る",
      workStartedAt: null,
      workAwaitingApprovalAt: null,
      workCompletedAt: null,
    }
    const { rerenderSidebar } = renderSidebar({
      chatItems: [runningItem],
    })

    await act(async () => {
      await Promise.resolve()
    })

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-local-timer"))

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText("実行中 0s")).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(17_000)
      await Promise.resolve()
    })
    expect(screen.getByLabelText("実行中 17s")).toBeInTheDocument()

    rerenderSidebar({
      chatItems: [{
        ...runningItem,
        status: "awaiting_approval",
        statusLabel: "返信待ち",
      }],
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.getByLabelText("確認待ち 1分前")).toBeInTheDocument()
    expect(screen.getByText("作業時間 17s")).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })

    expect(screen.getByText("作業時間 17s")).toBeInTheDocument()
  })

  test("marks a chat card as grabbed and writes the drag payload", () => {
    const onChatDragStateChange = vi.fn()
    renderSidebar({ onChatDragStateChange })

    const row = screen.getByTestId("codex-chat-import-row-chat-node-1")
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: "copy",
      setData: vi.fn((type: string, value: string) => {
        dragData.set(type, value)
      }),
      getData: vi.fn((type: string) => dragData.get(type) ?? ""),
      setDragImage: vi.fn(),
    }

    fireEvent.dragStart(row, { dataTransfer })

    expect(row).toHaveAttribute("aria-grabbed", "true")
    expect(onChatDragStateChange).toHaveBeenCalledWith({
      itemId: "chat-node-1",
      title: "Codexスレッド連携UI",
    })
    expect(readCodexChatImportDragPayload(dataTransfer as unknown as DataTransfer)).toEqual({
      taskId: "chat-node-1",
      title: "Codexスレッド連携UI",
      snippet: "右側サイドバーにチャット一覧を表示する",
    })

    fireEvent.dragEnd(row, { dataTransfer })
    expect(onChatDragStateChange).toHaveBeenLastCalledWith(null)
  })

  test("clears drag state when the dragged chat is hidden after placement", async () => {
    const onChatDragStateChange = vi.fn()
    const { rerenderSidebar } = renderSidebar({ onChatDragStateChange })

    const row = screen.getByTestId("codex-chat-import-row-chat-node-1")
    const dragData = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: "copy",
      setData: vi.fn((type: string, value: string) => {
        dragData.set(type, value)
      }),
      getData: vi.fn((type: string) => dragData.get(type) ?? ""),
      setDragImage: vi.fn(),
    }

    fireEvent.dragStart(row, { dataTransfer })

    expect(screen.getByText("マップ外で離すとカードに戻ります")).toBeInTheDocument()

    rerenderSidebar({ chatItems: [] })

    await waitFor(() => {
      expect(onChatDragStateChange).toHaveBeenLastCalledWith(null)
    })
    expect(screen.getByText("ドラッグしてノードへ配置")).toBeInTheDocument()
  })

  test("selects a repo from Codex project candidates", async () => {
    const { onSelectRepoPath } = renderSidebar()

    fireEvent.click(buttonContainingText("Codexプロジェクトから選択"))
    fireEvent.click(screen.getByLabelText("対象リポを選択 focusmap"))

    await waitFor(() => {
      expect(onSelectRepoPath).toHaveBeenCalledWith("/Users/me/focusmap")
    })
  })

  test("opens the selected chat as a sidebar detail view and reads saved activity", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") {
        expect(JSON.parse(String(init?.body))).toEqual({
          ai_task_id: "ai-task-1",
          include_visible_activity: true,
        })
        return jsonResponse({ success: true, task_id: "ai-task-1" })
      }
      if (url.startsWith("/api/ai-tasks/ai-task-1/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-user",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "user",
              kind: "sent",
              body: "右側サイドバーにチャット一覧を表示する",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(9),
            },
            {
              id: "msg-status",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "status",
              kind: "progress",
              body: "プロジェクト更新完了",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(1),
            },
            {
              id: "msg-internal-running",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "Codexが実行を開始しました",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(8),
            },
            {
              id: "msg-internal-stopped",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "Codex thread が見つからないため監視を停止しました。",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(7),
            },
            {
              id: "msg-codex-long",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "一覧生成は未配置だけに変え、配置処理では保存反映前から対象カードを隠し、失敗時だけ戻すようにしました",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(6),
            },
            {
              id: "msg-codex",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "DBに保存してから表示します",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(5),
            },
          ],
        })
      }
      return jsonResponse({ success: false, error: { message: `unexpected fetch ${url}` } }, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar()

    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))

    await waitFor(() => {
      expect(screen.getAllByText("DBに保存してから表示します").length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.queryByRole("button", { name: "戻る" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "一覧へ戻る" }).className).toContain("hover:bg-white")
    expect(screen.queryByRole("switch", { name: "リポ監視" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Codexプロジェクトから選択/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "選択中リポをFinderで開く" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("チャットを検索")).not.toBeInTheDocument()
    expect(screen.queryByText("AIチャット履歴")).not.toBeInTheDocument()
    expect(screen.getByText("確認待ち")).toBeInTheDocument()
    expect(screen.getByText("focusmap")).toBeInTheDocument()
    expect(screen.queryByText("3時間前")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "AI要約" })).toBeInTheDocument()
    expect(screen.getByText("AI要約")).toBeInTheDocument()
    expect(screen.getByText("実行したこと")).toBeInTheDocument()
    expect(screen.getByText("現状")).toBeInTheDocument()
    expect(screen.getByText("確認すること")).toBeInTheDocument()
    const summaryRegion = screen.getByRole("region", { name: "AI要約" })
    const doneText = within(summaryRegion).getAllByText("DBに保存してから表示します")[0]
    expect(doneText).toBeInTheDocument()
    expect(doneText.textContent).not.toContain("…")
    expect(doneText.closest("section")?.className).toContain("border-t")
    expect(screen.getByText("確認待ちの内容を確認")).toBeInTheDocument()
    expect(screen.getAllByText("DBに保存してから表示します").length).toBeGreaterThanOrEqual(2)
    fireEvent.click(screen.getByRole("button", { name: "AI要約を折りたたむ" }))
    expect(screen.queryByText("実行したこと")).not.toBeInTheDocument()
    expect(screen.queryByText("現状")).not.toBeInTheDocument()
    expect(screen.queryByText("ノード化の要否")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "AI要約を展開" }))
    expect(screen.getByText("実行したこと")).toBeInTheDocument()
    expect(screen.getByText("現状")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AI要約を折りたたむ" })).toBeInTheDocument()
    expect(screen.getAllByText("DBに保存してから表示します").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("送信内容")).not.toBeInTheDocument()
    expect(screen.queryByText("Codexの返答")).not.toBeInTheDocument()
    expect(screen.queryByText("プロジェクト更新完了")).not.toBeInTheDocument()
    expect(screen.queryByText("Codexが実行を開始しました")).not.toBeInTheDocument()
    expect(screen.queryByText("Codex thread が見つからないため監視を停止しました。")).not.toBeInTheDocument()
    expect(screen.getByText("全文や細かい操作は各エディター画面から確認できます。")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /各エディター画面で履歴を開く Codexスレッド連携UI/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    expect(screen.queryByText(/thread-abcdef123456/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Codexで開く Codexスレッド連携UI/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    expect(screen.getAllByText("右側サイドバーにチャット一覧を表示する").some(element => element.className.includes("bg-white"))).toBe(true)

    expect(fetchMock).toHaveBeenCalledWith("/api/codex/sync-node", expect.objectContaining({ method: "POST" }))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/ai-tasks/ai-task-1/activity?limit=30"),
      { cache: "no-store" },
    )

    fireEvent.click(screen.getByRole("button", { name: "一覧へ戻る" }))
    expect(screen.getByLabelText("チャットを検索")).toBeInTheDocument()
  })

  test("renders the latest running prompt without a duplicate inline working indicator", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-running" })
      if (url.startsWith("/api/ai-tasks/ai-task-running/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-current-user",
              task_id: "ai-task-running",
              user_id: "user-1",
              role: "user",
              kind: "user_answer",
              body: "横の矢印いらない",
              importance: "important",
              metadata: {},
              created_at: minutesAgo(1),
            },
            {
              id: "msg-current-progress",
              task_id: "ai-task-running",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "Codexが内容を検討中",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(0.5),
            },
          ],
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar({
      chatItems: [{
        ...chatItems[0],
        id: "chat-running-prompt",
        aiTaskId: "ai-task-running",
        status: "running",
        statusLabel: "実行中",
        snippet: "横の矢印いらない",
        workStartedAt: minutesAgo(1),
      }],
    })

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-running-prompt"))

    await waitFor(() => {
      expect(chatMessageText("横の矢印いらない")).toBeInTheDocument()
    })
    const prompt = chatMessageText("横の矢印いらない")
    const progress = chatMessageText("Codexが内容を検討中")
    expectBefore(prompt, progress)
    expect(screen.queryByLabelText(/作業中/)).not.toBeInTheDocument()
  })

  test("shows a temporary current prompt without a duplicate inline working indicator when activity has not caught up", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-running" })
      if (url.startsWith("/api/ai-tasks/ai-task-running/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-old-user",
              task_id: "ai-task-running",
              user_id: "user-1",
              role: "user",
              kind: "sent",
              body: "前回の依頼",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(20),
            },
            {
              id: "msg-old-completed",
              task_id: "ai-task-running",
              user_id: "user-1",
              role: "codex",
              kind: "completed",
              body: "前回の作業を完了しました",
              importance: "important",
              metadata: {
                turn_started_at: minutesAgo(19),
                turn_completed_at: minutesAgo(18),
                work_elapsed_ms: 60_000,
              },
              created_at: minutesAgo(18),
            },
          ],
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar({
      chatItems: [{
        ...chatItems[0],
        id: "chat-running-fallback",
        aiTaskId: "ai-task-running",
        status: "running",
        statusLabel: "実行中",
        snippet: "横の矢印いらない",
        workStartedAt: minutesAgo(1),
      }],
    })

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-running-fallback"))

    await waitFor(() => {
      expect(chatMessageText("前回の作業を完了しました")).toBeInTheDocument()
    })
    const previousReport = chatMessageText("前回の作業を完了しました")
    const prompt = chatMessageText("横の矢印いらない")
    expectBefore(previousReport, prompt)
    expect(screen.queryByLabelText(/作業中/)).not.toBeInTheDocument()
  })

  test("loads older Codex activity pages when the detail view has a cursor", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-1" })
      if (url.includes("before_created_at=")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-older",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "最初の古い履歴も取得します",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-12T00:00:00.000Z",
            },
          ],
          has_more: false,
          next_cursor: null,
        })
      }
      if (url.startsWith("/api/ai-tasks/ai-task-1/activity?limit=30")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-newer",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "最新ページの履歴です",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-12T00:10:00.000Z",
            },
          ],
          has_more: true,
          next_cursor: { created_at: "2026-06-12T00:05:00.000Z", id: "progress-100" },
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("before_id=progress-100"),
        { cache: "no-store" },
      )
    })
    expect(screen.getAllByText("最新ページの履歴です").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("最初の古い履歴も取得します")).not.toBeInTheDocument()
  })

  test("opens a placed chat detail selected by the parent without adding it to the import list", async () => {
    const placedChat: CodexChatImportItem = {
      ...chatItems[0],
      id: "placed-chat-node",
      aiTaskId: "ai-task-placed",
      title: "配置済みCodex作業",
      placementLabel: "配置済み: プロジェクト直下",
      placed: true,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") {
        expect(JSON.parse(String(init?.body))).toEqual({
          ai_task_id: "ai-task-placed",
          include_visible_activity: true,
        })
        return jsonResponse({ success: true, task_id: "ai-task-placed" })
      }
      if (url.startsWith("/api/ai-tasks/ai-task-placed/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-placed",
              task_id: "ai-task-placed",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "配置済みノードの履歴を表示します",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-12T00:10:00.000Z",
            },
          ],
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)

    renderSidebar({
      detailItems: [placedChat],
      initialSelectedChatId: "placed-chat-node",
    })

    await waitFor(() => {
      expect(screen.getAllByText("配置済みノードの履歴を表示します").length).toBeGreaterThan(0)
    })
    expect(screen.getAllByText("配置済みCodex作業").length).toBeGreaterThan(0)
    expect(screen.getByText("配置済み: プロジェクト直下")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ノードへ配置" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "履歴へ戻す" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "一覧へ戻る" }))
    expect(screen.getByLabelText("チャットを検索")).toBeInTheDocument()
    expect(screen.queryByText("配置済みCodex作業")).not.toBeInTheDocument()
  })

  test("keeps list labels stable instead of background-syncing visible activity", () => {
    runnerStatusMock.ready = true
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    renderSidebar()

    expect(screen.getByText("3時間前")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does not render detail footer actions in the selected chat view", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-1" })
      if (url.startsWith("/api/ai-tasks/ai-task-1/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-user",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "user",
              kind: "sent",
              body: "配置するチャット",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-12T00:00:00.000Z",
            },
          ],
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))
    expect((await screen.findAllByText("配置するチャット")).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole("button", { name: "閉じる" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ノードへ配置" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "履歴へ戻す" })).not.toBeInTheDocument()
  })

  test("opens the selected repo in Finder through the Mac app bridge", async () => {
    const { onSelectRepoPath } = renderSidebar()
    const openPath = vi.fn().mockResolvedValue({ ok: true })
    Object.defineProperty(window, "focusmapDesktop", {
      configurable: true,
      value: { openPath },
    })

    fireEvent.click(screen.getByRole("button", { name: "選択中リポをFinderで開く" }))

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith("/Users/me/focusmap")
    })
    expect(onSelectRepoPath).not.toHaveBeenCalled()
  })

  test("does not fall back to arbitrary folder selection when Finder bridge is unavailable", async () => {
    const { onSelectRepoPath } = renderSidebar()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fireEvent.click(screen.getByRole("button", { name: "選択中リポをFinderで開く" }))

    expect(await screen.findByText(/Finder表示はMacアプリ更新後/)).toBeInTheDocument()
    expect(onSelectRepoPath).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("exposes a drag payload for a chat row", () => {
    renderSidebar()
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: "copy",
      setData: vi.fn((type: string, value: string) => data.set(type, value)),
    }

    fireEvent.dragStart(screen.getByTestId("codex-chat-import-row-chat-node-1"), { dataTransfer })

    expect(dataTransfer.setData).toHaveBeenCalledWith(CODEX_CHAT_IMPORT_DRAG_TYPE, expect.any(String))
    expect(JSON.parse(data.get(CODEX_CHAT_IMPORT_DRAG_TYPE) ?? "{}")).toEqual({
      taskId: "chat-node-1",
      title: "Codexスレッド連携UI",
      snippet: "右側サイドバーにチャット一覧を表示する",
    })
  })

  test("deletes a chat row from the repo inbox", async () => {
    const { onDeleteChatItem } = renderSidebar()

    fireEvent.click(screen.getByRole("button", { name: "チャットを削除 Codexスレッド連携UI" }))

    await waitFor(() => {
      expect(onDeleteChatItem).toHaveBeenCalledWith("chat-node-1")
    })
  })

  test("opens the exact Codex thread through the Focusmap Mac bridge", async () => {
    const openExternal = vi.fn().mockResolvedValue(true)
    Object.defineProperty(window, "focusmapDesktop", {
      configurable: true,
      value: { openExternal },
    })
    renderSidebar()

    fireEvent.click(screen.getByRole("link", { name: /Codexで開く Codexスレッド連携UI/ }))

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith("codex://threads/thread-abcdef123456")
    })
  })
})
