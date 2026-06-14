import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { IosWheelColumn } from "./ios-wheel-column"

function renderWheel({
  value = 0,
  onPreview = vi.fn(),
  onCommit = vi.fn(),
}: {
  value?: number
  onPreview?: (value: number) => void
  onCommit?: (value: number) => void
} = {}) {
  render(
    <div style={{ height: 220 }}>
      <IosWheelColumn
        label="分"
        values={[0, 1, 2, 3, 4]}
        value={value}
        onPreview={onPreview}
        onCommit={onCommit}
        dataColumn="minute"
        idPrefix="minute"
      />
    </div>,
  )

  return {
    wheel: screen.getByRole("listbox", { name: "分" }),
    currentOption: screen.getByRole("option", { selected: true }),
    onPreview,
    onCommit,
  }
}

describe("IosWheelColumn", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("selected option is positioned from the exact center instead of relying on translated percentage centering", () => {
    const { currentOption } = renderWheel()

    expect(currentOption).toHaveStyle({ top: "calc(50% - 22px)" })
    expect(currentOption.getAttribute("style")).not.toContain("translateY(-50%)")
  })

  test("small wheel deltas move the wheel fractionally before the idle snap commits", () => {
    vi.useFakeTimers()
    const { wheel, currentOption, onCommit } = renderWheel()

    fireEvent.wheel(wheel, { deltaY: 11, deltaMode: 0 })

    expect(currentOption.getAttribute("style")).toContain("translate3d(0, -11px, 0)")
    expect(onCommit).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(120)
    })

    expect(onCommit).toHaveBeenCalledWith(0)
  })

  test("consecutive small wheel deltas accumulate into the next value before commit", () => {
    vi.useFakeTimers()
    const { wheel, onPreview, onCommit } = renderWheel()

    fireEvent.wheel(wheel, { deltaY: 11, deltaMode: 0 })
    fireEvent.wheel(wheel, { deltaY: 11, deltaMode: 0 })
    fireEvent.wheel(wheel, { deltaY: 11, deltaMode: 0 })

    expect(onPreview).toHaveBeenLastCalledWith(1)
    expect(onCommit).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(120)
    })

    expect(onCommit).toHaveBeenCalledWith(1)
  })
})
