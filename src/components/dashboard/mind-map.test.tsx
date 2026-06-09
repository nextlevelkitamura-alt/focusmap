import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"

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
  CustomMindMapView: ({ onSelectNode }: { onSelectNode: (nodeId: string) => void }) => (
    <button type="button" onClick={() => onSelectNode("root-1")}>
      Root task
    </button>
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
})
