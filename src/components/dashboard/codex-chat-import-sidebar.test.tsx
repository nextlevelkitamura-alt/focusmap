import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CodexChatImportSidebar, type CodexChatImportItem } from "./codex-chat-import-sidebar"
import type { AiHistoryListItem, AiHistoryPlacement, AiHistoryProvider, AiHistoryRepoFilter, AiHistoryScopeFilter } from "@/types/ai-history"

const useAiHistoryMock = vi.hoisted(() => vi.fn())
const useAvailableReposMock = vi.hoisted(() => vi.fn())
const fetchWithSupabaseAuthMock = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/useAiHistory", () => ({
  useAiHistory: useAiHistoryMock,
}))

vi.mock("@/hooks/useAvailableRepos", () => ({
  useAvailableRepos: useAvailableReposMock,
}))

vi.mock("@/lib/auth/supabase-auth-fetch", () => ({
  fetchWithSupabaseAuth: fetchWithSupabaseAuthMock,
}))

const baseHistoryItem: AiHistoryListItem = {
  id: "history-1",
  provider: "codex_app",
  externalThreadId: "thread-abcdef123456",
  title: "AI履歴サイドバーを接続",
  snippet: "未配置とマインドマップをAPIから表示する",
  repoPath: "/Users/me/focusmap",
  repoLabel: "focusmap",
  worktreePath: null,
  placement: "unplaced",
  sourceTaskId: null,
  linkedAiTaskId: "ai-task-1",
  status: "awaiting_approval",
  runState: null,
  lastActivityAt: "2026-06-20T00:00:00.000Z",
  indexedAt: "2026-06-20T00:00:01.000Z",
  startedAt: "2026-06-19T23:59:00.000Z",
  endedAt: "2026-06-20T00:00:00.000Z",
  workDurationSeconds: 60,
  archived: false,
  deletedAt: null,
  detailHydrated: true,
  detailHydrateRequired: false,
  detailHydrateReason: null,
  detailMessageCount: 2,
  detailSyncedAt: "2026-06-20T00:00:02.000Z",
  updatedAt: "2026-06-20T00:00:02.000Z",
  codexOpenUrl: "codex://threads/thread-abcdef123456",
}

let historyItems: AiHistoryListItem[] = []
let lastHookOptions: Array<{
  projectId: string | null
  provider?: AiHistoryProvider
  repo: AiHistoryRepoFilter
  scope?: AiHistoryScopeFilter
  placement: AiHistoryPlacement
}> = []
let syncState = {
  featureEnabled: true,
  aiOnline: true,
  agentConnected: true,
}
let aiHistoryRefreshMock: ReturnType<typeof vi.fn>
let availableReposRefreshMock: ReturnType<typeof vi.fn>

function repoMatches(item: AiHistoryListItem, repo: AiHistoryRepoFilter) {
  return repo === "all" || item.repoPath === repo
}

function mockUseAiHistory() {
  useAiHistoryMock.mockImplementation((options: {
    projectId: string | null
    provider?: AiHistoryProvider
    repo: AiHistoryRepoFilter
    scope?: AiHistoryScopeFilter
    placement: AiHistoryPlacement
  }) => {
    lastHookOptions.push(options)
    const scopedItems = historyItems.filter(item => !item.archived && repoMatches(item, options.repo))
    const visibleItems = scopedItems.filter(item => item.placement === options.placement)
    return {
      items: visibleItems,
      counts: {
        unplaced: scopedItems.filter(item => item.placement === "unplaced").length,
        mindmap: scopedItems.filter(item => item.placement === "mindmap").length,
      },
      sync: {
        ...syncState,
        selectedRepo: options.repo,
        selectedScope: options.scope ?? "project",
        selectedProvider: options.provider ?? "codex_app",
        providerOptions: [
          { provider: "codex_app", label: "Codex", enabled: true, agentSeen: true },
          { provider: "claude_code", label: "Claude Code", enabled: false, agentSeen: false },
          { provider: "antigravity", label: "Antigravity", enabled: false, agentSeen: false },
        ],
        repoOptions: [
          { repoPath: "/Users/me/focusmap", label: "focusmap", enabled: true, agentSeen: true },
          { repoPath: "/Users/me/other", label: "other", enabled: true, agentSeen: true },
        ],
        lastIndexedAt: "2026-06-20T00:00:01.000Z",
        lastReconciledAt: "2026-06-20T00:00:02.000Z",
        nextReconcileAt: null,
      },
      page: { limit: 100, cursor: null },
      nextCursor: null,
      isLoading: false,
      error: null,
      refresh: aiHistoryRefreshMock,
    }
  })
}

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  }
}

function renderSidebar(options: {
  onSelectRepoPath?: (repoPath: string | null) => Promise<void> | void
  detailItems?: CodexChatImportItem[]
  initialSelectedChatId?: string | null
} = {}) {
  const onClose = vi.fn()
  const view = render(
    <CodexChatImportSidebar
      projectId="project-1"
      projectTitle="仕事"
      initialRepoPath="/Users/me/focusmap"
      detailItems={options.detailItems}
      initialSelectedChatId={options.initialSelectedChatId}
      onClose={onClose}
      onSelectRepoPath={options.onSelectRepoPath}
    />,
  )
  return { ...view, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
  lastHookOptions = []
  historyItems = [baseHistoryItem]
  syncState = {
    featureEnabled: true,
    aiOnline: true,
    agentConnected: true,
  }
  aiHistoryRefreshMock = vi.fn()
  availableReposRefreshMock = vi.fn()
  mockUseAiHistory()
  useAvailableReposMock.mockReturnValue({
    repos: [],
    isLoading: false,
    error: null,
    refresh: availableReposRefreshMock,
    requestRescan: vi.fn(),
  })
  fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === "/api/ai-history/history-1") {
      return jsonResponse({
        item: baseHistoryItem,
        detail: {
          hydrateRequired: false,
          linkedAiTaskId: "ai-task-1",
          activityUrl: "/api/ai-history/history-1/activity",
          policy: "linked_ai_task_activity",
        },
      })
    }
    if (url.startsWith("/api/ai-history/history-1/activity")) {
      return jsonResponse({
        messages: [
          {
            id: "msg-user",
            task_id: "ai-task-1",
            user_id: "user-1",
            role: "user",
            kind: "sent",
            body: "AI履歴をAPIへ接続して",
            importance: "normal",
            metadata: {},
            created_at: "2026-06-20T00:00:00.000Z",
          },
          {
            id: "msg-codex",
            task_id: "ai-task-1",
            user_id: "user-1",
            role: "codex",
            kind: "progress",
            body: "未配置とマインドマップの2分類に整理しました",
            importance: "normal",
            metadata: {},
            created_at: "2026-06-20T00:01:00.000Z",
          },
        ],
      })
    }
    return jsonResponse({}, 404)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
})

describe("CodexChatImportSidebar", () => {
  test("renders the compact AI history header and API-backed unplaced cards", () => {
    renderSidebar()

    expect(screen.getByRole("complementary", { name: "AI履歴" })).toBeInTheDocument()
    expect(screen.getByText("AI online")).toBeInTheDocument()
    expect(screen.queryByText("AI履歴")).not.toBeInTheDocument()
    const refreshButton = document.querySelector('button[aria-label="AI履歴を更新"]')
    expect(refreshButton).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AI履歴設定" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AI履歴を閉じる" })).toBeInTheDocument()
    expect(screen.getByText("未配置 1件")).toBeInTheDocument()
    expect(screen.getByText("マインドマップ")).toBeInTheDocument()
    expect(screen.queryByLabelText("リポ監視")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("チャットを検索")).not.toBeInTheDocument()
    expect(screen.queryByText("リポ監視")).not.toBeInTheDocument()

    const row = screen.getByTestId("codex-chat-import-row-history-1")
    expect(within(row).getByText("AI履歴サイドバーを接続")).toBeInTheDocument()
    expect(within(row).getByText("返信待ち")).toBeInTheDocument()
    expect(within(row).getByText("focusmap")).toBeInTheDocument()
    expect(within(row).getByRole("link", { name: /Codexで開く AI履歴サイドバーを接続/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    fireEvent.click(refreshButton!)
    expect(aiHistoryRefreshMock).toHaveBeenCalled()
    expect(availableReposRefreshMock).toHaveBeenCalled()
  }, 15_000)

  test("keeps the expanded archive action wide enough for the Japanese label", () => {
    renderSidebar()

    const row = screen.getByTestId("codex-chat-import-row-history-1")
    fireEvent.click(within(row).getByRole("button", { name: /アーカイブ操作を開く AI履歴サイドバーを接続/ }))

    const archiveButton = within(row).getByRole("button", { name: /チャットをアーカイブ AI履歴サイドバーを接続/ })
    expect(archiveButton).toHaveClass("w-[168px]")
    expect(within(archiveButton).getByText("チャットをアーカイブ")).toBeInTheDocument()
  })

  test("uses synced current-rally duration for running cards instead of old thread started_at", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-20T00:02:00.000Z"))
    historyItems = [{
      ...baseHistoryItem,
      status: "running",
      runState: "started",
      lastActivityAt: "2026-06-20T00:01:30.000Z",
      indexedAt: "2026-06-20T00:01:30.000Z",
      startedAt: "2026-06-19T23:08:00.000Z",
      endedAt: null,
      workDurationSeconds: 53,
    }]
    renderSidebar()

    const row = screen.getByTestId("codex-chat-import-row-history-1")
    expect(within(row).getByText("実行中")).toBeInTheDocument()
    expect(within(row).getByText("1m 23s")).toBeInTheDocument()
    expect(within(row).queryByText(/54m/)).not.toBeInTheDocument()
  })

  test("keeps AI history work duration when opening a placed mindmap detail item", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-20T00:02:00.000Z"))
    historyItems = [{
      ...baseHistoryItem,
      placement: "mindmap",
      sourceTaskId: "task-placed-1",
      status: "running",
      runState: "started",
      lastActivityAt: "2026-06-20T00:01:30.000Z",
      indexedAt: "2026-06-20T00:01:30.000Z",
      startedAt: "2026-06-19T23:08:00.000Z",
      endedAt: null,
      workDurationSeconds: 53,
    }]

    renderSidebar({
      initialSelectedChatId: "task-placed-1",
      detailItems: [{
        id: "task-placed-1",
        sourceTaskId: "task-placed-1",
        aiTaskId: null,
        title: "AI履歴サイドバーを接続",
        snippet: null,
        repoPath: "/Users/me/focusmap",
        threadId: "thread-abcdef123456",
        status: "running",
        projectTitle: "仕事",
        placementLabel: "配置済み: Root task",
        statusLabel: "実行中",
        updatedLabel: "たった今",
        sortAt: "2026-06-20T00:02:00.000Z",
        placed: true,
      }],
    })

    await waitFor(() => {
      expect(lastHookOptions.some(option => option.placement === "mindmap")).toBe(true)
      expect(screen.getAllByLabelText("1m 23s 作業中").length).toBeGreaterThan(0)
    })
    expect(screen.queryByLabelText("0s 作業中")).not.toBeInTheDocument()
  })

  test("shows the parent repo and distinct worktree folder", async () => {
    historyItems = [{
      ...baseHistoryItem,
      worktreePath: "/Users/me/focusmap-codex-reconcile-main",
    }]
    renderSidebar()

    const row = screen.getByTestId("codex-chat-import-row-history-1")
    expect(within(row).getByText("repo")).toBeInTheDocument()
    expect(within(row).getByText("focusmap")).toBeInTheDocument()
    expect(within(row).getByText("実行")).toBeInTheDocument()
    expect(within(row).getByText("focusmap-codex-reconcile-main")).toBeInTheDocument()

    fireEvent.click(row)

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "一覧へ戻る" })).toBeInTheDocument()
    })
    expect(screen.getAllByText("focusmap-codex-reconcile-main").length).toBeGreaterThan(0)
  })

  test("opens AI history detail with watch and then burst-polls the selected hydrate detail", async () => {
    historyItems = [{
      ...baseHistoryItem,
      linkedAiTaskId: null,
      detailHydrated: false,
      detailHydrateRequired: true,
      detailHydrateReason: "detail_cache_empty",
      detailMessageCount: 0,
      detailSyncedAt: null,
    }]
    const activityRequests: string[] = []
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/ai-history/history-1") {
        return jsonResponse({
          item: historyItems[0],
          detail: {
            hydrateRequired: true,
            hydrateReason: "detail_cache_empty",
            detailSyncedAt: null,
            messageCount: 0,
            linkedAiTaskId: null,
            activityUrl: "/api/ai-history/history-1/activity",
            policy: "ai_history_detail_cache",
          },
        })
      }
      if (url.startsWith("/api/ai-history/history-1/activity")) {
        activityRequests.push(url)
        return jsonResponse({
          messages: [],
          has_more: false,
          next_cursor: null,
          hydrate: {
            required: true,
            reason: "detail_cache_empty",
            historyItemId: "history-1",
            provider: "codex_app",
            externalThreadId: "thread-abcdef123456",
            repoPath: "/Users/me/focusmap",
            detailSyncedAt: null,
            messageCount: 0,
          },
        }, 202)
      }
      return jsonResponse({}, 404)
    })

    const { unmount } = renderSidebar()
    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(activityRequests.some(url => url.includes("watch=1"))).toBe(true)
    })
    activityRequests.length = 0

    await waitFor(() => {
      expect(activityRequests.some(url => !url.includes("watch=1"))).toBe(true)
    }, { timeout: 1_600 })

    unmount()
  })

  test("defaults to all Codex chats across repos", () => {
    historyItems = [
      baseHistoryItem,
      {
        ...baseHistoryItem,
        id: "history-other",
        externalThreadId: "thread-other",
        title: "別リポの履歴",
        repoPath: "/Users/me/other",
        repoLabel: "other",
        codexOpenUrl: "codex://threads/thread-other",
      },
    ]
    renderSidebar()

    expect(screen.getByText("AI履歴サイドバーを接続")).toBeInTheDocument()
    expect(screen.getByText("別リポの履歴")).toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("all")
    expect(lastHookOptions.at(-1)?.scope).toBe("global")

    const scopeButton = screen.getAllByRole("button").find(button => (
      button.getAttribute("aria-controls") === "ai-history-scope-filter"
    ))
    expect(scopeButton).toBeDefined()
    fireEvent.click(scopeButton!)
    const scopeFilter = document.getElementById("ai-history-scope-filter")
    expect(scopeFilter).not.toBeNull()
    fireEvent.click(within(scopeFilter!).getAllByText("focusmap")[0]!)

    expect(screen.getByText("AI履歴サイドバーを接続")).toBeInTheDocument()
    expect(screen.queryByText("別リポの履歴")).not.toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("/Users/me/focusmap")
    expect(lastHookOptions.at(-1)?.scope).toBe("global")
  })

  test("shows synced repo options and filters directly to another project repo", () => {
    historyItems = [
      baseHistoryItem,
      {
        ...baseHistoryItem,
        id: "history-other",
        externalThreadId: "thread-other",
        title: "別リポの履歴",
        repoPath: "/Users/me/other",
        repoLabel: "other",
        codexOpenUrl: "codex://threads/thread-other",
      },
    ]
    renderSidebar()

    const scopeButton = screen.getAllByRole("button").find(button => (
      button.getAttribute("aria-controls") === "ai-history-scope-filter"
    ))
    expect(scopeButton).toBeDefined()
    fireEvent.click(scopeButton!)
    const scopeFilter = document.getElementById("ai-history-scope-filter")
    expect(scopeFilter).not.toBeNull()
    fireEvent.click(within(scopeFilter!).getByText("other"))

    expect(screen.queryByText("AI履歴サイドバーを接続")).not.toBeInTheDocument()
    expect(screen.getByText("別リポの履歴")).toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("/Users/me/other")
    expect(lastHookOptions.at(-1)?.scope).toBe("global")
  })

  test("filters a Codex.app repo candidate without changing the current project repo", async () => {
    const onSelectRepoPath = vi.fn(() => Promise.resolve())
    useAvailableReposMock.mockReturnValue({
      repos: [{
        id: "codex:/Users/me/side-business",
        hostname: "Codex",
        absolute_path: "/Users/me/side-business",
        display_name: "side-business",
        last_git_commit_at: null,
        last_seen_at: "2026-06-20T00:00:00.000Z",
        source: "codex",
        thread_count: 4,
      }],
      isLoading: false,
      error: null,
      refresh: vi.fn(),
      requestRescan: vi.fn(),
    })
    historyItems = [
      baseHistoryItem,
      {
        ...baseHistoryItem,
        id: "history-side-business",
        externalThreadId: "thread-side-business",
        title: "side-businessの履歴",
        repoPath: "/Users/me/side-business",
        repoLabel: "side-business",
        codexOpenUrl: "codex://threads/thread-side-business",
      },
    ]
    renderSidebar({ onSelectRepoPath })

    const scopeButton = screen.getAllByRole("button").find(button => (
      button.getAttribute("aria-controls") === "ai-history-scope-filter"
    ))
    expect(scopeButton).toBeDefined()
    fireEvent.click(scopeButton!)
    const scopeFilter = document.getElementById("ai-history-scope-filter")
    expect(scopeFilter).not.toBeNull()
    fireEvent.click(within(scopeFilter!).getByText("side-business"))

    await waitFor(() => {
      expect(screen.getByText("side-businessの履歴")).toBeInTheDocument()
    })
    expect(onSelectRepoPath).not.toHaveBeenCalled()
    expect(screen.queryByText("AI履歴サイドバーを接続")).not.toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("/Users/me/side-business")
    expect(lastHookOptions.at(-1)?.scope).toBe("global")
  })

  test("sorts running first, then latest review items, and hides completed histories", () => {
    historyItems = [
      {
        ...baseHistoryItem,
        id: "history-review-old",
        externalThreadId: "thread-review-old",
        title: "古い確認待ち",
        status: "awaiting_approval",
        lastActivityAt: "2026-06-20T00:00:00.000Z",
      },
      {
        ...baseHistoryItem,
        id: "history-running",
        externalThreadId: "thread-running",
        title: "実行中の履歴",
        status: "running",
        lastActivityAt: "2026-06-19T00:00:00.000Z",
      },
      {
        ...baseHistoryItem,
        id: "history-review-new",
        externalThreadId: "thread-review-new",
        title: "新しい確認待ち",
        status: "awaiting_approval",
        lastActivityAt: "2026-06-21T00:00:00.000Z",
      },
      {
        ...baseHistoryItem,
        id: "history-completed",
        externalThreadId: "thread-completed",
        title: "完了済み履歴",
        status: "completed",
        lastActivityAt: "2026-06-22T00:00:00.000Z",
      },
    ]

    renderSidebar()

    const rows = screen.getAllByTestId(/^codex-chat-import-row-/)
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringContaining("実行中の履歴"),
      expect.stringContaining("新しい確認待ち"),
      expect.stringContaining("古い確認待ち"),
    ])
    expect(screen.queryByText("完了済み履歴")).not.toBeInTheDocument()
  })

  test("merges current project, saved scope, and Codex repo count into one clean repo option", () => {
    useAvailableReposMock.mockReturnValue({
      repos: [{
        id: "codex:/Users/me/focusmap",
        hostname: "Codex",
        absolute_path: "/Users/me/focusmap",
        display_name: "focusmap",
        last_git_commit_at: null,
        last_seen_at: "2026-06-20T00:00:00.000Z",
        source: "codex",
        thread_count: 1,
      }],
      isLoading: false,
      error: null,
      refresh: availableReposRefreshMock,
      requestRescan: vi.fn(),
    })
    renderSidebar()

    const scopeButton = screen.getAllByRole("button").find(button => (
      button.getAttribute("aria-controls") === "ai-history-scope-filter"
    ))
    expect(scopeButton).toBeDefined()
    fireEvent.click(scopeButton!)
    const scopeFilter = document.getElementById("ai-history-scope-filter")
    expect(scopeFilter).not.toBeNull()

    expect(within(scopeFilter!).getAllByText("focusmap")).toHaveLength(1)
    expect(within(scopeFilter!).getByText("Codex 1件")).toBeInTheDocument()
    expect(within(scopeFilter!).queryByText("Project")).not.toBeInTheDocument()
    expect(within(scopeFilter!).queryByText("保存済み")).not.toBeInTheDocument()
  })

  test("defaults to unplaced and switches to the mindmap bucket", () => {
    historyItems = [
      baseHistoryItem,
      {
        ...baseHistoryItem,
        id: "history-mindmap",
        title: "配置済み履歴",
        placement: "mindmap",
        sourceTaskId: "task-1",
      },
    ]
    renderSidebar()

    expect(screen.getByText("未配置 1件")).toBeInTheDocument()
    expect(screen.getByText("AI履歴サイドバーを接続")).toBeInTheDocument()
    expect(screen.queryByText("配置済み履歴")).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("マインドマップ"))

    expect(screen.getByText("配置済み履歴")).toBeInTheDocument()
    expect(screen.queryByText("AI履歴サイドバーを接続")).not.toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.placement).toBe("mindmap")
  })

  test("opens details through the AI history detail contract", async () => {
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(screen.getAllByText("未配置とマインドマップの2分類に整理しました").length).toBeGreaterThan(0)
    })
    expect(screen.getByRole("button", { name: "一覧へ戻る" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Codexで開く AI履歴サイドバーを接続/ })).toHaveAttribute(
      "href",
      "codex://threads/thread-abcdef123456",
    )
    expect(fetchWithSupabaseAuthMock).toHaveBeenCalledWith("/api/ai-history/history-1", { cache: "no-store" })
    expect(fetchWithSupabaseAuthMock).toHaveBeenCalledWith(
      "/api/ai-history/history-1/activity?limit=30&mode=report&watch=1",
      { cache: "no-store" },
    )
    expect(fetchWithSupabaseAuthMock).not.toHaveBeenCalledWith(
      "/api/codex/sync-node",
      expect.anything(),
    )
  })

  test("falls back to synced rally duration for completed inline work status when metadata is missing", async () => {
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(screen.getByLabelText("1m作業しました")).toBeInTheDocument()
    })
  })

  test("prefers completed activity metadata over synced rally duration for inline work status", async () => {
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/ai-history/history-1") {
        return jsonResponse({
          item: baseHistoryItem,
          detail: {
            hydrateRequired: false,
            linkedAiTaskId: "ai-task-1",
            activityUrl: "/api/ai-history/history-1/activity",
            policy: "linked_ai_task_activity",
          },
        })
      }
      if (url.startsWith("/api/ai-history/history-1/activity")) {
        return jsonResponse({
          messages: [
            {
              id: "msg-user",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "user",
              kind: "sent",
              body: "AI履歴をAPIへ接続して",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-20T00:00:00.000Z",
            },
            {
              id: "msg-codex",
              task_id: "ai-task-1",
              user_id: "user-1",
              role: "codex",
              kind: "completed",
              body: "未配置とマインドマップの2分類に整理しました",
              importance: "normal",
              metadata: {
                turn_started_at: "2026-06-20T00:00:03.000Z",
                turn_completed_at: "2026-06-20T00:00:30.000Z",
                work_elapsed_ms: 27_000,
              },
              created_at: "2026-06-20T00:01:00.000Z",
            },
          ],
        })
      }
      return jsonResponse({}, 404)
    })
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(screen.getByLabelText("27s作業しました")).toBeInTheDocument()
    })
    expect(screen.queryByLabelText("1m作業しました")).not.toBeInTheDocument()
  })

  test("shows cached unlinked AI history prompt and answer immediately", async () => {
    historyItems = [{
      ...baseHistoryItem,
      linkedAiTaskId: null,
      detailHydrated: true,
      detailSyncedAt: "2026-06-20T00:02:00.000Z",
    }]
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/ai-history/history-1") {
        return jsonResponse({
          item: { ...baseHistoryItem, linkedAiTaskId: null },
          detail: {
            hydrateRequired: false,
            hydrateReason: null,
            detailSyncedAt: "2026-06-20T00:02:00.000Z",
            messageCount: 2,
            linkedAiTaskId: null,
            activityUrl: "/api/ai-history/history-1/activity",
            policy: "ai_history_detail_cache",
          },
        })
      }
      if (url.startsWith("/api/ai-history/history-1/activity")) {
        return jsonResponse({
          source: "ai_history_detail_cache",
          messages: [
            {
              id: "history-msg-user",
              task_id: "history-1",
              user_id: "user-1",
              role: "user",
              kind: "sent",
              body: "キャッシュ済みの依頼本文",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-20T00:00:00.000Z",
            },
            {
              id: "history-msg-codex",
              task_id: "history-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "キャッシュ済みの回答本文",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-20T00:01:00.000Z",
            },
          ],
          hydrate: {
            required: false,
            reason: null,
            detailSyncedAt: "2026-06-20T00:02:00.000Z",
            messageCount: 2,
          },
        })
      }
      return jsonResponse({}, 404)
    })
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(screen.getByText("キャッシュ済みの依頼本文")).toBeInTheDocument()
    })
    expect(screen.getAllByText("キャッシュ済みの回答本文").length).toBeGreaterThan(0)
    expect(screen.queryByText("更新中")).not.toBeInTheDocument()
    expect(fetchWithSupabaseAuthMock).not.toHaveBeenCalledWith(
      "/api/codex/sync-node",
      expect.anything(),
    )
  })

  test("keeps cache or snippet visible while hydrate is required and shows offline update state", async () => {
    syncState = {
      featureEnabled: true,
      aiOnline: false,
      agentConnected: false,
    }
    historyItems = [{
      ...baseHistoryItem,
      linkedAiTaskId: null,
      detailHydrated: false,
      detailSyncedAt: null,
      snippet: "一覧に残っている依頼の要約",
    }]
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/ai-history/history-1") {
        return jsonResponse({
          item: { ...baseHistoryItem, linkedAiTaskId: null },
          detail: {
            hydrateRequired: true,
            hydrateReason: "detail_cache_empty",
            detailSyncedAt: null,
            messageCount: 0,
            linkedAiTaskId: null,
            activityUrl: "/api/ai-history/history-1/activity",
            policy: "local_agent_detail_hydrate_required",
          },
        })
      }
      if (url.startsWith("/api/ai-history/history-1/activity")) {
        return jsonResponse({
          source: "hydrate_required",
          messages: [],
          has_more: false,
          next_cursor: null,
          hydrate: {
            required: true,
            reason: "detail_cache_empty",
            detailSyncedAt: null,
            messageCount: 0,
          },
        }, 202)
      }
      return jsonResponse({}, 404)
    })
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(screen.getByText("Macエージェント待ち")).toBeInTheDocument()
    })
    expect(screen.getAllByText("一覧に残っている依頼の要約").length).toBeGreaterThan(0)
    expect(screen.getByText(/更新不能/)).toBeInTheDocument()
    expect(screen.queryByText(/詳細本文はまだ取得されていません/)).not.toBeInTheDocument()
  })

  test("polls only the visible selected detail while hydrate is required", async () => {
    historyItems = [{
      ...baseHistoryItem,
      linkedAiTaskId: null,
      detailHydrated: false,
      detailSyncedAt: null,
      snippet: null,
    }]
    let activityCalls = 0
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/ai-history/history-1") {
        return jsonResponse({
          item: { ...baseHistoryItem, linkedAiTaskId: null },
          detail: {
            hydrateRequired: true,
            hydrateReason: "detail_cache_empty",
            detailSyncedAt: null,
            messageCount: 0,
            linkedAiTaskId: null,
            activityUrl: "/api/ai-history/history-1/activity",
            policy: "local_agent_detail_hydrate_required",
          },
        })
      }
      if (url.startsWith("/api/ai-history/history-1/activity")) {
        activityCalls += 1
        if (activityCalls === 1) {
          return jsonResponse({
            source: "hydrate_required",
            messages: [],
            hydrate: {
              required: true,
              reason: "detail_cache_empty",
              detailSyncedAt: null,
              messageCount: 0,
            },
          }, 202)
        }
        return jsonResponse({
          source: "ai_history_detail_cache",
          messages: [
            {
              id: "hydrated-msg",
              task_id: "history-1",
              user_id: "user-1",
              role: "codex",
              kind: "progress",
              body: "hydrate後の回答本文",
              importance: "normal",
              metadata: {},
              created_at: "2026-06-20T00:03:00.000Z",
            },
          ],
          hydrate: {
            required: false,
            reason: null,
            detailSyncedAt: "2026-06-20T00:03:00.000Z",
            messageCount: 1,
          },
        })
      }
      return jsonResponse({}, 404)
    })
    renderSidebar()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-history-1"))

    await waitFor(() => {
      expect(screen.getByText("更新中")).toBeInTheDocument()
    })
    expect(activityCalls).toBe(1)

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    })
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 3200))
    })
    expect(activityCalls).toBe(1)

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 3200))
    })
    await waitFor(() => {
      expect(screen.getAllByText("hydrate後の回答本文").length).toBeGreaterThan(0)
    })
    expect(activityCalls).toBe(2)
  }, 10_000)
})
