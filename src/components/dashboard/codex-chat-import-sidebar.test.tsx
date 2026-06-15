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
  onChatDragStateChange?: ReturnType<typeof vi.fn>
} = {}) {
  const onSelectRepoPath = vi.fn().mockResolvedValue(undefined)
  const onToggleImport = vi.fn().mockResolvedValue(undefined)
  const onDeleteChatItem = vi.fn().mockResolvedValue(undefined)
  const onPlaceChatItem = options.onPlaceChatItem ?? vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()

  render(
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
      onChatDragStateChange={options.onChatDragStateChange}
    />,
  )

  return { onSelectRepoPath, onToggleImport, onDeleteChatItem, onPlaceChatItem, onClose }
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
    expect(screen.getByRole("switch", { name: "リポ監視" })).toBeChecked()
    expect(screen.getByRole("button", { name: /既存リポ選択/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "対象リポを選択 focusmap" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText("プロジェクトのリポフォルダ")).not.toBeInTheDocument()
    expect(screen.getByText("Codexスレッド連携UI")).toBeInTheDocument()
    expect(screen.getByText("未配置")).toBeInTheDocument()
    expect(screen.queryByText(/thread-abcdef123456/)).not.toBeInTheDocument()
    const row = screen.getByTestId("codex-chat-import-row-chat-node-1")
    expect(within(row).getByText("focusmap")).toBeInTheDocument()
    expect(within(row).queryByText("仕事")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Codexで開く Codexスレッド連携UI/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    expect(screen.getByRole("button", { name: "チャットを削除 Codexスレッド連携UI" })).toBeVisible()
    expect(screen.getByRole("button", { name: "閉じる" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "チャット取り込みを閉じる" })).not.toBeInTheDocument()
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

  test("selects a repo from Focusmap agent repo candidates", async () => {
    const { onSelectRepoPath } = renderSidebar()

    fireEvent.click(screen.getByRole("button", { name: /既存リポ選択/ }))
    fireEvent.click(screen.getByRole("button", { name: "対象リポを選択 focusmap" }))

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
      if (url === "/api/ai-tasks/ai-task-1/activity") {
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
    expect(screen.getByRole("button", { name: "戻る" }).className).toContain("hover:bg-white/10")
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
    expect(screen.getByText("やったこと")).toBeInTheDocument()
    expect(screen.getByText("変更・判断")).toBeInTheDocument()
    expect(screen.getByText("次に見ること")).toBeInTheDocument()
    expect(screen.getAllByText("DBに保存してから表示します").length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText("送信内容")).not.toBeInTheDocument()
    expect(screen.getByText("Codexの返答")).toBeInTheDocument()
    expect(screen.queryByText("プロジェクト更新完了")).not.toBeInTheDocument()
    expect(screen.queryByText(/thread-abcdef123456/)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Codexで開く Codexスレッド連携UI/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    expect(screen.getAllByText("右側サイドバーにチャット一覧を表示する").some(element => element.className.includes("bg-white"))).toBe(true)

    expect(fetchMock).toHaveBeenCalledWith("/api/codex/sync-node", expect.objectContaining({ method: "POST" }))
    expect(fetchMock).toHaveBeenCalledWith("/api/ai-tasks/ai-task-1/activity", { cache: "no-store" })

    fireEvent.click(screen.getByRole("button", { name: "戻る" }))
    expect(screen.getByLabelText("チャットを検索")).toBeInTheDocument()
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
      if (url === "/api/ai-tasks/ai-task-placed/activity") {
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
    expect(screen.getByText("配置済みのチャット履歴")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "戻る" }))
    expect(screen.getByLabelText("チャットを検索")).toBeInTheDocument()
    expect(screen.queryByText("配置済みCodex作業")).not.toBeInTheDocument()
  })

  test("saves visible Codex activity in the background when Mac is online", async () => {
    runnerStatusMock.ready = true
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-1" })
      if (url === "/api/ai-tasks/ai-task-1/activity") {
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
      expect(fetchMock).toHaveBeenCalledWith("/api/ai-tasks/ai-task-1/activity", { cache: "no-store" })
      expect(screen.getByText("5分前")).toBeInTheDocument()
    })
    expect(screen.queryByText("3時間前")).not.toBeInTheDocument()
  })

  test("places the selected chat from the detail footer", async () => {
    const onPlaceChatItem = vi.fn().mockResolvedValue(undefined)
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/codex/sync-node") return jsonResponse({ success: true, task_id: "ai-task-1" })
      if (url === "/api/ai-tasks/ai-task-1/activity") {
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
    renderSidebar({ onPlaceChatItem })

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))
    await screen.findByRole("button", { name: "ノードへ配置" })
    fireEvent.click(screen.getByRole("button", { name: "ノードへ配置" }))

    await waitFor(() => {
      expect(onPlaceChatItem).toHaveBeenCalledWith("chat-node-1")
    })
    expect(screen.getByLabelText("チャットを検索")).toBeInTheDocument()
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
