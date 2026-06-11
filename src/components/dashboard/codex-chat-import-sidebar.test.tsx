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
    placementLabel: "未配置",
    statusLabel: "確認待ち",
    updatedLabel: "3時間",
    placed: false,
  },
]

function renderSidebar() {
  const onSaveRepoPath = vi.fn().mockResolvedValue(undefined)
  const onToggleImport = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()

  render(
    <CodexChatImportSidebar
      projectTitle="仕事"
      repoPath="/Users/me/focusmap"
      importEnabled
      chatItems={chatItems}
      onClose={onClose}
      onSaveRepoPath={onSaveRepoPath}
      onToggleImport={onToggleImport}
    />,
  )

  return { onSaveRepoPath, onToggleImport, onClose }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as Window & { focusmapDesktop?: unknown }).focusmapDesktop
})

describe("CodexChatImportSidebar", () => {
  test("renders chat import wording, repo monitor switch, and project chats", () => {
    renderSidebar()

    expect(screen.getByRole("complementary", { name: "チャット取り込み" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "リポ監視" })).toBeChecked()
    expect(screen.getByText("リポフォルダ")).toBeInTheDocument()
    expect(screen.getByText("Codexスレッド連携UI")).toBeInTheDocument()
    expect(screen.getByText("未配置")).toBeInTheDocument()
  })

  test("saves a repo selected from Focusmap agent repo candidates", async () => {
    const { onSaveRepoPath } = renderSidebar()

    fireEvent.click(screen.getByRole("button", { name: "リポフォルダを選択 focusmap" }))

    await waitFor(() => {
      expect(onSaveRepoPath).toHaveBeenCalledWith("/Users/me/focusmap")
    })
  })

  test("saves a repo folder picked from Finder immediately", async () => {
    const { onSaveRepoPath } = renderSidebar()
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ path: "/Users/me/new-repo/" }),
    }))

    fireEvent.click(screen.getByRole("button", { name: "Finderでリポフォルダを選択" }))

    await waitFor(() => {
      expect(onSaveRepoPath).toHaveBeenCalledWith("/Users/me/new-repo")
    })
  })

  test("uses the Focusmap Mac app folder picker before falling back to the server API", async () => {
    const { onSaveRepoPath } = renderSidebar()
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
      expect(onSaveRepoPath).toHaveBeenCalledWith("/Users/me/mac-picked-repo")
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
})
