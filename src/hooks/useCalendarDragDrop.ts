import { useState, useCallback, RefObject } from "react"
import { HOUR_HEIGHT } from "@/lib/calendar-constants"

interface UseCalendarDragDropOptions {
  /** Reference to the scrollable grid container */
  gridRef: RefObject<HTMLDivElement | null>
  /** Callback when a task is dropped */
  onTaskDrop?: (taskId: string, dateTime: Date) => void
  /** Dynamic hour height for zooming */
  hourHeight?: number
}

interface DragDropDayConfig {
  /** The date for this day */
  currentDate: Date
}

interface DragDropWeekConfig {
  /** Array of 7 dates for the week */
  weekDates: Date[]
  /** Array of hour numbers */
  hours: number[]
}

interface DragDropMonthConfig {
  /** Array of all days in the month grid */
  monthDays: Date[]
}

/** Shared drag state for day view */
export function useCalendarDragDropDay({ gridRef, onTaskDrop, hourHeight = HOUR_HEIGHT }: UseCalendarDragDropOptions) {
  const [dragOverHour, setDragOverHour] = useState<number | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent, _config: DragDropDayConfig) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = gridRef.current?.scrollTop || 0
    const y = e.clientY - rect.top
    const hourIndex = Math.floor((y + scrollTop) / hourHeight)

    if (hourIndex >= 0 && hourIndex < 24) {
      setDragOverHour(hourIndex)
    }
  }, [gridRef, hourHeight])

  const handleDragLeave = useCallback(() => {
    setDragOverHour(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, config: DragDropDayConfig) => {
    e.preventDefault()
    setDragOverHour(null)
    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = gridRef.current?.scrollTop || 0
    const y = e.clientY - rect.top
    const hourIndex = Math.floor((y + scrollTop) / hourHeight)

    if (hourIndex >= 0 && hourIndex < 24) {
      const targetDate = new Date(config.currentDate)
      targetDate.setHours(hourIndex, 0, 0, 0)
      onTaskDrop?.(taskId, targetDate)
    }
  }, [gridRef, onTaskDrop, hourHeight])

  return { dragOverHour, handleDragOver, handleDragLeave, handleDrop }
}

/** Shared drag state for week view */
export function useCalendarDragDropWeek({ gridRef, onTaskDrop, hourHeight }: UseCalendarDragDropOptions) {
  return useCalendarDragDropMultiDay({ gridRef, onTaskDrop, hourHeight, daysCount: 7 })
}

interface DragDropMultiDayConfig {
  /** Array of dates for the view */
  dates: Date[]
  /** Array of hour numbers */
  hours: number[]
}

/** Shared drag state for multi-day view (3-day, week etc) */
export function useCalendarDragDropMultiDay({ gridRef, onTaskDrop, daysCount, hourHeight = HOUR_HEIGHT }: UseCalendarDragDropOptions & { daysCount: number }) {
  const [dragOverCell, setDragOverCell] = useState<string | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = gridRef.current?.scrollTop || 0

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / daysCount
    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor((y + scrollTop) / hourHeight)

    if (dayIndex >= 0 && dayIndex < daysCount && hourIndex >= 0 && hourIndex < 24) {
      setDragOverCell(`${dayIndex}-${hourIndex}`)
    }
  }, [gridRef, daysCount, hourHeight])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverCell(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, config: DragDropMultiDayConfig) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverCell(null)

    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const scrollTop = gridRef.current?.scrollTop || 0

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / daysCount
    const dayIndex = Math.floor(x / cellWidth)
    const hourIndex = Math.floor((y + scrollTop) / hourHeight)

    if (dayIndex >= 0 && dayIndex < daysCount && hourIndex >= 0 && hourIndex < 24) {
      const targetDate = new Date(config.dates[dayIndex])
      targetDate.setHours(hourIndex, 0, 0, 0)
      onTaskDrop?.(taskId, targetDate)
    }
  }, [gridRef, onTaskDrop, daysCount, hourHeight])

  return { dragOverCell, handleDragOver, handleDragLeave, handleDrop }
}

/** Shared drag state for month view */
export function useCalendarDragDropMonth({ onTaskDrop }: Pick<UseCalendarDragDropOptions, 'onTaskDrop'>) {
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent, monthDays: Date[]) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = rect.height / (monthDays.length / 7)

    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    const index = row * 7 + col
    if (index >= 0 && index < monthDays.length) {
      const d = monthDays[index]
      const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      setDragOverDay(dayStr)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOverDay(null)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, monthDays: Date[]) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverDay(null)

    const taskId = e.dataTransfer.getData('text/plain')
    if (!taskId) return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const cellWidth = rect.width / 7
    const cellHeight = rect.height / (monthDays.length / 7)

    const col = Math.floor(x / cellWidth)
    const row = Math.floor(y / cellHeight)

    const index = row * 7 + col
    if (index >= 0 && index < monthDays.length) {
      const targetDate = new Date(monthDays[index])
      targetDate.setHours(9, 0, 0, 0)
      onTaskDrop?.(taskId, targetDate)
    }
  }, [onTaskDrop])

  return { dragOverDay, handleDragOver, handleDragLeave, handleDrop }
}
