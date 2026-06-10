import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { PanelQuickTaskForm } from './panel-quick-task-form'

vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: ({ trigger }: { trigger: ReactNode }) => trigger,
}))

vi.mock('@/components/ui/duration-wheel-picker', () => ({
  DurationWheelPicker: ({ trigger }: { trigger: ReactNode }) => trigger,
  formatDuration: (minutes: number) => `${minutes}分`,
}))

function renderOpenForm(onCreateTask = vi.fn(async () => undefined)) {
  const onClose = vi.fn()

  render(
    <PanelQuickTaskForm
      projects={[]}
      calendars={[{ id: 'work-cal', name: '仕事' }]}
      onCreateTask={onCreateTask}
      isOpen
      onClose={onClose}
      variant="side-panel"
    />,
  )

  return { onCreateTask, onClose }
}

describe('PanelQuickTaskForm', () => {
  test('タスク名のIME確定Enterでは作成せず、次のEnterで作成する', async () => {
    const { onCreateTask } = renderOpenForm()
    const titleInput = screen.getByPlaceholderText('タスク名')

    fireEvent.change(titleInput, { target: { value: '資料作成' } })
    fireEvent.compositionStart(titleInput)
    fireEvent.keyDown(titleInput, { key: 'Enter', code: 'Enter', keyCode: 13 })

    expect(onCreateTask).not.toHaveBeenCalled()

    fireEvent.compositionEnd(titleInput)
    fireEvent.keyDown(titleInput, { key: 'Enter', code: 'Enter', keyCode: 13 })

    await waitFor(() => {
      expect(onCreateTask).toHaveBeenCalledTimes(1)
    })
    expect(onCreateTask).toHaveBeenCalledWith(expect.objectContaining({
      title: '資料作成',
      estimated_time: 30,
      calendar_id: null,
    }))
  })

  test('ブラウザが変換中として送るEnterイベントでは作成しない', () => {
    const { onCreateTask } = renderOpenForm()
    const titleInput = screen.getByPlaceholderText('タスク名')

    fireEvent.change(titleInput, { target: { value: '資料作成' } })
    fireEvent.keyDown(titleInput, { key: 'Enter', code: 'Enter', keyCode: 229 })

    expect(onCreateTask).not.toHaveBeenCalled()
  })
})
