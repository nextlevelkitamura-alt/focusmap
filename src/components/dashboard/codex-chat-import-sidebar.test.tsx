import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

beforeEach(() => {
  vi.clearAllMocks()
  runnerStatusMock.ready = false
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as Window & { focusmapDesktop?: unknown }).focusmapDesktop
})

describe("CodexChatImportSidebar", () => {
  test("renders chat import wording, repo monitor switch, selected repo, and unplaced chats", () => {
    renderSidebar()

    expect(screen.getByRole("complementary", { name: "チャット取り込み" })).toBeInTheDocument()
    expect(screen.getByLabelText("リポ監視")).toBeChecked()
    expect(buttonContainingText("既存リポ選択")).toBeInTheDocument()
    expect(screen.queryByLabelText("対象リポを選択 focusmap")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("プロジェクトのリポフォルダ")).not.toBeInTheDocument()
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

  test("selects a repo from Focusmap agent repo candidates", async () => {
    const { onSelectRepoPath } = renderSidebar()

    fireEvent.click(buttonContainingText("既存リポ選択"))
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
    expect(screen.queryByRole("button", { name: /既存リポ選択/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Finderでリポフォルダを選択" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("チャットを検索")).not.toBeInTheDocument()
    expect(screen.queryByText("AIチャット履歴")).not.toBeInTheDocument()
    expect(screen.getByText("確認待ち")).toBeInTheDocument()
    expect(screen.getByText("focusmap")).toBeInTheDocument()
    expect(screen.getAllByText("5分前").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("3時間前")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "AI要約" })).toBeInTheDocument()
    expect(screen.getByText("AI要約")).toBeInTheDocument()
    expect(screen.getByText("実行したこと")).toBeInTheDocument()
    expect(screen.getByText("現状")).toBeInTheDocument()
    expect(screen.getByText("確認すること")).toBeInTheDocument()
    const doneText = screen.getByText("一覧生成は未配置だけに変え、配置処理では保存反映前から対象カードを隠し、失敗時だけ戻すようにしました")
    expect(doneText).toBeInTheDocument()
    expect(doneText.textContent).not.toContain("…")
    expect(doneText.closest("section")?.className).toContain("border-t")
    expect(screen.getByText("ノード化の要否")).toBeInTheDocument()
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
      if (url === "/api/ai-tasks/ai-task-1/activity?limit=30") {
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
      expect(screen.getByText("最初の古い履歴も取得します")).toBeInTheDocument()
    })
    expect(screen.getByText("最新ページの履歴です")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("before_id=progress-100"),
      { cache: "no-store" },
    )
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

  test("saves visible Codex activity in the background when Mac is online", async () => {
    runnerStatusMock.ready = true
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-1" })
      if (url.startsWith("/api/ai-tasks/ai-task-1/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-status-newer",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "status",
              kind: "progress",
              body: "Codex セッションは確認待ちです",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(1),
            },
            {
              id: "msg-codex-latest",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "一覧の時刻を最新メッセージに寄せます",
              importance: "normal",
              metadata: {},
              created_at: minutesAgo(5),
            },
          ],
        })
      }
      return jsonResponse({}, false)
    })
    vi.stubGlobal("fetch", fetchMock)

    renderSidebar()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/codex/sync-node", expect.objectContaining({ method: "POST" }))
    })
    const syncCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/codex/sync-node")
    expect(JSON.parse(String(syncCall?.[1]?.body))).toEqual({
      ai_task_id: "ai-task-1",
      include_visible_activity: true,
    })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/ai-tasks/ai-task-1/activity?limit=30"),
        { cache: "no-store" },
      )
      expect(screen.getByText("5分前")).toBeInTheDocument()
    })
    expect(screen.queryByText("3時間前")).not.toBeInTheDocument()
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
    await screen.findByText("配置するチャット")
    expect(screen.queryByRole("button", { name: "閉じる" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "ノードへ配置" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "履歴へ戻す" })).not.toBeInTheDocument()
  })

  test("selects a repo folder picked from Finder immediately", async () => {
    const { onSelectRepoPath } = renderSidebar()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/Users/me/new-repo/" }),
    }))

    fireEvent.click(screen.getByRole("button", { name: "Finderでリポフォルダを選択" }))

    await waitFor(() => {
      expect(onSelectRepoPath).toHaveBeenCalledWith("/Users/me/new-repo")
    })
  })

  test("uses the Focusmap Mac app folder picker before falling back to the server API", async () => {
    const { onSelectRepoPath } = renderSidebar()
    const chooseFolder = vi.fn().mockResolvedValue({
      ok: true,
      path: "/Users/me/mac-picked-repo/",
    })
    Object.defineProperty(window, "focusmapDesktop", {
      configurable: true,
      value: { chooseFolder },
    })
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    fireEvent.click(screen.getByRole("button", { name: "Finderでリポフォルダを選択" }))

    await waitFor(() => {
      expect(onSelectRepoPath).toHaveBeenCalledWith("/Users/me/mac-picked-repo")
    })
    expect(chooseFolder).toHaveBeenCalledTimes(1)
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
