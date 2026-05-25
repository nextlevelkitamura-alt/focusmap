import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, test, vi } from "vitest"
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

describe("CustomMindMapView keyboard operations", () => {
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
})
