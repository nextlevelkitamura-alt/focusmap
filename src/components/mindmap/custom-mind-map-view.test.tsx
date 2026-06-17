import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const memoAiTasksMock = vi.hoisted(() => {
  const state = {
    bySourceId: new Map<string, unknown>(),
    refreshStatus: vi.fn(),
  }

  return {
    bySourceId: state.bySourceId,
    getBySourceId: vi.fn((sourceId: string) => state.bySourceId.get(sourceId) ?? null),
    refreshStatus: state.refreshStatus,
  }
})

vi.mock("@/hooks/useCalendars", () => ({
  useCalendars: () => ({
    calendars: [
      {
        id: "calendar-row-1",
        user_id: "user-1",
        google_calendar_id: "primary",
        name: "Primary",
        description: null,
        location: null,
        timezone: "Asia/Tokyo",
        color: null,
        background_color: null,
        selected: true,
        access_level: "owner",
        is_primary: true,
        google_created_at: null,
        google_updated_at: null,
        synced_at: "",
        created_at: "",
        updated_at: "",
      },
    ],
    isLoading: false,
    error: null,
    fetchCalendars: async () => {},
    toggleCalendar: async () => {},
    toggleAll: async () => {},
    selectedCalendarIds: ["primary"],
  }),
}))

vi.mock("@/hooks/useMemoAiTasks", () => ({
  useMemoAiTasks: () => ({
    bySourceId: memoAiTasksMock.bySourceId,
    getBySourceId: memoAiTasksMock.getBySourceId,
    refreshStatus: memoAiTasksMock.refreshStatus,
  }),
}))

vi.mock("@/hooks/useAvailableRepos", () => ({
  useAvailableRepos: () => ({
    repos: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    requestRescan: vi.fn(),
  }),
}))

vi.mock("@/hooks/useCodexRunnerStatus", () => ({
  useCodexRunnerStatus: () => ({
    loading: false,
    checked: true,
    ready: true,
  }),
}))

vi.mock("@/lib/auth/supabase-auth-fetch", () => ({
  fetchWithSupabaseAuth: vi.fn(() => new Promise(() => {})),
}))

import { CustomMindMapView } from "./custom-mind-map-view"
import { MobileMindMap } from "@/components/mobile/mobile-mind-map"
import {
  CODEX_CHAT_IMPORT_DRAG_TYPE,
  encodeCodexChatImportDragPayload,
} from "@/lib/codex-chat-import-dnd"
import type { Project, Task } from "@/types/database"
import type { AiTask } from "@/types/ai-task"

const project = {
  id: "project-1",
  title: "Project",
} as Project

const makeTask = (overrides: Partial<Task>): Task => ({
  id: "task-1",
  title: "Task",
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
  ...overrides,
} as Task)

const makeAiTask = (overrides: Partial<AiTask>): AiTask => ({
  id: "ai-task-1",
  user_id: "user-1",
  space_id: "space-1",
  package_id: null,
  package_version_id: null,
  claimed_runner_id: null,
  claim_expires_at: null,
  run_visibility: "private",
  package_snapshot: null,
  prompt: "Codexで実行して",
  skill_id: null,
  approval_type: "auto",
  status: "running",
  result: { codex_run_state: "running" },
  error: null,
  parent_task_id: null,
  created_at: "2026-06-12T10:00:00.000Z",
  started_at: "2026-06-12T10:00:00.000Z",
  completed_at: null,
  scheduled_at: null,
  recurrence_cron: null,
  cwd: null,
  source_note_id: null,
  source_ideal_goal_id: null,
  source_task_id: "chat-node-1",
  remote_session_url: null,
  tmux_session_name: null,
  executor: "codex_app",
  codex_thread_id: "thread-1",
  ...overrides,
} as AiTask)

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  })
}

const renderMap = (props: Partial<React.ComponentProps<typeof CustomMindMapView>> = {}) => {
  const rootTask = makeTask({ id: "root-1", title: "Root task" })
  const childTask = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })

  return render(
    <CustomMindMapView
      project={project}
      groups={[rootTask]}
      tasks={[childTask]}
      collapsedTaskIds={new Set()}
      selectedNodeId={null}
      selectedNodeIds={new Set()}
      onSelectNode={vi.fn()}
      onSelectNodes={vi.fn()}
      onToggleCollapse={vi.fn()}
      {...props}
    />
  )
}

const getNode = (label: string, id: string) => {
  const node = screen.getByText(label).closest(`[data-id="${id}"]`)
  if (!(node instanceof HTMLElement)) throw new Error(`Node ${id} not found`)
  return node
}

const originalInnerWidth = window.innerWidth
const originalInnerHeight = window.innerHeight

const installOpenKeyboardViewport = (height = 500) => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    const set = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    set.add(listener)
    listeners.set(type, set)
  })
  const removeEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
    listeners.get(type)?.delete(listener)
  })
  const visualViewport = {
    height,
    offsetTop: 0,
    addEventListener,
    removeEventListener,
  } as unknown as VisualViewport

  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 })
  Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport })

  return {
    dispatch(type: string) {
      const event = new Event(type)
      listeners.get(type)?.forEach(listener => {
        if (typeof listener === "function") listener(event)
        else listener.handleEvent(event)
      })
    },
  }
}

const mockViewportRect = (rect: Partial<DOMRect> = {}) => {
  const fullRect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 390,
    bottom: 800,
    width: 390,
    height: 800,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect

  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
    if ((this as HTMLElement).dataset.testid === "custom-mind-map-viewport") return fullRect
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect
  })
}

const dispatchCodexImportDragEvent = (
  element: HTMLElement,
  type: "dragOver" | "drop",
  init: { dataTransfer: unknown; clientX: number; clientY: number }
) => {
  const event = type === "dragOver" ? createEvent.dragOver(element) : createEvent.drop(element)
  Object.defineProperty(event, "dataTransfer", { value: init.dataTransfer })
  Object.defineProperty(event, "clientX", { value: init.clientX })
  Object.defineProperty(event, "clientY", { value: init.clientY })
  return fireEvent(element, event)
}

const getNodeClientPoint = (node: HTMLElement, yRatio = 0.5) => {
  const left = parseFloat(node.style.left)
  const top = parseFloat(node.style.top)
  const width = parseFloat(node.style.width)
  const height = parseFloat(node.style.height)
  const stage = screen.getByTestId("custom-mind-map-stage")
  const transformMatch = stage.style.transform.match(/translate3d\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px, 0(?:px)?\) scale\((\d+(?:\.\d+)?)\)/)
  const panX = transformMatch ? Number(transformMatch[1]) : 0
  const panY = transformMatch ? Number(transformMatch[2]) : 0
  const scale = transformMatch ? Number(transformMatch[3]) : 0.9
  return {
    clientX: panX + (left + width / 2) * scale,
    clientY: panY + (top + height * yRatio) * scale,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  memoAiTasksMock.bySourceId.clear()
  memoAiTasksMock.getBySourceId.mockClear()
  memoAiTasksMock.refreshStatus.mockClear()
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth })
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight })
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined })
})

describe("CustomMindMapView keyboard operations", () => {
  test("shows Codex running summary and node spinner", () => {
    renderMap({
      codexRunByNodeId: {
        "root-1": {
          state: "running",
          taskId: "ai-task-1",
          label: "実行中",
          updatedAt: "2026-06-07T00:00:03.000Z",
        },
      },
    })

    expect(screen.getByText("実行中1")).toBeInTheDocument()
    expect(screen.getByLabelText("Codex 実行中")).toHaveClass("codex-node-running-orbit")
  })

  test("renders Codex thread import toggle with repo guard", () => {
    const onToggle = vi.fn()
    const { rerender } = renderMap({
      codexThreadImportAvailable: false,
      codexThreadImportEnabled: false,
      onToggleCodexThreadImport: onToggle,
    })

    const disabledButton = screen.getByRole("button", { name: "Codex thread取り込みをONにする" })
    expect(disabledButton).toBeDisabled()

    rerender(
      <CustomMindMapView
        project={{ ...project, repo_path: "/Users/me/project", codex_thread_import_enabled: true } as Project}
        groups={[makeTask({ id: "root-1", title: "Root task" })]}
        tasks={[makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })]}
        collapsedTaskIds={new Set()}
        selectedNodeId={null}
        selectedNodeIds={new Set()}
        onSelectNode={vi.fn()}
        onSelectNodes={vi.fn()}
        onToggleCollapse={vi.fn()}
        codexThreadImportAvailable
        codexThreadImportEnabled
        codexThreadImportRepoPath="/Users/me/project"
        onToggleCodexThreadImport={onToggle}
      />
    )

    const enabledButton = screen.getByRole("button", { name: "Codex thread取り込みをOFFにする" })
    expect(enabledButton).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(enabledButton)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  test("hides the map-level Codex import toggle on mobile", () => {
    renderMap({
      isMobile: true,
      codexThreadImportAvailable: true,
      codexThreadImportEnabled: true,
      codexThreadImportRepoPath: "/Users/me/project",
      onToggleCodexThreadImport: vi.fn(),
    })

    expect(screen.queryByRole("button", { name: "Codex thread取り込みをOFFにする" })).not.toBeInTheDocument()
  })

  test("drops an imported Codex chat onto a map node as a child", () => {
    const onDropImportedChatNode = vi.fn()
    renderMap({ onDropImportedChatNode })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const node = getNode("Root task", "root-1")
    const dataTransfer = {
      types: [CODEX_CHAT_IMPORT_DRAG_TYPE],
      dropEffect: "copy",
      getData: vi.fn((type: string) => (
        type === CODEX_CHAT_IMPORT_DRAG_TYPE
          ? encodeCodexChatImportDragPayload({ taskId: "chat-node-1" })
          : ""
      )),
    }
    const eventInit = {
      dataTransfer,
      ...getNodeClientPoint(node),
    }

    dispatchCodexImportDragEvent(viewport, "dragOver", eventInit)
    dispatchCodexImportDragEvent(viewport, "drop", eventInit)

    expect(onDropImportedChatNode).toHaveBeenCalledWith({
      taskId: "chat-node-1",
      targetId: "root-1",
      position: "as-child",
    })
  })

  test("drops an imported Codex chat onto blank map space as a root branch", () => {
    const onDropImportedChatNode = vi.fn()
    renderMap({ importedChatDragTitle: "取り込みたいチャット", onDropImportedChatNode })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const dataTransfer = {
      types: [CODEX_CHAT_IMPORT_DRAG_TYPE],
      dropEffect: "copy",
      getData: vi.fn((type: string) => (
        type === CODEX_CHAT_IMPORT_DRAG_TYPE
          ? encodeCodexChatImportDragPayload({ taskId: "chat-node-1", title: "取り込みたいチャット" })
          : ""
      )),
    }

    fireEvent.dragOver(viewport, { dataTransfer })
    expect(screen.getByTestId("codex-chat-import-map-drop-overlay")).toBeInTheDocument()

    fireEvent.drop(viewport, { dataTransfer })

    expect(onDropImportedChatNode).toHaveBeenCalledWith({
      taskId: "chat-node-1",
      targetId: "project-root",
      position: "as-child",
    })
  })

  test("previews the parent node and drops an imported Codex chat near that node", () => {
    const onDropImportedChatNode = vi.fn()
    renderMap({ importedChatDragTitle: "取り込みたいチャット", onDropImportedChatNode })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const node = getNode("Root task", "root-1")
    const dataTransfer = {
      types: [CODEX_CHAT_IMPORT_DRAG_TYPE],
      dropEffect: "copy",
      getData: vi.fn((type: string) => (
        type === CODEX_CHAT_IMPORT_DRAG_TYPE
          ? encodeCodexChatImportDragPayload({ taskId: "chat-node-1", title: "取り込みたいチャット" })
          : ""
      )),
    }
    const eventInit = {
      dataTransfer,
      ...getNodeClientPoint(node),
    }

    dispatchCodexImportDragEvent(viewport, "dragOver", eventInit)

    expect(screen.getByText("子ノードにする")).toBeInTheDocument()
    expect(screen.getByTestId("codex-chat-import-drop-badge")).toHaveTextContent("ここに紐づく")
    expect(screen.getByTestId("codex-chat-import-ghost-node")).toHaveTextContent("取り込みたいチャット")

    dispatchCodexImportDragEvent(viewport, "dragOver", eventInit)
    dispatchCodexImportDragEvent(viewport, "drop", eventInit)

    expect(onDropImportedChatNode).toHaveBeenCalledWith({
      taskId: "chat-node-1",
      targetId: "root-1",
      position: "as-child",
    })
  })

  test("clears stale node import badges after dropping an imported Codex chat", async () => {
    const onDropImportedChatNode = vi.fn()
    renderMap({ importedChatDragTitle: "取り込みたいチャット", onDropImportedChatNode })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const node = getNode("Root task", "root-1")
    const dataTransfer = {
      types: [CODEX_CHAT_IMPORT_DRAG_TYPE],
      dropEffect: "copy",
      getData: vi.fn((type: string) => (
        type === CODEX_CHAT_IMPORT_DRAG_TYPE
          ? encodeCodexChatImportDragPayload({ taskId: "chat-node-1", title: "取り込みたいチャット" })
          : ""
      )),
    }

    fireEvent.dragOver(node, { dataTransfer })

    expect(screen.getByText("ここに入れる")).toBeInTheDocument()

    fireEvent.drop(viewport, { dataTransfer })

    await waitFor(() => {
      expect(screen.queryByText("ここに入れる")).not.toBeInTheDocument()
    })
    expect(onDropImportedChatNode).toHaveBeenCalledWith({
      taskId: "chat-node-1",
      targetId: "project-root",
      position: "as-child",
    })
  })

  test("drops an imported Codex chat below a node as a sibling", () => {
    const onDropImportedChatNode = vi.fn()
    renderMap({ importedChatDragTitle: "取り込みたいチャット", onDropImportedChatNode })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const node = getNode("Root task", "root-1")
    const dataTransfer = {
      types: [CODEX_CHAT_IMPORT_DRAG_TYPE],
      dropEffect: "copy",
      getData: vi.fn((type: string) => (
        type === CODEX_CHAT_IMPORT_DRAG_TYPE
          ? encodeCodexChatImportDragPayload({ taskId: "chat-node-1", title: "取り込みたいチャット" })
          : ""
      )),
    }
    const eventInit = {
      dataTransfer,
      ...getNodeClientPoint(node, 0.92),
    }

    dispatchCodexImportDragEvent(viewport, "dragOver", eventInit)

    expect(screen.getByText("下に並べる")).toBeInTheDocument()

    dispatchCodexImportDragEvent(viewport, "drop", eventInit)

    expect(onDropImportedChatNode).toHaveBeenCalledWith({
      taskId: "chat-node-1",
      targetId: "root-1",
      position: "below",
    })
  })

  test("prioritizes ai task status over stale task progress on node badge", () => {
    renderMap({
      codexRunByNodeId: {
        "root-1": {
          state: "running",
          taskId: "ai-task-1",
          label: "実行中",
          updatedAt: "2026-06-07T00:00:03.000Z",
        },
      },
      taskProgressByNodeId: {
        "root-1": {
          id: "ai-task-1",
          title: "Root task",
          status: "awaiting_approval",
          executor: "codex_app",
          codex_thread_id: "thread-1",
          current_step: "古いsnapshot",
          progress_percent: null,
          summary: null,
          updated_at: "2026-06-07T00:00:00.000Z",
          source_type: "mindmap",
          source_id: "root-1",
        },
      },
    })

    const node = getNode("Root task", "root-1")
    expect(within(node).getByRole("button", { name: "Codex状態: 実行中 を開く" })).toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "Codex状態: 確認待ち を開く" })).not.toBeInTheDocument()
  })

  test("counts only visible map nodes in the Codex summary", () => {
    renderMap({
      codexRunByNodeId: {
        "root-1": {
          state: "awaiting_approval",
          taskId: "ai-task-1",
          label: "確認待ち",
        },
        "not-visible": {
          state: "awaiting_approval",
          taskId: "ai-task-2",
          label: "確認待ち",
        },
      },
    })

    expect(screen.getByText("確認待ち1")).toBeInTheDocument()
    expect(screen.queryByText("確認待ち2")).not.toBeInTheDocument()
  })

  test("does not include prompt waiting in the Codex summary", () => {
    renderMap({
      codexRunByNodeId: {
        "root-1": {
          state: "prompt_waiting",
          taskId: "ai-task-1",
          label: "未送信",
        },
        "child-1": {
          state: "awaiting_approval",
          taskId: "ai-task-2",
          label: "確認待ち",
        },
      },
    })

    expect(screen.queryByText("未送信1")).not.toBeInTheDocument()
    expect(screen.getAllByText("未送信")).toHaveLength(1)
    expect(screen.getByText("確認待ち1")).toBeInTheDocument()
  })

  test("does not render legacy codex_status dots beside nodes", () => {
    const rootTask = makeTask({
      id: "root-1",
      title: "Root task",
      codex_status: "done",
    } as Partial<Task>)

    renderMap({
      groups: [rootTask],
      tasks: [],
    })

    expect(screen.queryByLabelText("Codex状態: done")).not.toBeInTheDocument()
  })

  test("does not render the zoom controls", () => {
    renderMap()

    expect(screen.queryByRole("slider", { name: "ズーム" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "縮小" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "拡大" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "全体を表示" })).not.toBeInTheDocument()
  })

  test("can start range selection from empty viewport space outside the stage", async () => {
    mockViewportRect({ width: 1600, height: 900, right: 1600, bottom: 900 })
    const onSelectNodes = vi.fn()
    renderMap({ onSelectNodes })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 1400, clientY: 820 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 0, clientY: 0 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse" })

    await waitFor(() => {
      expect(onSelectNodes).toHaveBeenCalled()
    })
    const [selectedIds, primaryId] = onSelectNodes.mock.calls.at(-1) ?? []
    expect(selectedIds).toEqual(expect.arrayContaining(["root-1", "child-1"]))
    expect(primaryId).toBe("root-1")
  })

  test("duplicates a dragged node instead of moving it when Option is held on drop", async () => {
    mockViewportRect({ width: 1600, height: 900, right: 1600, bottom: 900 })
    const onDuplicateTasks = vi.fn()
    const onMoveTask = vi.fn()
    renderMap({ onDuplicateTasks, onMoveTask })

    const rootNode = getNode("Root task", "root-1")
    fireEvent.pointerDown(rootNode, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 280, clientY: 280 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "mouse", clientX: 360, clientY: 280 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "mouse", clientX: 360, clientY: 280, altKey: true })

    await waitFor(() => {
      expect(onDuplicateTasks).toHaveBeenCalledWith({
        taskIds: ["root-1"],
        targetId: "root-1",
        position: "below",
      })
    })
    expect(onMoveTask).not.toHaveBeenCalled()
  })

  test("starts mobile task dragging from touch movement without waiting for long press", async () => {
    mockViewportRect()
    renderMap({ isMobile: true })

    const rootNode = getNode("Root task", "root-1")
    const initialLeft = parseFloat(rootNode.style.left)

    fireEvent.pointerDown(rootNode, { button: 0, pointerId: 1, pointerType: "touch", clientX: 280, clientY: 280 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 330, clientY: 280 })

    await waitFor(() => {
      expect(parseFloat(rootNode.style.left)).toBeGreaterThan(initialLeft + 40)
    })
    expect(screen.queryByLabelText("ノード名")).not.toBeInTheDocument()
  })

  test("clears text selection and locks user selection while a mobile node drag is active", async () => {
    mockViewportRect()
    renderMap({ isMobile: true })

    const rootText = screen.getByText("Root task")
    const range = document.createRange()
    range.selectNodeContents(rootText)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    expect(selection?.toString()).toBe("Root task")

    const rootNode = getNode("Root task", "root-1")
    fireEvent.pointerDown(rootNode, { button: 0, pointerId: 1, pointerType: "touch", clientX: 280, clientY: 280 })

    expect(window.getSelection()?.rangeCount).toBe(0)
    await waitFor(() => expect(document.body).toHaveClass("mindmap-selection-lock"))

    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "touch", clientX: 280, clientY: 280 })

    await waitFor(() => expect(document.body).not.toHaveClass("mindmap-selection-lock"))
  })

  test("auto-pans the mobile viewport while a dragged task is held near the edge", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 })
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 })
    mockViewportRect({ width: 1120, height: 720, right: 1120, bottom: 720 })
    const rafCallbacks: FrameRequestCallback[] = []
    let nextFrameId = 1
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      rafCallbacks.push(callback)
      return nextFrameId++
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})
    renderMap({ isMobile: true })

    const rootNode = getNode("Root task", "root-1")
    const stage = screen.getByTestId("custom-mind-map-stage")

    fireEvent.pointerDown(rootNode, { button: 0, pointerId: 1, pointerType: "touch", clientX: 320, clientY: 280 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 386, clientY: 280 })

    await waitFor(() => expect(rafCallbacks.length).toBeGreaterThan(0))
    await act(async () => {
      const callback = rafCallbacks.shift()
      callback?.(16)
    })

    const match = /translate3d\((-?\d+(?:\.\d+)?)px, (-?\d+(?:\.\d+)?)px, 0\)/.exec(stage.style.transform)
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeLessThan(-20)
    expect(Number(match?.[2])).toBeCloseTo(4)
  })

  test("does not open the mobile title editor from the click after a touch drag", () => {
    mockViewportRect()
    renderMap({ isMobile: true })

    const rootNode = getNode("Root task", "root-1")
    fireEvent.pointerDown(rootNode, { button: 0, pointerId: 1, pointerType: "touch", clientX: 280, clientY: 280 })
    fireEvent.pointerMove(window, { pointerId: 1, pointerType: "touch", clientX: 330, clientY: 280 })
    fireEvent.pointerUp(window, { pointerId: 1, pointerType: "touch", clientX: 330, clientY: 280 })
    fireEvent.click(rootNode)

    expect(screen.queryByLabelText("ノード名")).not.toBeInTheDocument()
  })

  test("adds a child with Tab and a sibling with Enter", async () => {
    const onAddChildNode = vi.fn()
    const onAddSiblingNode = vi.fn()

    renderMap({
      onAddChildNode,
      onAddSiblingNode,
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const node = getNode("Root task", "root-1")
    fireEvent.keyDown(node, { key: "Tab" })
    await waitFor(() => expect(onAddChildNode).toHaveBeenCalledWith("root-1"))

    fireEvent.keyDown(node, { key: "Enter" })
    await waitFor(() => expect(onAddSiblingNode).toHaveBeenCalledWith("root-1"))
  })

  test("blurs the source node before desktop add shortcuts create the next editable node", async () => {
    const onAddChildNode = vi.fn()
    const onAddSiblingNode = vi.fn()

    renderMap({
      onAddChildNode,
      onAddSiblingNode,
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const node = getNode("Root task", "root-1")

    node.focus()
    expect(document.activeElement).toBe(node)
    fireEvent.keyDown(node, { key: "Tab" })
    await waitFor(() => expect(onAddChildNode).toHaveBeenCalledWith("root-1"))
    expect(document.activeElement).not.toBe(node)

    node.focus()
    expect(document.activeElement).toBe(node)
    fireEvent.keyDown(node, { key: "Enter" })
    await waitFor(() => expect(onAddSiblingNode).toHaveBeenCalledWith("root-1"))
    expect(document.activeElement).not.toBe(node)
  })

  test("returns desktop edit focus immediately so rapid Enter creates the next node", async () => {
    const onSaveTitle = vi.fn(() => new Promise<void>(() => {}))
    const onAddSiblingNode = vi.fn()

    renderMap({
      onSaveTitle,
      onAddSiblingNode,
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const node = getNode("Root task", "root-1")
    fireEvent.doubleClick(node)
    const input = screen.getByDisplayValue("Root task")
    fireEvent.change(input, { target: { value: "Renamed root" } })

    fireEvent.keyDown(input, { key: "Enter" })

    expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Renamed root")
    expect(document.activeElement).toBe(node)

    fireEvent.keyDown(node, { key: "Enter" })

    expect(onAddSiblingNode).toHaveBeenCalledWith("root-1")
  })

  test("opens node detail directly from the three-dot button", () => {
    const onRunCodex = vi.fn()

    renderMap({ onRunCodex })

    const node = getNode("Root task", "root-1")
    fireEvent.click(within(node).getByRole("button", { name: "ノード詳細を開く" }))

    expect(onRunCodex).toHaveBeenCalledWith("root-1")
    expect(within(node).queryByRole("button", { name: "Codexを開く" })).not.toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "日時を指定する" })).not.toBeInTheDocument()
  })

  test("shows the heading generation button only for nodes that wrap to three or more lines", async () => {
    const onGenerateHeadingFromLongNode = vi.fn()
    const onSelectNode = vi.fn()
    const longRoot = makeTask({
      id: "root-1",
      title: "一行目\n二行目\n三行目",
    })
    const shortChild = makeTask({
      id: "child-1",
      title: "一行目\n二行目",
      parent_task_id: "root-1",
    })

    renderMap({
      groups: [longRoot],
      tasks: [shortChild],
      onGenerateHeadingFromLongNode,
      onSelectNode,
    })

    const longNode = document.querySelector('[data-id="root-1"]')
    const shortNode = document.querySelector('[data-id="child-1"]')
    if (!(longNode instanceof HTMLElement) || !(shortNode instanceof HTMLElement)) {
      throw new Error("nodes not rendered")
    }

    const generateButton = within(longNode).getByRole("button", { name: "長いノードをメモ化して見出し生成" })
    expect(within(shortNode).queryByRole("button", { name: "長いノードをメモ化して見出し生成" })).not.toBeInTheDocument()

    fireEvent.click(generateButton)

    await waitFor(() => expect(onGenerateHeadingFromLongNode).toHaveBeenCalledWith("root-1"))
    expect(onSelectNode).not.toHaveBeenCalled()
  })

  test("keeps the heading generation button for unsent Codex nodes", () => {
    const longRoot = makeTask({
      id: "root-1",
      title: "一行目\n二行目\n三行目",
    })

    renderMap({
      groups: [longRoot],
      tasks: [],
      onGenerateHeadingFromLongNode: vi.fn(),
      codexRunByNodeId: {
        "root-1": {
          state: "prompt_waiting",
          taskId: "ai-task-1",
          label: "未送信",
        },
      },
      taskProgressByNodeId: {
        "root-1": {
          id: "ai-task-1",
          title: longRoot.title,
          status: "pending",
          executor: "codex_app",
          codex_thread_id: null,
          current_step: null,
          progress_percent: null,
          summary: null,
          updated_at: "2026-06-07T00:00:00.000Z",
          source_type: "mindmap",
          source_id: "root-1",
        },
      },
    })

    const node = document.querySelector('[data-id="root-1"]')
    if (!(node instanceof HTMLElement)) {
      throw new Error("node not rendered")
    }

    expect(within(node).getByRole("button", { name: "長いノードをメモ化して見出し生成" })).toBeInTheDocument()
  })

  test("hides the heading generation button for Codex nodes that already left unsent state", () => {
    const longRoot = makeTask({
      id: "root-1",
      title: "一行目\n二行目\n三行目",
    })
    const reviewChild = makeTask({
      id: "child-1",
      title: "一行目\n二行目\n三行目",
      parent_task_id: "root-1",
    })

    renderMap({
      groups: [longRoot],
      tasks: [reviewChild],
      onGenerateHeadingFromLongNode: vi.fn(),
      codexRunByNodeId: {
        "root-1": {
          state: "running",
          taskId: "ai-task-1",
          label: "実行中",
        },
      },
      taskProgressByNodeId: {
        "child-1": {
          id: "ai-task-2",
          title: reviewChild.title,
          status: "awaiting_approval",
          executor: "codex_app",
          codex_thread_id: "thread-1",
          current_step: "確認待ちです",
          progress_percent: null,
          summary: null,
          updated_at: "2026-06-07T00:00:00.000Z",
          source_type: "mindmap",
          source_id: "child-1",
        },
      },
    })

    const runningNode = document.querySelector('[data-id="root-1"]')
    const reviewNode = document.querySelector('[data-id="child-1"]')
    if (!(runningNode instanceof HTMLElement) || !(reviewNode instanceof HTMLElement)) {
      throw new Error("nodes not rendered")
    }

    expect(within(runningNode).queryByRole("button", { name: "長いノードをメモ化して見出し生成" })).not.toBeInTheDocument()
    expect(within(reviewNode).queryByRole("button", { name: "長いノードをメモ化して見出し生成" })).not.toBeInTheDocument()
  })

  test("shows completed on the Codex badge when the linked node is checked", () => {
    const completedRoot = makeTask({
      id: "root-1",
      title: "Root task",
      status: "done",
    })

    renderMap({
      groups: [completedRoot],
      tasks: [],
      taskProgressByNodeId: {
        "root-1": {
          id: "ai-task-1",
          title: completedRoot.title,
          status: "awaiting_approval",
          executor: "codex_app",
          codex_thread_id: "thread-1",
          current_step: "確認待ちです",
          progress_percent: null,
          summary: null,
          updated_at: "2026-06-07T00:00:00.000Z",
          source_type: "mindmap",
          source_id: "root-1",
        },
      },
    })

    const node = document.querySelector('[data-id="root-1"]')
    if (!(node instanceof HTMLElement)) {
      throw new Error("node not rendered")
    }

    expect(within(node).getByRole("button", { name: "Codex状態: 完了済み を開く" })).toBeInTheDocument()
    expect(within(node).queryByText("確認待ち")).not.toBeInTheDocument()
  })

  test("keeps the heading generation indicator visible while a shortened node is still generating", () => {
    renderMap({
      groups: [makeTask({ id: "root-1", title: "短い仮見出し" })],
      tasks: [],
      onGenerateHeadingFromLongNode: vi.fn(),
      generatingHeadingNodeIds: new Set(["root-1"]),
    })

    const node = document.querySelector('[data-id="root-1"]')
    if (!(node instanceof HTMLElement)) {
      throw new Error("node not rendered")
    }

    const generateButton = within(node).getByRole("button", { name: "長いノードをメモ化して見出し生成" })
    expect(generateButton).toBeDisabled()
  })

  test("promotes with Shift+Tab and saves inline edits", async () => {
    const onPromoteNode = vi.fn()
    const onSaveTitle = vi.fn()

    renderMap({
      onPromoteNode,
      onSaveTitle,
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const node = getNode("Root task", "root-1")
    fireEvent.keyDown(node, { key: "Tab", shiftKey: true })
    await waitFor(() => expect(onPromoteNode).toHaveBeenCalledWith("root-1"))

    fireEvent.doubleClick(node)
    const input = screen.getByDisplayValue("Root task")
    fireEvent.change(input, { target: { value: "Renamed root" } })
    fireEvent.keyDown(input, { key: "Enter" })

    await waitFor(() => expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Renamed root"))
  })

  test("adds a root node from the project node with Tab", async () => {
    const onAddRootNode = vi.fn()

    renderMap({
      onAddRootNode,
      selectedNodeId: "project-root",
      selectedNodeIds: new Set(["project-root"]),
    })

    const projectNode = screen.getByRole("button", { name: "Project" })
    fireEvent.keyDown(projectNode, { key: "Tab" })

    await waitFor(() => expect(onAddRootNode).toHaveBeenCalled())
  })

  test("keeps a newly created empty node blank while entering edit mode", async () => {
    const blankRoot = makeTask({ id: "root-1", title: "" })

    renderMap({
      groups: [blankRoot],
      tasks: [],
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const input = await screen.findByDisplayValue("")
    expect(input).toHaveFocus()
  })

  test("saves an active desktop node edit when the map background is pressed", async () => {
    const onSaveTitle = vi.fn()
    const blankRoot = makeTask({ id: "root-1", title: "" })

    renderMap({
      groups: [blankRoot],
      tasks: [],
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onSaveTitle,
    })

    const input = await screen.findByDisplayValue("")
    fireEvent.change(input, { target: { value: "背景タップで確定" } })

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 240 })

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "背景タップで確定")
      expect(screen.queryByDisplayValue("背景タップで確定")).not.toBeInTheDocument()
    })
  })

  test("previews wrapped node height while typing a long desktop title", async () => {
    const blankRoot = makeTask({ id: "root-1", title: "" })

    renderMap({
      groups: [blankRoot],
      tasks: [],
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const input = await screen.findByDisplayValue("")
    const node = document.querySelector('[data-id="root-1"]')
    if (!(node instanceof HTMLElement)) throw new Error("root node not rendered")
    const initialHeight = parseFloat(node.style.minHeight)

    fireEvent.change(input, {
      target: { value: "されているのはないかなどうするのがいいのかな" },
    })

    await waitFor(() => {
      expect(parseFloat(node.style.minHeight)).toBeGreaterThan(initialHeight)
    })
  })

  test("starts task title editing with a single tap on mobile", async () => {
    renderMap({ isMobile: true })

    fireEvent.click(getNode("Root task", "root-1"))

    const input = await screen.findByLabelText("ノード名")
    expect(input).toHaveValue("Root task")
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByTestId("floating-mind-map-editor")).toBeInTheDocument()
  })

  test("does not start mobile title editing while choosing a Codex import destination", () => {
    const onSelectNode = vi.fn()
    renderMap({ isMobile: true, mobilePlacementMode: true, onSelectNode })

    fireEvent.click(getNode("Root task", "root-1"))

    expect(onSelectNode).toHaveBeenCalledWith("root-1")
    expect(screen.queryByLabelText("ノード名")).not.toBeInTheDocument()
    expect(screen.queryByTestId("floating-mind-map-editor")).not.toBeInTheDocument()
  })

  test("restores and saves mobile collapsed node state through the task record", async () => {
    const rootTask = makeTask({ id: "root-1", title: "Root task", mindmap_collapsed: true })
    const childTask = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask]}
        tasks={[childTask]}
        onUpdateTask={onUpdateTask}
      />
    )

    const rootNode = getNode("Root task", "root-1")
    expect(within(rootNode).getByTitle("1件の子を展開")).toBeInTheDocument()
    expect(screen.queryByText("Child task")).not.toBeInTheDocument()

    fireEvent.click(within(rootNode).getByTitle("1件の子を展開"))

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", { mindmap_collapsed: false })
      expect(screen.getByText("Child task")).toBeInTheDocument()
    })
  })

  test("keeps a mobile local collapse action when stale task props re-render before save catches up", async () => {
    const rootTask = makeTask({ id: "root-1", title: "Root task", mindmap_collapsed: false })
    const childTask = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)

    const view = render(
      <MobileMindMap
        project={project}
        groups={[rootTask]}
        tasks={[childTask]}
        onUpdateTask={onUpdateTask}
      />
    )

    fireEvent.click(within(getNode("Root task", "root-1")).getByTitle("折りたたむ"))

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", { mindmap_collapsed: true })
      expect(screen.queryByText("Child task")).not.toBeInTheDocument()
    })

    view.rerender(
      <MobileMindMap
        project={project}
        groups={[{ ...rootTask, title: "Root task updated", mindmap_collapsed: false }]}
        tasks={[childTask]}
        onUpdateTask={onUpdateTask}
      />
    )

    expect(screen.queryByText("Child task")).not.toBeInTheDocument()
  })

  test("saves mobile auto-expand when adding a child under a collapsed node", async () => {
    installOpenKeyboardViewport()
    const rootTask = makeTask({ id: "root-1", title: "Root task", mindmap_collapsed: true })
    const existingChild = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })
    const newChild = makeTask({ id: "child-new", title: "", parent_task_id: "root-1" })
    const onCreateTask = vi.fn().mockResolvedValue(newChild)
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask]}
        tasks={[existingChild]}
        focusEditNodeId="root-1"
        onCreateTask={onCreateTask}
        onUpdateTask={onUpdateTask}
      />
    )

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "子ノード追加" }))

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", { mindmap_collapsed: false })
      expect(onCreateTask).toHaveBeenCalledWith("root-1", "", "root-1")
    })
  })

  test("passes mobile detail schedule updates through the same task updater as desktop", async () => {
    const rootTask = makeTask({
      id: "root-1",
      title: "Root task",
      estimated_time: 15,
      calendar_id: null,
    })
    const onUpdateTask = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === "/api/tasks/root-1") {
        return jsonResponse({
          task: {
            ...rootTask,
            memo: "",
            scheduled_at: null,
            google_event_id: null,
          },
        })
      }
      if (url === "/api/tasks/root-1/attachments") {
        return jsonResponse({ attachments: [] })
      }
      return jsonResponse({})
    }))

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask]}
        tasks={[]}
        onUpdateTask={onUpdateTask}
      />
    )

    fireEvent.click(within(getNode("Root task", "root-1")).getByRole("button", { name: "ノード詳細を開く" }))
    const scheduleSection = await screen.findByTestId("codex-node-schedule-section")
    fireEvent.click(within(scheduleSection).getByRole("button", { name: "30分" }))

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith("root-1", { estimated_time: 30 })
    })
  })

  test("does not render Codex Inbox or unplaced imported chats on the mobile map", () => {
    const rootTask = makeTask({ id: "root-1", title: "Root task" })
    const inboxGroup = makeTask({
      id: "inbox-1",
      title: "Codex Inbox",
      source: "codex_inbox",
    })
    const unplacedChat = makeTask({
      id: "chat-node-1",
      title: "未配置のCodexチャット",
      parent_task_id: "inbox-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
    })
    const placedChat = makeTask({
      id: "chat-node-2",
      title: "配置済みCodexチャット",
      parent_task_id: "root-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
    })

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask, inboxGroup]}
        tasks={[unplacedChat, placedChat]}
      />
    )

    expect(screen.getByText("Root task")).toBeInTheDocument()
    expect(screen.getByText("配置済みCodexチャット")).toBeInTheDocument()
    expect(screen.queryByText("Codex Inbox")).not.toBeInTheDocument()
    expect(screen.queryByText("未配置のCodexチャット")).not.toBeInTheDocument()
  })

  test("shows a running Codex import on the mobile map immediately after dragging it onto a node", async () => {
    const rootTask = makeTask({
      id: "root-1",
      title: "Root task",
      codex_work_dir: "/Users/me/focusmap",
    })
    const inboxGroup = makeTask({
      id: "inbox-1",
      title: "Codex Inbox",
      source: "codex_inbox",
    })
    const importedChat = makeTask({
      id: "chat-node-1",
      title: "実行中Codexチャット",
      parent_task_id: "inbox-1",
      source: "codex_app_thread",
      codex_work_dir: "/Users/me/focusmap",
      codex_thread_id: "thread-1",
    })
    const projectWithRepo = {
      ...project,
      repo_path: "/Users/me/focusmap",
      codex_thread_import_enabled: true,
    } as Project
    const onUpdateTask = vi.fn(() => new Promise<void>(() => {}))

    memoAiTasksMock.bySourceId.set("chat-node-1", makeAiTask({
      id: "ai-task-1",
      source_task_id: "chat-node-1",
      status: "running",
      result: {
        codex_run_state: "running",
        last_activity_at: "2026-06-12T10:00:30.000Z",
      },
    }))

    const view = render(
      <MobileMindMap
        project={projectWithRepo}
        groups={[rootTask, inboxGroup]}
        tasks={[importedChat]}
        allTasks={[rootTask, inboxGroup, importedChat]}
        onUpdateTask={onUpdateTask}
        codexOpenSignal={0}
      />
    )

    expect(screen.queryByText("実行中Codexチャット")).not.toBeInTheDocument()

    view.rerender(
      <MobileMindMap
        project={projectWithRepo}
        groups={[rootTask, inboxGroup]}
        tasks={[importedChat]}
        allTasks={[rootTask, inboxGroup, importedChat]}
        onUpdateTask={onUpdateTask}
        codexOpenSignal={1}
      />
    )

    const rootPoint = getNodeClientPoint(getNode("Root task", "root-1"))
    const importCard = await screen.findByLabelText("「実行中Codexチャット」のチャットを見る")

    fireEvent.pointerDown(importCard, {
      pointerId: 9,
      pointerType: "touch",
      button: 0,
      clientX: rootPoint.clientX,
      clientY: rootPoint.clientY + 240,
    })
    fireEvent.pointerMove(window, {
      pointerId: 9,
      pointerType: "touch",
      clientX: rootPoint.clientX,
      clientY: rootPoint.clientY,
    })

    await waitFor(() => {
      expect(screen.getByTestId("mobile-codex-chat-import-drag-ghost")).toHaveTextContent("実行中Codexチャット")
    })

    fireEvent.pointerUp(window, {
      pointerId: 9,
      pointerType: "touch",
      clientX: rootPoint.clientX,
      clientY: rootPoint.clientY,
    })

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith("chat-node-1", {
        parent_task_id: "root-1",
        project_id: "project-1",
      })
      expect(screen.getByText("実行中Codexチャット")).toBeInTheDocument()
    })

    const placedNode = getNode("実行中Codexチャット", "chat-node-1")
    expect(within(placedNode).getByRole("button", { name: "Codex状態: 実行中 を開く" })).toBeInTheDocument()
    expect(within(placedNode).getByLabelText("Codex 実行中")).toHaveClass("codex-node-running-orbit")
  })

  test("focuses an externally requested first mobile root node", async () => {
    installOpenKeyboardViewport()
    const firstRoot = makeTask({ id: "root-1", title: "" })

    render(
      <MobileMindMap
        project={project}
        groups={[firstRoot]}
        tasks={[]}
        focusEditNodeId="root-1"
      />
    )

    const input = await screen.findByLabelText("ノード名")
    expect(input).toHaveValue("")
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByTestId("floating-mind-map-editor")).toBeInTheDocument()
  })

  test("tracks an externally requested first mobile root node above the keyboard", async () => {
    installOpenKeyboardViewport(120)
    mockViewportRect()
    const firstRoot = makeTask({ id: "root-1", title: "" })

    render(
      <MobileMindMap
        project={project}
        groups={[firstRoot]}
        tasks={[]}
        focusEditNodeId="root-1"
      />
    )

    await screen.findByLabelText("ノード名")
    const stage = screen.getByTestId("custom-mind-map-stage")

    await waitFor(() => {
      expect(stage.style.transform).toMatch(/translate3d\(-20px, -\d+(?:\.\d+)?px, 0\) scale\(0\.85\)/)
    })
  })

  test("selects the full mobile node title when editing starts", async () => {
    renderMap({ isMobile: true })

    fireEvent.click(getNode("Root task", "root-1"))

    const input = await screen.findByLabelText("ノード名")
    await waitFor(() => expect(input).toHaveFocus())
    expect((input as HTMLTextAreaElement).selectionStart).toBe(0)
    expect((input as HTMLTextAreaElement).selectionEnd).toBe("Root task".length)
  })

  test("aligns the mobile floating editor to the active node screen coordinates", async () => {
    renderMap({ isMobile: true })

    fireEvent.click(getNode("Root task", "root-1"))

    const editor = await screen.findByTestId("floating-mind-map-editor")
    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const stage = screen.getByTestId("custom-mind-map-stage")
    const node = document.querySelector('[data-id="root-1"]')
    if (!(node instanceof HTMLElement)) throw new Error("root node not rendered")

    const nodeLeft = parseFloat(node.style.left)
    const nodeTop = parseFloat(node.style.top)
    const nodeWidth = parseFloat(node.style.width)
    const nodeHeight = parseFloat(node.style.minHeight)
    const editorWidth = Math.max(nodeWidth * 0.85, 120)
    const editorHeight = Math.max(nodeHeight * 0.85, 34)

    expect(editor.parentElement).toBe(viewport)
    expect(editor.closest('[data-testid="custom-mind-map-stage"]')).toBeNull()
    expect(parseFloat(editor.style.width)).toBeCloseTo(Math.round(editorWidth), 0)
    expect(parseFloat(editor.style.minHeight)).toBeCloseTo(Math.round(editorHeight), 0)
    expect(parseFloat(editor.style.left)).toBeCloseTo(Math.round(-20 + (nodeLeft + nodeWidth / 2) * 0.85 - editorWidth / 2), 0)
    expect(parseFloat(editor.style.top)).toBeCloseTo(Math.round(4 + (nodeTop + nodeHeight / 2) * 0.85 - editorHeight / 2), 0)
    expect(stage).toHaveStyle("transform: translate3d(-20px, 4px, 0) scale(0.85)")
  })

  test("closes the mobile floating editor when the map background is tapped", async () => {
    const onSaveTitle = vi.fn()
    const onSelectNode = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onSaveTitle,
      onSelectNode,
    })

    const input = await screen.findByLabelText("ノード名")
    fireEvent.change(input, { target: { value: "Saved from background" } })
    fireEvent.click(screen.getByTestId("custom-mind-map-viewport"))

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Saved from background")
      expect(screen.queryByTestId("floating-mind-map-editor")).not.toBeInTheDocument()
    })
    expect(onSelectNode).toHaveBeenCalledWith(null)
  })

  test("closes the mobile floating editor on a touch background press before a click event", async () => {
    const onSaveTitle = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onSaveTitle,
    })

    const input = await screen.findByLabelText("ノード名")
    fireEvent.change(input, { target: { value: "Saved from touch" } })
    const viewport = screen.getByTestId("custom-mind-map-viewport")
    viewport.setPointerCapture = vi.fn()
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, pointerType: "touch", clientX: 24, clientY: 24 })

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Saved from touch")
      expect(screen.queryByTestId("floating-mind-map-editor")).not.toBeInTheDocument()
    })
  })

  test("does not reset the mobile floating editor selection on every input change", async () => {
    const selectionSpy = vi.spyOn(HTMLTextAreaElement.prototype, "setSelectionRange")

    renderMap({ isMobile: true })
    fireEvent.click(getNode("Root task", "root-1"))

    const input = await screen.findByLabelText("ノード名")
    await waitFor(() => expect(input).toHaveFocus())
    selectionSpy.mockClear()
    fireEvent.change(input, { target: { value: "あ" } })

    expect(selectionSpy).not.toHaveBeenCalled()
    selectionSpy.mockRestore()
  })

  test("mirrors text from the mobile keyboard anchor when focus transfer fails", async () => {
    installOpenKeyboardViewport()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const visibleInput = await screen.findByLabelText("ノード名")
    const keyboardAnchor = screen.getByTestId("mobile-keyboard-anchor")

    await act(async () => {
      keyboardAnchor.focus()
      fireEvent.change(keyboardAnchor, { target: { value: "Proxy typed text" } })
    })

    await waitFor(() => expect(visibleInput).toHaveValue("Proxy typed text"))
  })

  test("moves the edited mobile node above the keyboard viewport", async () => {
    installOpenKeyboardViewport(120)
    mockViewportRect()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const stage = screen.getByTestId("custom-mind-map-stage")

    await waitFor(() => {
      expect(stage.style.transform).toMatch(/translate3d\(-20px, -\d+(?:\.\d+)?px, 0\) scale\(0\.85\)/)
    })
  })

  test("pans the stage with a two-finger wheel gesture", async () => {
    renderMap()

    const viewport = screen.getByTestId("custom-mind-map-viewport")
    const stage = screen.getByTestId("custom-mind-map-stage")

    fireEvent.wheel(viewport, { deltaX: 40, deltaY: 24, clientX: 320, clientY: 240 })

    await waitFor(() => {
      expect(stage).toHaveStyle("transform: translate3d(-40px, -24px, 0) scale(0.9)")
    })
  })

  test("resizes a task node from the right edge and commits the width", async () => {
    const onResizeNode = vi.fn()
    renderMap({
      onResizeNode,
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    const node = getNode("Root task", "root-1")
    const initialWidth = parseFloat(node.style.width)
    const handle = within(node).getByRole("separator", { name: "ノード幅を変更" })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 145 })

    await waitFor(() => {
      expect(parseFloat(node.style.width)).toBeGreaterThan(initialWidth)
    })

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 145 })

    await waitFor(() => {
      expect(onResizeNode).toHaveBeenCalledWith("root-1", expect.any(Number))
    })
    const committedWidth = onResizeNode.mock.calls.at(-1)?.[1] as number
    expect(committedWidth).toBeGreaterThan(initialWidth)
  })

  test("checks a task immediately and keeps it visible on the map", async () => {
    vi.useFakeTimers()
    const onUpdateStatus = vi.fn(() => Promise.resolve())

    renderMap({ onUpdateStatus })

    const node = getNode("Root task", "root-1")
    const checkbox = within(node).getByRole("checkbox", { name: "完了にする" })

    await act(async () => {
      fireEvent.click(checkbox)
    })

    expect(onUpdateStatus).toHaveBeenCalledWith("root-1", "done")
    expect(within(node).getByRole("checkbox")).toHaveAttribute("aria-checked", "true")

    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(screen.getByText("Root task")).toBeInTheDocument()
    expect(document.querySelector('[data-id="root-1"]')).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "完了の取り消し" })).not.toBeInTheDocument()
  })

  test("can uncheck a completed task from the visible node checkbox", async () => {
    vi.useFakeTimers()
    const onUpdateStatus = vi.fn(() => Promise.resolve())

    renderMap({ onUpdateStatus })

    const node = getNode("Root task", "root-1")
    await act(async () => {
      fireEvent.click(within(node).getByRole("checkbox", { name: "完了にする" }))
      vi.advanceTimersByTime(300)
    })

    expect(document.querySelector('[data-id="root-1"]')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(within(node).getByRole("checkbox", { name: "完了を取消" }))
      await Promise.resolve()
    })

    expect(onUpdateStatus).toHaveBeenNthCalledWith(1, "root-1", "done")
    expect(onUpdateStatus).toHaveBeenNthCalledWith(2, "root-1", "todo")
    expect(document.querySelector('[data-id="root-1"]')).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "完了の取り消し" })).not.toBeInTheDocument()
  })

  test("lets saved status changes from undo override the optimistic checked state", async () => {
    const onUpdateStatus = vi.fn(() => Promise.resolve())
    const rootTodo = makeTask({ id: "root-1", title: "Root task", status: "todo" })
    const rootDone = makeTask({ id: "root-1", title: "Root task", status: "done" })

    const view = (rootTask: Task) => (
      <CustomMindMapView
        project={project}
        groups={[rootTask]}
        tasks={[]}
        collapsedTaskIds={new Set()}
        selectedNodeId={null}
        selectedNodeIds={new Set()}
        onSelectNode={vi.fn()}
        onSelectNodes={vi.fn()}
        onToggleCollapse={vi.fn()}
        onUpdateStatus={onUpdateStatus}
      />
    )
    const { rerender } = render(view(rootTodo))

    const node = getNode("Root task", "root-1")
    await act(async () => {
      fireEvent.click(within(node).getByRole("checkbox", { name: "完了にする" }))
      await Promise.resolve()
    })
    expect(within(node).getByRole("checkbox")).toHaveAttribute("aria-checked", "true")

    rerender(view(rootDone))
    await waitFor(() => {
      expect(within(getNode("Root task", "root-1")).getByRole("checkbox")).toHaveAttribute("aria-checked", "true")
    })

    rerender(view(rootTodo))
    await waitFor(() => {
      expect(within(getNode("Root task", "root-1")).getByRole("checkbox", { name: "完了にする" })).toHaveAttribute("aria-checked", "false")
    })
  })

  test("does not show an undo dialog after checking a task", async () => {
    vi.useFakeTimers()
    const onUpdateStatus = vi.fn(() => Promise.resolve())

    renderMap({ onUpdateStatus })

    const node = getNode("Root task", "root-1")
    await act(async () => {
      fireEvent.click(within(node).getByRole("checkbox", { name: "完了にする" }))
      vi.advanceTimersByTime(300)
    })

    expect(screen.queryByRole("dialog", { name: "完了の取り消し" })).not.toBeInTheDocument()
  })

  test("shows the mobile keyboard accessory while editing and saves before adding a child", async () => {
    installOpenKeyboardViewport()
    const onAddChildNode = vi.fn()
    const onSaveTitle = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onAddChildNode,
      onSaveTitle,
    })

    const input = await screen.findByDisplayValue("Root task")
    fireEvent.change(input, { target: { value: "Renamed root" } })

    const closeButton = await screen.findByRole("button", { name: "キーボードを閉じる" })
    await waitFor(() => {
      expect(closeButton.parentElement?.parentElement).toHaveStyle("top: 500px")
      expect(closeButton.parentElement?.parentElement).toHaveStyle("transform: translateY(-100%)")
    })

    fireEvent.click(await screen.findByRole("button", { name: "子ノード追加" }))

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Renamed root")
      expect(onAddChildNode).toHaveBeenCalledWith("root-1")
    })
    expect(input).toHaveFocus()
  })

  test("keeps the mobile keyboard accessory pinned while editing when keyboard detection is unavailable", async () => {
    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onAddChildNode: vi.fn(),
    })

    await screen.findByDisplayValue("Root task")

    expect(await screen.findByRole("button", { name: "キーボードを閉じる" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "子ノード追加" })).toBeInTheDocument()
  })

  test("creates the next mobile node without waiting for the current title save", async () => {
    installOpenKeyboardViewport()
    const onSaveTitle = vi.fn(() => new Promise<void>(() => {}))
    const onAddSiblingNode = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onAddSiblingNode,
      onSaveTitle,
    })

    const input = await screen.findByDisplayValue("Root task")
    fireEvent.change(input, { target: { value: "Renamed root" } })
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await waitFor(() => expect(onAddSiblingNode).toHaveBeenCalledWith("root-1"))
    expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Renamed root")
  })

  test("finalizes mobile IME composition before adding the next node", async () => {
    installOpenKeyboardViewport()
    const onSaveTitle = vi.fn()
    const onAddSiblingNode = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onAddSiblingNode,
      onSaveTitle,
    })

    const input = await screen.findByDisplayValue("Root task")
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: "にれ" } })
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await act(async () => {
      await Promise.resolve()
    })
    expect(onAddSiblingNode).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "にれ")
      expect(onAddSiblingNode).toHaveBeenCalledWith("root-1")
    })
  })

  test("routes the mobile keyboard accessory parent-level action to the active node", async () => {
    installOpenKeyboardViewport()
    const onAddSiblingNode = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onAddSiblingNode,
    })

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await waitFor(() => expect(onAddSiblingNode).toHaveBeenCalledWith("root-1"))
  })

  test("shows voice input on the mobile keyboard accessory while editing a node", async () => {
    installOpenKeyboardViewport()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
    })

    await screen.findByDisplayValue("Root task")
    expect(await screen.findByRole("button", { name: "ノード名を音声入力" })).toBeInTheDocument()
  })

  test("guards mobile keyboard accessory add actions from duplicate taps", async () => {
    installOpenKeyboardViewport()
    const onAddSiblingNode = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "root-1",
      selectedNodeId: "root-1",
      selectedNodeIds: new Set(["root-1"]),
      onAddSiblingNode,
    })

    await screen.findByDisplayValue("Root task")
    const addParentButton = await screen.findByRole("button", { name: "親ノード追加" })
    fireEvent.click(addParentButton)
    fireEvent.click(addParentButton)

    await waitFor(() => expect(onAddSiblingNode).toHaveBeenCalledTimes(1))
    expect(onAddSiblingNode).toHaveBeenCalledWith("root-1")
  })

  test("focuses the newly created sibling after using the mobile keyboard accessory", async () => {
    installOpenKeyboardViewport()
    const onAddSiblingNode = vi.fn()
    const onSaveTitle = vi.fn()
    const rootTask = makeTask({ id: "root-1", title: "Root task" })
    const newSibling = makeTask({ id: "root-2", title: "", order_index: 1 })
    const commonProps = {
      project,
      tasks: [],
      isMobile: true,
      collapsedTaskIds: new Set<string>(),
      onSelectNode: vi.fn(),
      onSelectNodes: vi.fn(),
      onToggleCollapse: vi.fn(),
      onAddSiblingNode,
      onSaveTitle,
    }

    const view = render(
      <CustomMindMapView
        {...commonProps}
        groups={[rootTask]}
        pendingEditNodeId="root-1"
        selectedNodeId="root-1"
        selectedNodeIds={new Set(["root-1"])}
      />
    )

    const input = await screen.findByDisplayValue("Root task")
    fireEvent.change(input, { target: { value: "Renamed root" } })
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Renamed root")
      expect(onAddSiblingNode).toHaveBeenCalledWith("root-1")
    })

    view.rerender(
      <CustomMindMapView
        {...commonProps}
        groups={[{ ...rootTask, title: "Renamed root" }, newSibling]}
        pendingEditNodeId="root-2"
        selectedNodeId="root-2"
        selectedNodeIds={new Set(["root-2"])}
      />
    )

    await waitFor(() => {
      const newNode = document.querySelector('[data-id="root-2"]')
      if (!(newNode instanceof HTMLElement)) throw new Error("root-2 not rendered")
      const editor = screen.getByTestId("floating-mind-map-editor")
      const newInput = within(editor).getByLabelText("ノード名")
      expect(newInput).toHaveValue("")
      expect(newInput).toHaveFocus()
      expect(within(newNode).getByText("Task")).toHaveClass("opacity-0")
    })
  })

  test("inserts a new mobile root sibling directly below the selected root", async () => {
    installOpenKeyboardViewport()
    const rootTask = makeTask({ id: "root-1", title: "Root task", order_index: 0 })
    const existingNext = makeTask({ id: "root-2", title: "Existing next", order_index: 1 })
    const newSibling = makeTask({ id: "root-new", title: "", order_index: 2 })
    const onCreateGroup = vi.fn().mockResolvedValue(newSibling)
    const onReorderTask = vi.fn().mockResolvedValue(undefined)

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask, existingNext]}
        tasks={[]}
        focusEditNodeId="root-1"
        onCreateGroup={onCreateGroup}
        onReorderTask={onReorderTask}
      />
    )

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await waitFor(() => expect(onCreateGroup).toHaveBeenCalledWith(""))
    await waitFor(() => expect(onReorderTask).toHaveBeenCalledWith("root-new", "root-1", "below"))
  })

  test("inserts a new mobile child sibling directly below the selected child", async () => {
    installOpenKeyboardViewport()
    const rootTask = makeTask({ id: "root-1", title: "Root task" })
    const childTask = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1", order_index: 0 })
    const existingNext = makeTask({ id: "child-2", title: "Existing next", parent_task_id: "root-1", order_index: 1 })
    const newSibling = makeTask({ id: "child-new", title: "", parent_task_id: "root-1", order_index: 2 })
    const onCreateTask = vi.fn().mockResolvedValue(newSibling)
    const onReorderTask = vi.fn().mockResolvedValue(undefined)

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask]}
        tasks={[childTask, existingNext]}
        focusEditNodeId="child-1"
        onCreateTask={onCreateTask}
        onReorderTask={onReorderTask}
      />
    )

    await screen.findByDisplayValue("Child task")
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await waitFor(() => expect(onCreateTask).toHaveBeenCalledWith("root-1", "", "root-1"))
    await waitFor(() => expect(onReorderTask).toHaveBeenCalledWith("child-new", "child-1", "below"))
  })

  test("focuses a newly created parent-level node after creating a child first", async () => {
    installOpenKeyboardViewport()
    const onAddChildNode = vi.fn()
    const onAddSiblingNode = vi.fn()
    const onSaveTitle = vi.fn()
    const rootTask = makeTask({ id: "root-1", title: "Root task" })
    const newChild = makeTask({ id: "child-new", title: "", parent_task_id: "root-1", order_index: 1 })
    const newSibling = makeTask({ id: "child-sibling", title: "", parent_task_id: "root-1", order_index: 2 })
    const commonProps = {
      project,
      groups: [rootTask],
      isMobile: true,
      collapsedTaskIds: new Set<string>(),
      onSelectNode: vi.fn(),
      onSelectNodes: vi.fn(),
      onToggleCollapse: vi.fn(),
      onAddChildNode,
      onAddSiblingNode,
      onSaveTitle,
    }

    const view = render(
      <CustomMindMapView
        {...commonProps}
        tasks={[]}
        pendingEditNodeId="root-1"
        selectedNodeId="root-1"
        selectedNodeIds={new Set(["root-1"])}
      />
    )

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "子ノード追加" }))
    await waitFor(() => expect(onAddChildNode).toHaveBeenCalledWith("root-1"))

    view.rerender(
      <CustomMindMapView
        {...commonProps}
        tasks={[newChild]}
        pendingEditNodeId="child-new"
        selectedNodeId="child-new"
        selectedNodeIds={new Set(["child-new"])}
      />
    )

    const childInput = await screen.findByLabelText("ノード名")
    expect(childInput).toHaveValue("")
    fireEvent.change(childInput, { target: { value: "Child text" } })
    fireEvent.click(await screen.findByRole("button", { name: "親ノード追加" }))

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("child-new", "Child text")
      expect(onAddSiblingNode).toHaveBeenCalledWith("child-new")
    })

    view.rerender(
      <CustomMindMapView
        {...commonProps}
        tasks={[{ ...newChild, title: "Child text" }, newSibling]}
        pendingEditNodeId="child-sibling"
        selectedNodeId="child-sibling"
        selectedNodeIds={new Set(["child-sibling"])}
      />
    )

    await waitFor(() => {
      const editor = screen.getByTestId("floating-mind-map-editor")
      const siblingInput = within(editor).getByLabelText("ノード名")
      expect(siblingInput).toHaveValue("")
      expect(siblingInput).toHaveFocus()
    })
  })

  test("routes the mobile keyboard accessory delete action to the active node", async () => {
    installOpenKeyboardViewport()
    const onDeleteNode = vi.fn()

    renderMap({
      isMobile: true,
      pendingEditNodeId: "child-1",
      selectedNodeId: "child-1",
      selectedNodeIds: new Set(["child-1"]),
      onDeleteNode,
    })

    await screen.findByDisplayValue("Child task")
    fireEvent.click(await screen.findByRole("button", { name: "ノード削除" }))

    await waitFor(() => expect(onDeleteNode).toHaveBeenCalledWith("child-1"))
  })

  test("keeps mobile edit controls on the parent after deleting from the keyboard accessory", async () => {
    installOpenKeyboardViewport()
    const onDeleteNode = vi.fn()
    const rootTask = makeTask({ id: "root-1", title: "Root task" })
    const childTask = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })
    const commonProps = {
      project,
      groups: [rootTask],
      isMobile: true,
      collapsedTaskIds: new Set<string>(),
      onSelectNode: vi.fn(),
      onSelectNodes: vi.fn(),
      onToggleCollapse: vi.fn(),
      onDeleteNode,
    }

    const view = render(
      <CustomMindMapView
        {...commonProps}
        tasks={[childTask]}
        pendingEditNodeId="child-1"
        selectedNodeId="child-1"
        selectedNodeIds={new Set(["child-1"])}
      />
    )

    await screen.findByDisplayValue("Child task")
    fireEvent.click(await screen.findByRole("button", { name: "ノード削除" }))
    await waitFor(() => expect(onDeleteNode).toHaveBeenCalledWith("child-1"))
    await waitFor(() => {
      const input = screen.getByLabelText("ノード名")
      expect(input).toHaveValue("Root task")
      expect(input).toHaveFocus()
      expect(screen.getByRole("button", { name: "ノード削除" })).toBeInTheDocument()
    })

    view.rerender(
      <CustomMindMapView
        {...commonProps}
        tasks={[]}
        pendingEditNodeId="root-1"
        selectedNodeId="root-1"
        selectedNodeIds={new Set(["root-1"])}
      />
    )

    await waitFor(() => {
      const input = screen.getByLabelText("ノード名")
      expect(input).toHaveValue("Root task")
      expect(input).toHaveFocus()
    })
  })

  test("keeps mobile edit controls on the adjacent root after deleting a root node", async () => {
    installOpenKeyboardViewport()
    const onDeleteNode = vi.fn()
    const rootTask = makeTask({ id: "root-1", title: "Root task", order_index: 0 })
    const nextRootTask = makeTask({ id: "root-2", title: "Next root", order_index: 1 })

    render(
      <CustomMindMapView
        project={project}
        groups={[rootTask, nextRootTask]}
        tasks={[]}
        isMobile
        collapsedTaskIds={new Set<string>()}
        pendingEditNodeId="root-1"
        selectedNodeId="root-1"
        selectedNodeIds={new Set(["root-1"])}
        onSelectNode={vi.fn()}
        onSelectNodes={vi.fn()}
        onToggleCollapse={vi.fn()}
        onDeleteNode={onDeleteNode}
      />
    )

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "ノード削除" }))

    await waitFor(() => expect(onDeleteNode).toHaveBeenCalledWith("root-1"))
    await waitFor(() => {
      const input = screen.getByLabelText("ノード名")
      expect(input).toHaveValue("Next root")
      expect(input).toHaveFocus()
    })
    expect(screen.queryByLabelText("プロジェクト名")).not.toBeInTheDocument()
  })

  test("deletes a mobile node with children without a confirmation dialog", async () => {
    installOpenKeyboardViewport()
    const confirmSpy = vi.spyOn(window, "confirm")
    const onDeleteGroup = vi.fn()
    const rootTask = makeTask({ id: "root-1", title: "Root task", order_index: 0 })
    const nextRootTask = makeTask({ id: "root-2", title: "Next root", order_index: 1 })
    const childTask = makeTask({ id: "child-1", title: "Child task", parent_task_id: "root-1" })

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask, nextRootTask]}
        tasks={[childTask]}
        focusEditNodeId="root-1"
        onDeleteGroup={onDeleteGroup}
      />
    )

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "ノード削除" }))

    await waitFor(() => expect(onDeleteGroup).toHaveBeenCalledWith("root-1"))
    expect(confirmSpy).not.toHaveBeenCalled()
    await waitFor(() => {
      const input = screen.getByLabelText("ノード名")
      expect(input).toHaveValue("Next root")
      expect(input).toHaveFocus()
    })
  })

  test("moves mobile delete focus before the delete request finishes", async () => {
    installOpenKeyboardViewport()
    const onDeleteGroup = vi.fn(() => new Promise<void>(() => {}))
    const rootTask = makeTask({ id: "root-1", title: "Root task", order_index: 0 })
    const nextRootTask = makeTask({ id: "root-2", title: "Next root", order_index: 1 })

    render(
      <MobileMindMap
        project={project}
        groups={[rootTask, nextRootTask]}
        tasks={[]}
        focusEditNodeId="root-1"
        onDeleteGroup={onDeleteGroup}
      />
    )

    await screen.findByDisplayValue("Root task")
    fireEvent.click(await screen.findByRole("button", { name: "ノード削除" }))

    await waitFor(() => {
      expect(onDeleteGroup).toHaveBeenCalledWith("root-1")
      const input = screen.getByLabelText("ノード名")
      expect(input).toHaveValue("Next root")
      expect(input).toHaveFocus()
    })
  })

  test("edits the project title on mobile and adds a root node from the keyboard accessory", async () => {
    installOpenKeyboardViewport()
    const onAddRootNode = vi.fn()
    const onSaveProjectTitle = vi.fn()

    renderMap({
      isMobile: true,
      onAddRootNode,
      onSaveProjectTitle,
    })

    fireEvent.click(screen.getByRole("button", { name: "Project" }))
    const input = await screen.findByLabelText("プロジェクト名")
    fireEvent.change(input, { target: { value: "Renamed project" } })
    fireEvent.click(await screen.findByRole("button", { name: "子ノード追加" }))

    await waitFor(() => {
      expect(onSaveProjectTitle).toHaveBeenCalledWith("Renamed project")
      expect(onAddRootNode).toHaveBeenCalled()
    })
  })
})
