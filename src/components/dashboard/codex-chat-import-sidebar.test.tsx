import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CODEX_CHAT_IMPORT_DRAG_TYPE } from "@/lib/codex-chat-import-dnd"
import { CodexChatImportSidebar, type CodexChatImportItem } from "./codex-chat-import-sidebar"

const refreshRepos = vi.fn()
const requestRescan = vi.fn()

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

const chatItems: CodexChatImportItem[] = [
  {
    id: "chat-node-1",
    title: "Codexスレッド連携UI",
    snippet: "右側サイドバーにチャット一覧を表示する",
    repoPath: "/Users/me/focusmap",
    projectTitle: "仕事",
    placementLabel: "未配置",
    statusLabel: "確認待ち",
    updatedLabel: "3時間",
    placed: false,
  },
]

function renderSidebar() {
  const onSelectRepoPath = vi.fn().mockResolvedValue(undefined)
  const onToggleImport = vi.fn().mockResolvedValue(undefined)
  const onDeleteChatItem = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()

  render(
    <CodexChatImportSidebar
      projectTitle="仕事"
      selectedRepoPath="/Users/me/focusmap"
      importEnabled
      importOwnerLabel="仕事"
      chatItems={chatItems}
      onClose={onClose}
      onSelectRepoPath={onSelectRepoPath}
      onToggleImport={onToggleImport}
      onDeleteChatItem={onDeleteChatItem}
    />,
  )

  return { onSelectRepoPath, onToggleImport, onDeleteChatItem, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
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
  })

  test("selects a repo from Focusmap agent repo candidates", async () => {
    const { onSelectRepoPath } = renderSidebar()

    fireEvent.click(screen.getByRole("button", { name: /既存リポ選択/ }))
    fireEvent.click(screen.getByRole("button", { name: "対象リポを選択 focusmap" }))

    await waitFor(() => {
      expect(onSelectRepoPath).toHaveBeenCalledWith("/Users/me/focusmap")
    })
  })

  test("fetches chat detail only when a chat row is opened", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        task: {
          title: "Codexスレッド連携UI",
          memo: "取得したチャット詳細\n2行目",
        },
      }),
    })
    vi.stubGlobal("fetch", fetchMock)
    renderSidebar()

    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))

    await waitFor(() => {
      expect(screen.getByText("取得したチャット詳細", { exact: false })).toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith("/api/tasks/chat-node-1")
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))
    fireEvent.click(screen.getByTestId("codex-chat-import-row-chat-node-1"))

    expect(fetchMock).toHaveBeenCalledTimes(1)
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
    expect(JSON.parse(data.get(CODEX_CHAT_IMPORT_DRAG_TYPE) ?? "{}")).toEqual({ taskId: "chat-node-1" })
  })

  test("deletes a chat row from the repo inbox", async () => {
    const { onDeleteChatItem } = renderSidebar()

    fireEvent.click(screen.getByRole("button", { name: "チャットを削除 Codexスレッド連携UI" }))

    await waitFor(() => {
      expect(onDeleteChatItem).toHaveBeenCalledWith("chat-node-1")
    })
  })
})
