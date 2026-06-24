import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { useAiHistory } from "./useAiHistory"
import type { AiHistoryListItem, AiHistoryListResponse } from "@/types/ai-history"

const fetchWithSupabaseAuthMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/auth/supabase-auth-fetch", () => ({
  fetchWithSupabaseAuth: fetchWithSupabaseAuthMock,
}))

const baseItem: AiHistoryListItem = {
  id: "history-focusmap",
  provider: "codex_app",
  externalThreadId: "thread-focusmap",
  title: "focusmap履歴",
  snippet: "focusmapの依頼",
  repoPath: "/Users/me/focusmap",
  repoLabel: "focusmap",
  worktreePath: null,
  placement: "unplaced",
  sourceTaskId: null,
  linkedAiTaskId: null,
  status: "awaiting_approval",
  runState: null,
  lastActivityAt: "2026-06-20T00:00:00.000Z",
  indexedAt: "2026-06-20T00:00:01.000Z",
  startedAt: null,
  endedAt: null,
  workDurationSeconds: null,
  archived: false,
  deletedAt: null,
  detailHydrated: true,
  detailHydrateRequired: false,
  detailHydrateReason: null,
  detailMessageCount: 2,
  detailSyncedAt: "2026-06-20T00:00:02.000Z",
  updatedAt: "2026-06-20T00:00:02.000Z",
  codexOpenUrl: "codex://threads/thread-focusmap",
}

function responseFor(input: {
  repo: "all" | string
  items: AiHistoryListItem[]
  counts?: AiHistoryListResponse["counts"]
}): AiHistoryListResponse {
  return {
    items: input.items,
    counts: input.counts ?? {
      unplaced: input.items.filter(item => item.placement === "unplaced").length,
      mindmap: input.items.filter(item => item.placement === "mindmap").length,
    },
    nextCursor: null,
    sync: {
      featureEnabled: true,
      aiOnline: true,
      agentConnected: true,
      selectedRepo: input.repo,
      selectedScope: "global",
      selectedProvider: "codex_app",
      providerOptions: [
        { provider: "codex_app", label: "Codex", enabled: true, agentSeen: true },
      ],
      repoOptions: [
        { repoPath: "/Users/me/focusmap", label: "focusmap", enabled: true, agentSeen: true },
        { repoPath: "/Users/me/side-business", label: "side-business", enabled: true, agentSeen: true },
      ],
      lastIndexedAt: "2026-06-20T00:00:01.000Z",
      lastReconciledAt: "2026-06-20T00:00:02.000Z",
      nextReconcileAt: null,
    },
    page: { limit: 100, cursor: null },
  }
}

function jsonResponse(data: AiHistoryListResponse) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response
}

describe("useAiHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
  })

  test("does not display a stale all-repo response after switching to a repo filter", async () => {
    fetchWithSupabaseAuthMock.mockResolvedValueOnce(jsonResponse(responseFor({
      repo: "all",
      items: [
        baseItem,
        {
          ...baseItem,
          id: "history-side-business",
          externalThreadId: "thread-side",
          title: "side-business履歴",
          repoPath: "/Users/me/side-business",
          repoLabel: "side-business",
        },
      ],
      counts: { unplaced: 2, mindmap: 0 },
    })))

    const pendingSideBusinessFetch = new Promise<Response>(() => {})
    fetchWithSupabaseAuthMock.mockReturnValueOnce(pendingSideBusinessFetch)

    const { result, rerender } = renderHook(
      ({ repo }) => useAiHistory({
        projectId: "project-1",
        scope: "global",
        repo,
        placement: "unplaced",
        pollIntervalMs: 0,
      }),
      { initialProps: { repo: "all" as const } },
    )

    await waitFor(() => {
      expect(result.current.items.map(item => item.title)).toEqual(["focusmap履歴", "side-business履歴"])
    })

    rerender({ repo: "/Users/me/side-business" })

    expect(result.current.items).toEqual([])
    expect(result.current.counts.unplaced).toBe(0)
    expect(result.current.isLoading).toBe(true)
  })

  test("filters mixed current responses by selected repo and worktree before rendering", async () => {
    fetchWithSupabaseAuthMock.mockResolvedValueOnce(jsonResponse(responseFor({
      repo: "/Users/me/side-business",
      items: [
        baseItem,
        {
          ...baseItem,
          id: "history-side-business",
          externalThreadId: "thread-side",
          title: "side-business履歴",
          repoPath: "/Users/me/side-business",
          repoLabel: "side-business",
        },
        {
          ...baseItem,
          id: "history-side-worktree",
          externalThreadId: "thread-side-worktree",
          title: "side-business worktree履歴",
          repoPath: "/Users/me/Private",
          repoLabel: "Private",
          worktreePath: "/Users/me/side-business",
        },
      ],
      counts: { unplaced: 999, mindmap: 0 },
    })))

    const { result } = renderHook(() => useAiHistory({
      projectId: "project-1",
      scope: "global",
      repo: "/Users/me/side-business",
      placement: "unplaced",
      pollIntervalMs: 0,
    }))

    await waitFor(() => {
      expect(result.current.items.map(item => item.title)).toEqual([
        "side-business履歴",
        "side-business worktree履歴",
      ])
    })
    expect(result.current.counts.unplaced).toBe(2)
  })
})
