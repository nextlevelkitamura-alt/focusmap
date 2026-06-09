import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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
    onSelectNode,
    onGenerateHeadingFromLongNode,
  }: {
    onSelectNode: (nodeId: string) => void
    onGenerateHeadingFromLongNode?: (nodeId: string) => void
  }) => (
    <>
      <button type="button" onClick={() => onSelectNode("root-1")}>
        Root task
      </button>
      <button type="button" onClick={() => onGenerateHeadingFromLongNode?.("root-1")}>
        長いノードの見出し生成
      </button>
    </>
  ),
}))

vi.mock("@/components/task-progress/task-progress-kanban", () => ({
  TaskProgressKanban: () => <div data-testid="task-progress-kanban" />,
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
  is_habit: false,
  habit_end_date: null,
} as Task

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("MindMap controls", () => {
  test("keeps only display settings in the map corner and hides node shortcut help", () => {
    render(<MindMap project={project} groups={[task]} tasks={[]} />)

    expect(screen.getByRole("button", { name: "MindMap表示設定" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Codex監視snapshotを更新" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Root task" }))

    expect(screen.queryByText("子追加")).not.toBeInTheDocument()
    expect(screen.queryByText("兄弟追加")).not.toBeInTheDocument()
    expect(screen.queryByText("複製")).not.toBeInTheDocument()
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
})
