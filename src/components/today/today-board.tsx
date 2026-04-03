'use client'

import { useState, useMemo, useCallback } from 'react'
import {
  Square, CheckSquare, ChevronLeft, ChevronRight, Plus,
  ChevronDown, ChevronUp, Clock, Calendar as CalendarIcon,
  MessageCircle, Send, Loader2, Bot, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { Task, Project } from '@/types/database'
import { useTodayViewLogic } from '@/hooks/useTodayViewLogic'
import { useAiTasks } from '@/hooks/useAiTasks'
import type { AiTask, AiTaskStatus } from '@/types/ai-task'
import { AiTaskApprovalCard } from './ai-task-approval-card'

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

function AiTaskStatusIcon({ status }: { status: AiTaskStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
    case 'failed':
      return <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
    case 'awaiting_approval':
      return <Clock className="w-4 h-4 text-amber-500 shrink-0" />
    default:
      return <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
  }
}

function aiTaskStatusLabel(status: AiTaskStatus): string {
  switch (status) {
    case 'pending': return '待機中'
    case 'running': return '実行中'
    case 'completed': return '完了'
    case 'failed': return '失敗'
    case 'awaiting_approval': return '確認待ち'
    case 'needs_input': return '入力待ち'
  }
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}時間前`
  return `${Math.floor(hour / 24)}日前`
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
  const [chatInput, setChatInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showAiLog, setShowAiLog] = useState(true)

  const { tasks: aiTasks, sendPrompt, approve, reject, requestRevision } = useAiTasks({ limit: 10 })

  // 確認待ちタスクとそれ以外を分離
  const pendingApprovalTasks = useMemo(
    () => aiTasks.filter(t => t.status === 'awaiting_approval'),
    [aiTasks]
  )
  const otherAiTasks = useMemo(
    () => aiTasks.filter(t => t.status !== 'awaiting_approval'),
    [aiTasks]
  )

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

  const handleSendChat = useCallback(async () => {
    const prompt = chatInput.trim()
    if (!prompt) return
    setIsSending(true)
    try {
      await sendPrompt(prompt)
      setChatInput('')
    } catch {
      // エラーはAIログに表示される
    } finally {
      setIsSending(false)
    }
  }, [chatInput, sendPrompt])

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSendChat()
    }
  }, [handleSendChat])

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

        {/* 確認待ち Section */}
        {pendingApprovalTasks.length > 0 && (
          <section className="space-y-2">
            {pendingApprovalTasks.map(task => (
              <AiTaskApprovalCard
                key={task.id}
                task={task}
                onApprove={approve}
                onReject={reject}
                onRequestRevision={requestRevision}
              />
            ))}
          </section>
        )}

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

        {/* 壁打ち Section */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <MessageCircle className="w-3.5 h-3.5" />
            <span>壁打ち</span>
          </h2>
          <div className="flex items-end gap-2">
            <div className="flex-1 rounded-lg border border-border/60 bg-background px-3 py-2 min-h-[44px]">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleChatKeyDown}
                placeholder="AIに相談..."
                rows={1}
                className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-muted-foreground/40"
                disabled={isSending}
              />
            </div>
            <button
              onClick={handleSendChat}
              disabled={isSending || !chatInput.trim()}
              className={cn(
                'p-2.5 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center transition-colors',
                chatInput.trim()
                  ? 'bg-primary text-primary-foreground active:opacity-80'
                  : 'bg-muted text-muted-foreground'
              )}
            >
              {isSending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/50 mt-1">
            AIが30秒後に回答（Phase 2で実装）
          </p>
        </section>

        {/* AI実行ログ Section */}
        {otherAiTasks.length > 0 && (
          <section>
            <button
              onClick={() => setShowAiLog(prev => !prev)}
              className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-muted-foreground"
            >
              {showAiLog ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              <Bot className="w-3.5 h-3.5" />
              <span>AI実行ログ</span>
              <span className="text-xs tabular-nums bg-muted rounded-full px-1.5 py-0.5">
                {otherAiTasks.length}
              </span>
            </button>
            {showAiLog && (
              <div className="space-y-1.5">
                {otherAiTasks.map(task => (
                  <div
                    key={task.id}
                    className={cn(
                      'flex items-start gap-2.5 py-2.5 px-3 rounded-lg border min-h-[44px]',
                      task.status === 'failed' && 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20',
                      task.status === 'awaiting_approval' && 'border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/20',
                      task.status === 'running' && 'border-blue-200 bg-blue-50/50 dark:border-blue-900/30 dark:bg-blue-950/20',
                      task.status === 'completed' && 'border-border/40 bg-muted/20',
                      task.status === 'pending' && 'border-border/40',
                    )}
                  >
                    <AiTaskStatusIcon status={task.status} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug line-clamp-2">{task.prompt}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[11px] text-muted-foreground">
                          {aiTaskStatusLabel(task.status)}
                        </span>
                        <span className="text-[11px] text-muted-foreground/50">
                          {formatRelativeTime(task.created_at)}
                        </span>
                      </div>
                      {task.status === 'completed' && task.result && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-3">
                          {typeof task.result === 'object' && 'message' in task.result
                            ? String(task.result.message)
                            : JSON.stringify(task.result).slice(0, 200)}
                        </p>
                      )}
                      {task.status === 'failed' && task.error && (
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">{task.error}</p>
                      )}
                    </div>
                  </div>
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
