'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Square, CheckSquare, ChevronLeft, ChevronRight, Plus,
  ChevronDown, ChevronUp, Clock, Calendar as CalendarIcon,
} from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { Task, Project } from '@/types/database'
import { useTodayViewLogic } from '@/hooks/useTodayViewLogic'

interface TodayBoardProps {
  allTasks: Task[]
  onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
  projects?: Project[]
  onCreateQuickTask?: (data: {
    title: string
    project_id: string | null
    scheduled_at: string | null
    estimated_time: number
    reminders: number[]
    calendar_id: string | null
    priority: number
  }) => Promise<void>
  onDeleteTask?: (taskId: string) => Promise<void>
}

function formatScheduledTime(scheduledAt: string | null): string | null {
  if (!scheduledAt) return null
  return format(new Date(scheduledAt), 'H:mm')
}

function formatTimeRange(start: string, end: string): string {
  return `${format(new Date(start), 'H:mm')}–${format(new Date(end), 'H:mm')}`
}

export function TodayBoard({
  allTasks,
  onUpdateTask,
  projects = [],
  onCreateQuickTask,
  onDeleteTask,
}: TodayBoardProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)

  const logic = useTodayViewLogic({
    allTasks,
    onUpdateTask,
    projects,
    onDeleteTask,
  })

  // 今日のタスクを todo / done に分割
  const { todoTasks, doneTasks } = useMemo(() => {
    const allToday = [
      ...logic.todayScheduledTasks,
      ...logic.unscheduledTasks,
    ]
    const seen = new Set<string>()
    const unique = allToday.filter(t => {
      if (seen.has(t.id)) return false
      seen.add(t.id)
      return true
    })
    const todo = unique.filter(t => t.status !== 'done')
    const done = unique.filter(t => t.status === 'done')
    const sortBySchedule = (a: Task, b: Task) => {
      if (a.scheduled_at && b.scheduled_at) return new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
      if (a.scheduled_at) return -1
      if (b.scheduled_at) return 1
      return 0
    }
    todo.sort(sortBySchedule)
    done.sort(sortBySchedule)
    return { todoTasks: todo, doneTasks: done }
  }, [logic.todayScheduledTasks, logic.unscheduledTasks])

  // カレンダーイベント（タスクと紐づいていないもの）
  const calendarOnlyEvents = useMemo(() => {
    const taskGoogleEventIds = new Set(
      allTasks.filter(t => t.google_event_id).map(t => t.google_event_id)
    )
    return logic.calendarEvents
      .filter(e => {
        if (taskGoogleEventIds.has(e.google_event_id)) return false
        if (e.is_all_day) return false
        const start = new Date(e.start_time)
        const end = new Date(e.end_time)
        return start >= logic.today && start < logic.tomorrow
      })
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  }, [logic.calendarEvents, logic.today, logic.tomorrow, allTasks])

  const handleAddTask = useCallback(async () => {
    const title = newTaskTitle.trim()
    if (!title || !onCreateQuickTask) return
    setIsAdding(true)
    try {
      await onCreateQuickTask({
        title,
        project_id: null,
        scheduled_at: new Date().toISOString(),
        estimated_time: 30,
        reminders: [],
        calendar_id: null,
        priority: 2,
      })
      setNewTaskTitle('')
    } finally {
      setIsAdding(false)
    }
  }, [newTaskTitle, onCreateQuickTask])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleAddTask()
    }
  }, [handleAddTask])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Date Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b">
        <div className="flex items-center gap-1">
          <button
            onClick={logic.goToPrevDay}
            className="p-2 rounded-full active:bg-muted transition-colors text-muted-foreground"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center">
            <div className="flex items-center justify-center gap-2">
              {logic.isToday && (
                <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
                  TODAY
                </span>
              )}
              <h1 className="text-lg font-bold">{logic.dateFmt}</h1>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {todoTasks.length > 0 ? `${todoTasks.length}件のタスク` : 'タスクなし'}
              {calendarOnlyEvents.length > 0 && ` · ${calendarOnlyEvents.length}件の予定`}
              {doneTasks.length > 0 && ` · ${doneTasks.length}件完了`}
            </p>
          </div>
          <button
            onClick={logic.goToNextDay}
            className="p-2 rounded-full active:bg-muted transition-colors text-muted-foreground"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* 予定 Section (calendar events) */}
        {calendarOnlyEvents.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>予定</span>
            </h2>
            <div className="space-y-1">
              {calendarOnlyEvents.map(event => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 py-2.5 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 min-h-[44px]"
                >
                  <Clock className="w-4 h-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm">{event.title}</span>
                  </div>
                  <span className="text-xs text-blue-600 dark:text-blue-400 tabular-nums shrink-0">
                    {formatTimeRange(event.start_time, event.end_time)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* やること Section */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <span>やること</span>
            {todoTasks.length > 0 && (
              <span className="text-xs tabular-nums bg-muted rounded-full px-1.5 py-0.5">
                {todoTasks.length}
              </span>
            )}
          </h2>
          <div className="space-y-1">
            {todoTasks.map(task => (
              <button
                key={task.id}
                onClick={() => logic.toggleTask(task.id)}
                className="w-full flex items-center gap-3 py-3 px-3 rounded-lg border border-border/60 bg-background active:bg-muted/50 transition-colors text-left min-h-[44px]"
              >
                <Square className="w-5 h-5 text-muted-foreground/40 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm">{task.title}</span>
                </div>
                {task.scheduled_at && (
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                    {formatScheduledTime(task.scheduled_at)}
                  </span>
                )}
              </button>
            ))}

            {todoTasks.length === 0 && !calendarOnlyEvents.length && (
              <p className="text-sm text-muted-foreground/50 py-3 text-center">
                タスクはありません
              </p>
            )}

            {/* Inline Task Add */}
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 flex items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2 min-h-[44px]">
                <Plus className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="タスクを追加..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
                  disabled={isAdding}
                />
              </div>
              {newTaskTitle.trim() && (
                <button
                  onClick={handleAddTask}
                  disabled={isAdding}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-[44px] active:opacity-80 transition-opacity"
                >
                  追加
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 完了済み Section */}
        {doneTasks.length > 0 && (
          <section>
            <button
              onClick={() => setShowCompleted(prev => !prev)}
              className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-muted-foreground"
            >
              {showCompleted ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              <span>完了済み</span>
              <span className="text-xs tabular-nums bg-muted rounded-full px-1.5 py-0.5">
                {doneTasks.length}
              </span>
            </button>
            {showCompleted && (
              <div className="space-y-1">
                {doneTasks.map(task => (
                  <button
                    key={task.id}
                    onClick={() => logic.toggleTask(task.id)}
                    className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg bg-muted/30 active:bg-muted/50 transition-colors text-left min-h-[44px]"
                  >
                    <CheckSquare className="w-5 h-5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-muted-foreground line-through">{task.title}</span>
                    </div>
                    {task.scheduled_at && (
                      <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">
                        {formatScheduledTime(task.scheduled_at)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="h-20" />
      </div>
    </div>
  )
}
