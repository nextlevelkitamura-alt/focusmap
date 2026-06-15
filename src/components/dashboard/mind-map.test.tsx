import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("@/components/dashboard/mindmap-display-settings", () => ({
  loadSettings: () => ({
    showCompleted: true,
    showNotes: true,
    layout: "tree",
  }),
  MindMapDisplaySettingsPopover: () => (
    <button type="button" aria-label="MindMap表示設定">
      Settings
    </button>
  ),
}))

vi.mock("@/components/dashboard/codex-chat-import-sidebar", () => ({
  CodexChatImportSidebar: ({
    chatItems,
    onClose,
    onDeleteChatItem,
    onPlaceChatItem,
  }: {
    chatItems?: Array<{ id: string; title: string; placementLabel?: string }>
    onClose: () => void
    onDeleteChatItem?: (taskId: string) => void
    onPlaceChatItem?: (taskId: string) => void
  }) => (
    <aside aria-label="チャット取り込み">
      {chatItems?.map(item => (
        <div key={item.id}>
          <span>{item.title}</span>
          {item.placementLabel && <span>{item.placementLabel}</span>}
          <button type="button" onClick={() => onPlaceChatItem?.(item.id)}>
            取り込みチャットを配置
          </button>
          <button type="button" onClick={() => onDeleteChatItem?.(item.id)}>
            delete {item.title}
          </button>
        </div>
      ))}
      <button type="button" onClick={onClose}>閉じる</button>
    </aside>
  ),
}))

vi.mock("@/hooks/useMultiTaskCalendarSync", () => ({
  useMultiTaskCalendarSync: () => undefined,
}))

vi.mock("@/hooks/useIsNarrowViewport", () => ({
  useIsNarrowViewport: () => false,
}))

vi.mock("@/hooks/useMemoAiTasks", () => ({
  useMemoAiTasks: () => ({
    bySourceId: new Map(),
    getBySourceId: () => null,
  }),
}))

vi.mock("@/hooks/useTaskProgressSnapshot", () => ({
  useTaskProgressSnapshot: () => ({
    tasks: [],
    getById: () => null,
    pollIntervalMs: 3000,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock("@/components/mindmap/custom-mind-map-view", () => ({
  CustomMindMapView: ({
    groups,
    tasks,
    onSelectNode,
    collapsedTaskIds,
    onToggleCollapse,
    onGenerateHeadingFromLongNode,
    onDropImportedChatNode,
  }: {
    groups: Array<{ id: string; title: string }>
    tasks: Array<{ id: string; title: string }>
    onSelectNode: (nodeId: string) => void
    collapsedTaskIds: Set<string>
    onToggleCollapse: (nodeId: string) => void
    onGenerateHeadingFromLongNode?: (nodeId: string) => void
    onDropImportedChatNode?: (payload: { taskId: string; targetId: string; position: "as-child" }) => void
  }) => (
    <>
      <div
        data-testid="custom-map-props"
        data-groups={groups.map(group => `${group.id}:${group.title}`).join("|")}
        data-tasks={tasks.map(task => `${task.id}:${task.title}`).join("|")}
      />
      <div data-testid="root-collapse-state">{collapsedTaskIds.has("root-1") ? "collapsed" : "expanded"}</div>
      <button type="button" onClick={() => onSelectNode("root-1")}>
        Root task
      </button>
      <button type="button" onClick={() => onToggleCollapse("root-1")}>
        折りたたみ切替
      </button>
      <button type="button" onClick={() => onGenerateHeadingFromLongNode?.("root-1")}>
        長いノードの見出し生成
      </button>
      <button
        type="button"
        onClick={() => onDropImportedChatNode?.({ taskId: "chat-node-1", targetId: "root-1", position: "as-child" })}
      >
        取り込みチャットを配置
      </button>
    </>
  ),
}))

vi.mock("@/components/task-progress/task-progress-kanban", () => ({
  TaskProgressKanban: ({ closeSignal }: { closeSignal?: number }) => (
    <div data-testid="task-progress-kanban" data-close-signal={closeSignal ?? 0} />
  ),
}))

vi.mock("@/components/task-progress/task-progress-detail-panel", () => ({
  TaskProgressDetailPanel: () => null,
}))

vi.mock("@/components/codex/codex-node-panel", () => ({
  CodexNodePanel: () => null,
}))

import { MindMap } from "./mind-map"
import type { Project, Task } from "@/types/database"

const project = {
  id: "project-1",
  title: "Project",
  repo_path: "/Users/me/focusmap",
  codex_thread_import_enabled: true,
} as Project

const task = {
  id: "root-1",
  title: "Root task",
  parent_task_id: null,
  project_id: "project-1",
  status: "todo",
  order_index: 0,
  estimated_time: 0,
  priority: null,
  scheduled_at: null,
  memo: null,
  memo_images: null,
  source: "manual",
  node_width: null,
  mindmap_collapsed: false,
  is_habit: false,
  habit_end_date: null,
} as Task

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("MindMap controls", () => {
  test("keeps map settings in the corner and hides node shortcut help", () => {
    render(<MindMap project={project} groups={[task]} tasks={[]} />)

    expect(screen.getByRole("button", { name: "チャット取り込み" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "MindMap表示設定" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Codex監視snapshotを更新" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Root task" }))

    expect(screen.queryByText("子追加")).not.toBeInTheDocument()
    expect(screen.queryByText("兄弟追加")).not.toBeInTheDocument()
    expect(screen.queryByText("複製")).not.toBeInTheDocument()
  })

  test("opens the chat import sidebar from the map corner", () => {
    render(<MindMap project={project} groups={[task]} tasks={[]} />)

    expect(screen.queryByRole("complementary", { name: "チャット取り込み" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "チャット取り込み" }))

    expect(screen.getByRole("complementary", { name: "チャット取り込み" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "チャット取り込み" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "MindMap表示設定" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "閉じる" }))

    expect(screen.queryByRole("complementary", { name: "チャット取り込み" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "チャット取り込み" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "MindMap表示設定" })).toBeInTheDocument()
  })

  test("restores and saves collapsed node state through the task record", async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    render(<MindMap project={project} groups={[{ ...task, mindmap_collapsed: true }]} tasks={[]} onUpdateTask={onUpdateTask} />)

    expect(screen.getByTestId("root-collapse-state")).toHaveTextContent("collapsed")

    fireEvent.click(screen.getByRole("button", { name: "折りたたみ切替" }))

    await waitFor(() => {
      expect(screen.getByTestId("root-collapse-state")).toHaveTextContent("expanded")
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", { mindmap_collapsed: false })
    })
  })

  test("keeps a local collapse action when stale task props re-render before save catches up", async () => {
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <MindMap project={project} groups={[{ ...task, mindmap_collapsed: false }]} tasks={[]} onUpdateTask={onUpdateTask} />
    )

    expect(screen.getByTestId("root-collapse-state")).toHaveTextContent("expanded")

    fireEvent.click(screen.getByRole("button", { name: "折りたたみ切替" }))

    await waitFor(() => {
      expect(screen.getByTestId("root-collapse-state")).toHaveTextContent("collapsed")
    })

    rerender(
      <MindMap
        project={project}
        groups={[{ ...task, title: "Root task updated", mindmap_collapsed: false }]}
        tasks={[]}
        onUpdateTask={onUpdateTask}
      />
    )

    expect(screen.getByTestId("root-collapse-state")).toHaveTextContent("collapsed")
    expect(onUpdateTask).toHaveBeenCalledWith("root-1", { mindmap_collapsed: true })
  })

  test("shows repo-scoped unplaced chats from another project and moves them into the current map", async () => {
    const onKanbanUpdateTask = vi.fn().mockResolvedValue(undefined)
    const otherProject = {
      id: "project-2",
      title: "仕事",
      repo_path: "/Users/me/focusmap",
      codex_thread_import_enabled: true,
    } as Project
    const inboxGroup = {
      ...task,
      id: "inbox-1",
      title: "Codex Inbox",
      project_id: "project-2",
      source: "codex_inbox",
    } as Task
    const importedChat = {
      ...task,
      id: "chat-node-1",
      title: "SNS運用の相談",
      project_id: "project-2",
      parent_task_id: "inbox-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
      deleted_at: null,
      updated_at: "2026-06-11T00:00:00.000Z",
    } as Task
    const placedParent = {
      ...task,
      id: "placed-parent-1",
      title: "既存の親",
      project_id: "project-2",
      source: "manual",
    } as Task
    const placedChat = {
      ...task,
      id: "chat-node-placed",
      title: "配置済みの相談",
      project_id: "project-2",
      parent_task_id: "placed-parent-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
      deleted_at: null,
      updated_at: "2026-06-12T00:00:00.000Z",
    } as Task

    render(
      <MindMap
        project={project}
        projects={[project, otherProject]}
        groups={[task]}
        tasks={[]}
        allTasks={[task, inboxGroup, importedChat, placedParent, placedChat]}
        onKanbanUpdateTask={onKanbanUpdateTask}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "チャット取り込み" }))
    expect(screen.getByText("SNS運用の相談")).toBeInTheDocument()
    expect(screen.getByText("未配置")).toBeInTheDocument()
    expect(screen.queryByText("配置済みの相談")).not.toBeInTheDocument()
    expect(screen.queryByText("配置済み: 既存の親")).not.toBeInTheDocument()

    const unplacedRow = screen.getByText("SNS運用の相談").closest("div")
    expect(unplacedRow).not.toBeNull()
    fireEvent.click(within(unplacedRow as HTMLElement).getByRole("button", { name: "取り込みチャットを配置" }))

    await waitFor(() => {
      expect(onKanbanUpdateTask).toHaveBeenCalledWith("chat-node-1", {
        parent_task_id: null,
        project_id: "project-1",
      })
    })
  })

  test("does not render Codex Inbox or its unplaced chats on the desktop map", () => {
    const inboxGroup = {
      ...task,
      id: "inbox-1",
      title: "Codex Inbox",
      source: "codex_inbox",
    } as Task
    const importedChat = {
      ...task,
      id: "chat-node-1",
      title: "未配置のCodexチャット",
      parent_task_id: "inbox-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
      deleted_at: null,
    } as Task
    const placedChat = {
      ...task,
      id: "chat-node-2",
      title: "配置済みCodexチャット",
      parent_task_id: "root-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
      deleted_at: null,
    } as Task

    render(
      <MindMap
        project={project}
        groups={[task, inboxGroup]}
        tasks={[importedChat, placedChat]}
      />
    )

    const mapProps = screen.getByTestId("custom-map-props")
    expect(mapProps.dataset.groups).toContain("root-1:Root task")
    expect(mapProps.dataset.groups).not.toContain("Codex Inbox")
    expect(mapProps.dataset.tasks).not.toContain("未配置のCodexチャット")
    expect(mapProps.dataset.tasks).toContain("配置済みCodexチャット")
  })

  test("turns a long node title into memo detail and saves the generated heading", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ heading: "クリップボード改善" }),
    })
    vi.stubGlobal("fetch", fetchMock)
    const onUpdateTask = vi.fn()
    const longTitle = [
      "プロンプトに関して",
      "画像をとろくしているものはマックアプリもスマホアプリも画像をクリップボードに保存して",
      "見出しと本文を改行してコピーする",
    ].join("\n")
    const longTask = {
      ...task,
      title: longTitle,
      memo: "既存メモ",
    } as Task

    render(<MindMap project={project} groups={[longTask]} tasks={[]} onUpdateTask={onUpdateTask} />)

    fireEvent.click(screen.getByRole("button", { name: "長いノードの見出し生成" }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/ai/generate-memo-heading", expect.objectContaining({
        method: "POST",
      }))
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", {
        title: "プロンプトに関して",
        memo: `${longTitle}\n\n既存メモ`,
      })
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", {
        title: "クリップボード改善",
        memo: `${longTitle}\n\n既存メモ`,
      })
    })
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(requestInit.body))).toEqual({
      detail: `${longTitle}\n\n既存メモ`,
      currentHeading: "プロンプトに関して",
    })
  })

  test("copies a selected node with Cmd+C and pastes it under the selected node with Cmd+V", async () => {
    const clipboard = {
      text: "",
      writeText: vi.fn(async (text: string) => {
        clipboard.text = text
      }),
      readText: vi.fn(async () => clipboard.text),
    }
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard,
    })
    const onCreateTask = vi.fn(async () => ({
      ...task,
      id: "copy-1",
      parent_task_id: "root-1",
    } as Task))
    const onUpdateTask = vi.fn()

    render(
      <MindMap
        project={project}
        groups={[task]}
        tasks={[]}
        onCreateTask={onCreateTask}
        onUpdateTask={onUpdateTask}
      />
    )

    const rootButton = screen.getByRole("button", { name: "Root task" })
    fireEvent.click(rootButton)
    fireEvent.keyDown(rootButton, { key: "c", metaKey: true })

    await waitFor(() => {
      expect(clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("SHIKUMIKA_MINDMAP_NODE_V1:"))
    })

    fireEvent.keyDown(rootButton, { key: "v", metaKey: true })

    await waitFor(() => {
      expect(onCreateTask).toHaveBeenCalledWith("root-1", "Root task", "root-1")
      expect(onUpdateTask).toHaveBeenCalledWith("copy-1", expect.objectContaining({
        status: "todo",
        calendar_id: null,
        google_event_id: null,
        calendar_event_id: null,
      }))
    })
  })

  test("notifies the Codex board to close when the map side is pressed", async () => {
    render(<MindMap project={project} groups={[task]} tasks={[]} />)

    expect(screen.getByTestId("task-progress-kanban")).toHaveAttribute("data-close-signal", "0")

    fireEvent.pointerDown(screen.getByRole("button", { name: "Root task" }))

    await waitFor(() => {
      expect(screen.getByTestId("task-progress-kanban")).toHaveAttribute("data-close-signal", "1")
    })
  })
})
