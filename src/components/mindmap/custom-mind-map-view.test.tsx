import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

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
    getBySourceId: () => null,
  }),
}))

import { CustomMindMapView } from "./custom-mind-map-view"
import { MobileMindMap } from "@/components/mobile/mobile-mind-map"
import type { Project, Task } from "@/types/database"

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
  is_habit: false,
  habit_end_date: null,
  ...overrides,
} as Task)

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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
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
        },
      },
    })

    expect(screen.getByText("実行中1")).toBeInTheDocument()
    expect(screen.getByLabelText("Codex 実行中")).toHaveClass("codex-node-running-orbit")
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

  test("shows prompt waiting state separately from review waiting", () => {
    renderMap({
      codexRunByNodeId: {
        "root-1": {
          state: "prompt_waiting",
          taskId: "ai-task-1",
          label: "プロンプト待ち",
        },
        "child-1": {
          state: "awaiting_approval",
          taskId: "ai-task-2",
          label: "確認待ち",
        },
      },
    })

    expect(screen.getByText("プロンプト待ち1")).toBeInTheDocument()
    expect(screen.getAllByText("プロンプト待ち")).toHaveLength(1)
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

  test("limits the node menu to Codex handoff and schedule actions", async () => {
    const onRunCodex = vi.fn()
    const onUpdateSchedule = vi.fn()

    renderMap({ onRunCodex, onUpdateSchedule })

    const node = getNode("Root task", "root-1")
    fireEvent.click(within(node).getByRole("button", { name: "ノードメニューを開く" }))

    expect(within(node).getByRole("button", { name: "Codexに送る" })).toBeInTheDocument()
    expect(within(node).getByRole("button", { name: "日時を指定する" })).toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "メモを開く" })).not.toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "子を追加" })).not.toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "兄弟を追加" })).not.toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "編集" })).not.toBeInTheDocument()
    expect(within(node).queryByRole("button", { name: "削除" })).not.toBeInTheDocument()

    fireEvent.click(within(node).getByRole("button", { name: "Codexに送る" }))
    expect(onRunCodex).toHaveBeenCalledWith("root-1")

    fireEvent.click(within(node).getByRole("button", { name: "ノードメニューを開く" }))
    fireEvent.click(within(node).getByRole("button", { name: "日時を指定する" }))
    expect(await screen.findByText("カレンダー")).toBeInTheDocument()
    expect(screen.getByText("所要時間")).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveValue("primary")
    fireEvent.click(screen.getByRole("button", { name: "完了" }))

    await waitFor(() => {
      expect(onUpdateSchedule).toHaveBeenCalledWith("root-1", expect.objectContaining({
        estimatedMinutes: 60,
        calendarId: "primary",
      }))
    })
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

  test("checks a task immediately and hides it from the map after 300ms", async () => {
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
      vi.advanceTimersByTime(299)
    })
    expect(screen.getByText("Root task")).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(document.querySelector('[data-id="root-1"]')).not.toBeInTheDocument()
    expect(screen.getByRole("dialog", { name: "完了の取り消し" })).toBeInTheDocument()
  })

  test("can restore a hidden completed task from the undo dialog", async () => {
    vi.useFakeTimers()
    const onUpdateStatus = vi.fn(() => Promise.resolve())

    renderMap({ onUpdateStatus })

    const node = getNode("Root task", "root-1")
    await act(async () => {
      fireEvent.click(within(node).getByRole("checkbox", { name: "完了にする" }))
      vi.advanceTimersByTime(300)
    })

    expect(document.querySelector('[data-id="root-1"]')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "戻す" }))
      await Promise.resolve()
    })

    expect(onUpdateStatus).toHaveBeenNthCalledWith(1, "root-1", "done")
    expect(onUpdateStatus).toHaveBeenNthCalledWith(2, "root-1", "todo")
    expect(document.querySelector('[data-id="root-1"]')).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { name: "完了の取り消し" })).not.toBeInTheDocument()
  })

  test("removes the undo dialog after five seconds", async () => {
    vi.useFakeTimers()
    const onUpdateStatus = vi.fn(() => Promise.resolve())

    renderMap({ onUpdateStatus })

    const node = getNode("Root task", "root-1")
    await act(async () => {
      fireEvent.click(within(node).getByRole("checkbox", { name: "完了にする" }))
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByRole("dialog", { name: "完了の取り消し" })).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(5000)
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
