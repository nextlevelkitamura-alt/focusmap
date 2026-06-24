import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { useAiHistory } from "./useAiHistory"
import type { AiHistoryListItem, AiHistoryListResponse, AiHistorySnapshotResponse } from "@/types/ai-history"

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

function snapshotResponseFor(input: {
  repo: "all" | string
  items: AiHistoryListItem[]
  cursor?: string | null
}): AiHistorySnapshotResponse {
  return {
    source: "turso",
    serverTime: "2026-06-20T00:00:05.000Z",
    cursor: input.cursor ?? "2026-06-20T00:00:05.000Z|history-focusmap",
    changedSince: null,
    items: input.items,
    hasMore: false,
    includeDeleted: true,
    filter: {
      projectId: "project-1",
      repo: input.repo,
      scope: "global",
      provider: "codex_app",
    },
    policy: {
      metadataOnly: true,
      countsIncluded: false,
      reconcileIncluded: false,
      detailHydrateRequestsCreated: false,
      rawBodiesIncluded: false,
      cursor: "indexed_at|id",
    },
  }
}

function jsonSnapshotResponse(data: AiHistorySnapshotResponse) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
  } as Response
}

describe("useAiHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete window.__focusmapAiHistoryMetrics
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

  test("polls the metadata snapshot instead of refetching counts every interval", async () => {
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("/api/ai-history/snapshot?")) {
        return jsonSnapshotResponse(snapshotResponseFor({
          repo: "all",
          items: [{
            ...baseItem,
            status: "running",
            runState: "resumed",
            lastActivityAt: "2026-06-20T00:00:05.000Z",
            indexedAt: "2026-06-20T00:00:05.000Z",
            workDurationSeconds: 4,
          }],
        }))
      }
      return jsonResponse(responseFor({
        repo: "all",
        items: [baseItem],
        counts: { unplaced: 123, mindmap: 45 },
      }))
    })

    const { result, unmount } = renderHook(() => useAiHistory({
      projectId: "project-1",
      scope: "global",
      repo: "all",
      placement: "unplaced",
      pollIntervalMs: 100,
    }))

    await waitFor(() => {
      expect(result.current.items[0]?.status).toBe("awaiting_approval")
    })

    await waitFor(() => {
      expect(result.current.items[0]?.status).toBe("running")
      expect(result.current.items[0]?.runState).toBe("resumed")
    })

    const urls = fetchWithSupabaseAuthMock.mock.calls.map(([input]) => String(input))
    expect(urls.filter(url => url.startsWith("/api/ai-history?"))).toHaveLength(1)
    expect(urls.some(url => (
      url.startsWith("/api/ai-history/snapshot?") &&
      url.includes("include_deleted=true")
    ))).toBe(true)
    expect(result.current.counts).toEqual({ unplaced: 123, mindmap: 45 })
    unmount()
  })

  test("records first-seen debug metrics when snapshot merge displays a new history item", async () => {
    const snapshotItem: AiHistoryListItem = {
      ...baseItem,
      id: "history-new-prompt",
      externalThreadId: "thread-new-prompt",
      title: "新しいprompt",
      status: "running",
      runState: "initial_prompt",
      lastActivityAt: "2026-06-20T00:00:06.000Z",
      indexedAt: "2026-06-20T00:00:06.000Z",
    }
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("/api/ai-history/snapshot?")) {
        return jsonSnapshotResponse(snapshotResponseFor({
          repo: "all",
          items: [snapshotItem],
        }))
      }
      return jsonResponse(responseFor({
        repo: "all",
        items: [baseItem],
      }))
    })

    const { result, unmount } = renderHook(() => useAiHistory({
      projectId: "project-1",
      scope: "global",
      repo: "all",
      placement: "unplaced",
      pollIntervalMs: 100,
    }))

    await waitFor(() => {
      expect(result.current.items.some(item => item.id === "history-new-prompt")).toBe(true)
    })

    const metrics = window.__focusmapAiHistoryMetrics
    expect(metrics?.firstSeenById["history-new-prompt"]).toMatchObject({
      historyItemId: "history-new-prompt",
      status: "running",
      source: "snapshot_merge",
      placement: "unplaced",
      repoPath: "/Users/me/focusmap",
      externalThreadId: "thread-new-prompt",
    })
    expect(metrics?.firstSeenById["history-new-prompt"]?.firstSeenAt).toEqual(expect.any(String))
    expect(metrics?.firstSeenById["history-new-prompt"]?.firstSeenPerformanceMs).toEqual(expect.any(Number))
    expect(metrics?.events.at(-1)?.historyItemId).toBe("history-new-prompt")
    unmount()
  })

  test("removes items deleted by the snapshot merge", async () => {
    fetchWithSupabaseAuthMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith("/api/ai-history/snapshot?")) {
        return jsonSnapshotResponse(snapshotResponseFor({
          repo: "all",
          items: [{
            ...baseItem,
            deletedAt: "2026-06-20T00:00:05.000Z",
            indexedAt: "2026-06-20T00:00:05.000Z",
          }],
        }))
      }
      return jsonResponse(responseFor({
        repo: "all",
        items: [baseItem],
      }))
    })

    const { result, unmount } = renderHook(() => useAiHistory({
      projectId: "project-1",
      scope: "global",
      repo: "all",
      placement: "unplaced",
      pollIntervalMs: 100,
    }))

    await waitFor(() => {
      expect(result.current.items).toHaveLength(1)
    })
    await waitFor(() => {
      expect(result.current.items).toEqual([])
    })
    unmount()
  })
})
