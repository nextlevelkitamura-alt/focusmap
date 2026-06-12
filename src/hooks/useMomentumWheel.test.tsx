import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useMomentumWheel } from './useMomentumWheel'

function MomentumWheelHarness({
  onPreview,
  onChange,
}: {
  onPreview: (value: string, index: number) => void
  onChange: (value: string, index: number) => void
}) {
  const values = ['main', 'work', 'private']
  const wheel = useMomentumWheel({
    values,
    getIndex: container => Math.round(container.scrollTop / 40),
    scrollToIndex: (container, index) => {
      container.scrollTop = index * 40
    },
    onPreview,
    onChange,
    scrollEndDelay: 150,
  })

  return (
    <div
      data-testid="wheel"
      onPointerDown={wheel.onPointerDown}
      onPointerMove={wheel.onPointerMove}
      onPointerUp={wheel.onPointerUp}
      onPointerCancel={wheel.onPointerCancel}
      onLostPointerCapture={wheel.onLostPointerCapture}
      onScroll={wheel.onScroll}
      style={{ height: 40, overflowY: 'auto' }}
    >
      {values.map(value => (
        <div key={value} style={{ height: 40 }}>
          {value}
        </div>
      ))}
    </div>
  )
}

describe('useMomentumWheel', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('ドラッグ中の停止では確定せず、指を離した時だけ確定する', () => {
    vi.useFakeTimers()
    const onPreview = vi.fn()
    const onChange = vi.fn()

    render(<MomentumWheelHarness onPreview={onPreview} onChange={onChange} />)

    const wheel = screen.getByTestId('wheel') as HTMLDivElement
    Object.defineProperty(wheel, 'clientHeight', { configurable: true, value: 40 })
    Object.defineProperty(wheel, 'scrollHeight', { configurable: true, value: 40 })

    fireEvent.pointerDown(wheel, { pointerId: 1, pointerType: 'touch', clientY: 120 })
    fireEvent.pointerMove(wheel, { pointerId: 1, pointerType: 'touch', clientY: 80 })

    expect(onPreview).toHaveBeenCalledWith('work', 1)
    expect(onChange).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(400)
    })

    expect(onChange).not.toHaveBeenCalled()

    fireEvent.pointerUp(wheel, { pointerId: 1, pointerType: 'touch', clientY: 80 })

    expect(onChange).toHaveBeenCalledWith('work', 1)
  })
})
