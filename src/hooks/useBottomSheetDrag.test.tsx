import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

import { useBottomSheetDrag } from "./useBottomSheetDrag"

function BottomSheetHarness({ onDismiss }: { onDismiss: () => void }) {
  const {
    setDragElement,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  } = useBottomSheetDrag<HTMLDivElement>({
    enabled: true,
    onDismiss,
  })

  return (
    <div
      data-testid="sheet"
      ref={setDragElement}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div data-sheet-drag-handle="true">handle</div>
      <input aria-label="見出し" />
    </div>
  )
}

describe("useBottomSheetDrag", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("下方向ドラッグ中にシートが指へ追従し、十分に引くと閉じる", () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()

    render(<BottomSheetHarness onDismiss={onDismiss} />)

    const sheet = screen.getByTestId("sheet")
    vi.spyOn(sheet, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 390,
      height: 620,
      top: 0,
      right: 390,
      bottom: 620,
      left: 0,
      toJSON: () => ({}),
    })

    fireEvent.touchStart(sheet, { touches: [{ clientX: 180, clientY: 120 }] })
    fireEvent.touchMove(sheet, { touches: [{ clientX: 180, clientY: 250 }] })

    expect(sheet).toHaveStyle({ transform: "translate3d(0, 130px, 0)" })

    fireEvent.touchEnd(sheet, { changedTouches: [{ clientX: 180, clientY: 250 }] })
    vi.advanceTimersByTime(170)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  test("入力欄からのタッチ操作ではシートを動かさない", () => {
    const onDismiss = vi.fn()

    render(<BottomSheetHarness onDismiss={onDismiss} />)

    const sheet = screen.getByTestId("sheet")
    const input = screen.getByLabelText("見出し")

    fireEvent.touchStart(input, { touches: [{ clientX: 160, clientY: 180 }] })
    fireEvent.touchMove(input, { touches: [{ clientX: 160, clientY: 330 }] })
    fireEvent.touchEnd(input, { changedTouches: [{ clientX: 160, clientY: 330 }] })

    expect(sheet.style.transform).toBe("")
    expect(onDismiss).not.toHaveBeenCalled()
  })
})
