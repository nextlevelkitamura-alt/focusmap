import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CodexChatImportSidebar } from "./codex-chat-import-sidebar"
import type { AiHistoryListItem, AiHistoryPlacement, AiHistoryProvider, AiHistoryRepoFilter, AiHistoryScopeFilter } from "@/types/ai-history"

const useAiHistoryMock = vi.hoisted(() => vi.fn())
const fetchWithSupabaseAuthMock = vi.hoisted(() => vi.fn())

vi.mock("@/hooks/useAiHistory", () => ({
  useAiHistory: useAiHistoryMock,
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
  detailHydrated: true,
  detailSyncedAt: "2026-06-20T00:00:02.000Z",
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
      refresh: vi.fn(),
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

function renderSidebar() {
  const onClose = vi.fn()
  const view = render(
    <CodexChatImportSidebar
      projectId="project-1"
      projectTitle="仕事"
      initialRepoPath="/Users/me/focusmap"
      onClose={onClose}
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
  mockUseAiHistory()
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

  test("defaults to the project repo and shows all Codex chats when 全体 is selected", () => {
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
    expect(screen.queryByText("別リポの履歴")).not.toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("/Users/me/focusmap")
    expect(lastHookOptions.at(-1)?.scope).toBe("project")

    const scopeButton = screen.getAllByRole("button").find(button => (
      button.getAttribute("aria-controls") === "ai-history-scope-filter"
    ))
    expect(scopeButton).toBeDefined()
    fireEvent.click(scopeButton!)
    const scopeFilter = document.getElementById("ai-history-scope-filter")
    expect(scopeFilter).not.toBeNull()
    fireEvent.click(within(scopeFilter!).getByText("全体"))

    expect(screen.getByText("AI履歴サイドバーを接続")).toBeInTheDocument()
    expect(screen.getByText("別リポの履歴")).toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("all")
    expect(lastHookOptions.at(-1)?.scope).toBe("global")
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
  })
})
