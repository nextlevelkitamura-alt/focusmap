import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { CustomMindMapView } from "./custom-mind-map-view"
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

const installOpenKeyboardViewport = () => {
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
    height: 500,
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

afterEach(() => {
  vi.useRealTimers()
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
    expect(screen.getByLabelText("Codex 実行中")).toBeInTheDocument()
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

    fireEvent.click(await screen.findByRole("button", { name: "子ノード追加" }))

    await waitFor(() => {
      expect(onSaveTitle).toHaveBeenCalledWith("root-1", "Renamed root")
      expect(onAddChildNode).toHaveBeenCalledWith("root-1")
    })
  })

  test("routes the mobile keyboard accessory sibling action to the active node", async () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "兄弟ノード追加" }))

    await waitFor(() => expect(onAddSiblingNode).toHaveBeenCalledWith("root-1"))
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
    fireEvent.click(await screen.findByRole("button", { name: "兄弟ノード追加" }))

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

    const newInput = await screen.findByDisplayValue("")
    await waitFor(() => {
      expect(newInput).toHaveFocus()
      expect(newInput.closest('[data-id="root-2"]')).not.toBeNull()
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
})
