import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { DesktopTodayPanel } from './desktop-today-panel'
import { useTodayViewLogic } from '@/hooks/useTodayViewLogic'
import type { MindMapNodeCalendarDragPayload } from '@/lib/calendar-constants'

vi.mock('@/hooks/useTodayViewLogic', () => ({
  useTodayViewLogic: vi.fn(),
}))

vi.mock('@/hooks/useClickOutside', () => ({
  useClickOutside: vi.fn(),
}))

vi.mock('@/hooks/useTrackpadNavigation', () => ({
  useTrackpadNavigation: vi.fn(),
}))

vi.mock('@/components/today/today-timeline-calendar', () => ({
  TodayTimelineCalendar: ({
    onMindMapNodeDrop,
  }: {
    onMindMapNodeDrop?: (payload: MindMapNodeCalendarDragPayload, startTime: Date) => Promise<void>
  }) => (
    <button
      type="button"
      onClick={() => onMindMapNodeDrop?.({
        taskId: 'task-1',
        title: 'マップノード',
        durationMinutes: 45,
        calendarId: null,
      }, new Date('2026-06-10T10:00:00+09:00'))}
    >
      drop node
    </button>
  ),
}))

vi.mock('@/components/today/today-timeline-cards', () => ({
  TodayTimelineCards: () => <div />,
}))

vi.mock('@/components/today/today-3days-calendar', () => ({
  Today3DaysCalendar: () => <div />,
}))

vi.mock('@/components/today/today-month-calendar', () => ({
  TodayMonthCalendar: () => <div />,
}))

vi.mock('@/components/today/mobile-event-edit-modal', () => ({
  MobileEventEditModal: () => null,
}))

vi.mock('@/components/ui/simple-calendar', () => ({
  SimpleCalendar: () => <div />,
}))

vi.mock('@/components/dashboard/panel-quick-task-form', () => ({
  PanelQuickTaskForm: () => <div />,
}))

vi.mock('@/components/dashboard/desktop-panel-fab', () => ({
  DesktopPanelFab: () => null,
}))

const mockedUseTodayViewLogic = vi.mocked(useTodayViewLogic)

function mockTodayLogic(options?: { selectedCalendarId?: string }) {
  const selectedCalendarId = options?.selectedCalendarId ?? 'work-calendar'
  mockedUseTodayViewLogic.mockReturnValue({
    calendarMonth: new Date('2026-06-10T00:00:00+09:00'),
    calendarOpen: false,
    calendarReauthUrl: '/reauth',
    calendars: [
      {
        google_calendar_id: 'work-calendar',
        name: 'Work',
        selected: selectedCalendarId === 'work-calendar',
        access_level: 'owner',
      },
      {
        google_calendar_id: 'private-calendar',
        name: 'Private',
        selected: selectedCalendarId === 'private-calendar',
        access_level: 'writer',
      },
    ],
    cancelNotifications: vi.fn(),
    childTasksMap: new Map(),
    currentTime: new Date('2026-06-10T12:00:00+09:00'),
    dateFmt: '6月10日(水)',
    dateHabits: [],
    displayAllDayEvents: [],
    displayItems: [],
    doneHabitCount: 0,
    editTarget: null,
    allFetchedEvents: [],
    eventsError: null,
    eventsLoading: false,
    expandedHabitId: null,
    goToNextDay: vi.fn(),
    goToPrevDay: vi.fn(),
    habitsExpanded: false,
    habitsLoading: false,
    handleCloseEditModal: vi.fn(),
    handleDateSelect: vi.fn(),
    handleDeleteEvent: vi.fn(),
    handleDeleteTask: vi.fn(),
    handleDragDrop: vi.fn(),
    handleItemTap: vi.fn(),
    handleSaveEvent: vi.fn(),
    handleSaveTask: vi.fn(),
    isEditModalOpen: false,
    isToday: true,
    onCreateSubTask: vi.fn(),
    projectNameMap: new Map(),
    scheduleNotification: vi.fn(),
    scrollPositionRef: { current: 0 },
    selectedDate: new Date('2026-06-10T00:00:00+09:00'),
    selectedDateStr: '2026-06-10',
    setSelectedDate: vi.fn(),
    setCalendarMonth: vi.fn(),
    setCalendarOpen: vi.fn(),
    setExpandedHabitId: vi.fn(),
    setHabitsExpanded: vi.fn(),
    setTimelineMode: vi.fn(),
    syncState: 'idle',
    timelineMode: 'calendar',
    timer: {
      runningTaskId: null,
      startTimer: vi.fn(),
      pauseTimer: vi.fn(),
    },
    toggleChildTask: vi.fn(),
    toggleCompletion: vi.fn(),
    toggleEventCompletion: vi.fn(),
    toggleTask: vi.fn(),
    handleConvertEventToMemo: vi.fn(),
    handleConvertCalendarPayloadToMemo: vi.fn(),
    refreshCalendar: vi.fn(),
    writableCalendars: [
      { id: 'work-calendar', name: 'Work', background_color: '#22c55e' },
      { id: 'private-calendar', name: 'Private', background_color: '#3b82f6' },
    ],
    visibleTasks: [],
    stableCalendarColorMap: new Map(),
  } as unknown as ReturnType<typeof useTodayViewLogic>)
}

describe('DesktopTodayPanel mind map calendar target', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTodayLogic()
  })

  test('表示カレンダーで選んだカレンダーをマップノードdrop時の保存先に使う', async () => {
    const onUpdateTask = vi.fn(async () => undefined)
    mockTodayLogic({ selectedCalendarId: 'private-calendar' })

    render(
      <DesktopTodayPanel
        allTasks={[]}
        onUpdateTask={onUpdateTask}
        onCreateQuickTask={vi.fn()}
        onOpenAiChat={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'drop node' }))

    await waitFor(() => {
      expect(onUpdateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
        estimated_time: 45,
        calendar_id: 'private-calendar',
      }))
    })
  })
})
