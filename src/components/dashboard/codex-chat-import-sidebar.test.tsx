import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { CodexChatImportSidebar } from "./codex-chat-import-sidebar"
import type { AiHistoryListItem, AiHistoryPlacement, AiHistoryRepoFilter } from "@/types/ai-history"

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
let lastHookOptions: Array<{ projectId: string | null; repo: AiHistoryRepoFilter; placement: AiHistoryPlacement }> = []

function repoMatches(item: AiHistoryListItem, repo: AiHistoryRepoFilter) {
  return repo === "all" || item.repoPath === repo
}

function mockUseAiHistory() {
  useAiHistoryMock.mockImplementation((options: {
    projectId: string | null
    repo: AiHistoryRepoFilter
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
        featureEnabled: true,
        aiOnline: true,
        agentConnected: true,
        selectedRepo: options.repo,
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

  test("uses the repo selector as a display filter only", () => {
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

    fireEvent.click(screen.getByRole("button", { name: /全体/ }))
    const repoFilter = document.getElementById("ai-history-repo-filter")
    expect(repoFilter).not.toBeNull()
    fireEvent.click(within(repoFilter!).getByText("other"))

    expect(screen.queryByText("AI履歴サイドバーを接続")).not.toBeInTheDocument()
    expect(screen.getByText("別リポの履歴")).toBeInTheDocument()
    expect(lastHookOptions.at(-1)?.repo).toBe("/Users/me/other")
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
      "/api/ai-history/history-1/activity?limit=30&mode=report",
      { cache: "no-store" },
    )
    expect(fetchWithSupabaseAuthMock).not.toHaveBeenCalledWith(
      "/api/codex/sync-node",
      expect.anything(),
    )
  })
})
