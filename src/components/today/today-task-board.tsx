'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Square, CheckSquare, ChevronLeft, ChevronRight, Plus,
  ChevronDown, ChevronUp, Clock, Calendar as CalendarIcon,
  Loader2, Bot, CheckCircle2, AlertCircle,
  Trash2, CalendarClock, RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { Task, Project } from '@/types/database'
import type { CalendarEvent } from '@/types/calendar'
import { useTodayViewLogic } from '@/hooks/useTodayViewLogic'
import { useAiTasks } from '@/hooks/useAiTasks'
import { useScheduledTasks } from '@/hooks/useScheduledTasks'
import type { AiTask, AiTaskStatus } from '@/types/ai-task'
import { AiTaskApprovalCard } from './ai-task-approval-card'
import { AuthStatusBar } from './auth-status-bar'
import { SetupGuideBanner } from './setup-guide-banner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { useClickOutside } from '@/hooks/useClickOutside'

type BoardItem =
  | { kind: 'event'; data: CalendarEvent; sortTime: number }
  | { kind: 'task';  data: Task;          sortTime: number }
  | { kind: 'ai';    data: AiTask;        sortTime: number }

interface TodayTaskBoardProps {
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

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}時間前`
  return `${Math.floor(hour / 24)}日前`
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

export function TodayTaskBoard({
  allTasks,
  onUpdateTask,
  projects = [],
  onCreateQuickTask,
  onDeleteTask,
}: TodayTaskBoardProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [showCompleted, setShowCompleted] = useState(true)
  const [chatInput, setChatInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showAiLog, setShowAiLog] = useState(false)

  // 壁打ちセクションのタブ
  const [chatTab, setChatTab] = useState<'chat' | 'scheduled'>('chat')

  // スケジュール設定フォーム（編集モード対応）
  const [editingTask, setEditingTask] = useState<AiTask | null>(null)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const scheduleFormRef = useRef<HTMLDivElement>(null)
  useClickOutside(scheduleFormRef, useCallback(() => setShowScheduleForm(false), []), showScheduleForm)
  const [schedulePrompt, setSchedulePrompt] = useState('')
  const [scheduleDatetime, setScheduleDatetime] = useState<Date | undefined>(undefined)
  const [scheduleRecurrence, setScheduleRecurrence] = useState<'none' | 'daily' | 'weekly' | 'custom'>('none')
  const [scheduleCustomCron, setScheduleCustomCron] = useState('')
  const [scheduleDays, setScheduleDays] = useState<number[]>([]) // 0=日, 1=月, ..., 6=土
  const [scheduleWeekOrdinal, setScheduleWeekOrdinal] = useState<'every' | '1st' | '2nd' | '3rd' | '4th'>('every')
  const [isScheduling, setIsScheduling] = useState(false)
  const [scheduleSuccess, setScheduleSuccess] = useState(false)
  const [scheduleApprovalType, setScheduleApprovalType] = useState<'auto' | 'confirm'>('confirm')

  // フォルダ選択（前回値を localStorage で記憶）
  const [skillRepos, setSkillRepos] = useState<{ label: string; path: string; skills: { name: string; description: string | null }[] }[]>([])
  const [selectedRepo, setSelectedRepo] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('focusmap-schedule-repo') || ''
    return ''
  })

  // フォルダ一覧を初回取得
  useEffect(() => {
    fetch('/api/ai-tasks/skills')
      .then(r => r.ok ? r.json() : [])
      .then(setSkillRepos)
      .catch(() => {})
  }, [])

  // フォルダ変更時に localStorage に保存
  useEffect(() => {
    if (selectedRepo) localStorage.setItem('focusmap-schedule-repo', selectedRepo)
  }, [selectedRepo])

  const { tasks: aiTasks, sendPrompt, approve, reject, requestRevision, addTaskOptimistic, refresh: refreshAiTasks } = useAiTasks({ limit: 20 })
  const { tasks: scheduledTasks, isLoading: scheduledLoading, deleteTask: deleteScheduledTask, refresh: refreshScheduled } = useScheduledTasks()

  const pendingApprovalTasks = useMemo(
    () => aiTasks.filter(t => t.status === 'awaiting_approval'),
    [aiTasks]
  )
  const runningAiTasks = useMemo(
    () => aiTasks.filter(t => t.status === 'running' || t.status === 'pending'),
    [aiTasks]
  )
  const logAiTasks = useMemo(
    () => aiTasks.filter(t => t.status === 'completed' || t.status === 'failed'),
    [aiTasks]
  )

  const logic = useTodayViewLogic({
    allTasks,
    onUpdateTask,
    projects,
    onDeleteTask,
  })

  // 選択日のAIスケジュール（ワンタイム + 定期タスクのcronマッチ）
  const todayAiSchedule = useMemo(() => {
    const sel = logic.selectedDate
    const dayStart = new Date(sel.getFullYear(), sel.getMonth(), sel.getDate())
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

    // ワンタイムタスク: scheduled_atが選択日内
    const oneTime = aiTasks.filter(t => {
      if (!t.scheduled_at || t.recurrence_cron) return false
      const d = new Date(t.scheduled_at)
      return d >= dayStart && d < dayEnd
    })

    // 定期タスク: cronの曜日が選択日にマッチ
    const seenIds = new Set(oneTime.map(t => t.id))
    const recurring = scheduledTasks.filter(t => {
      if (!t.recurrence_cron || seenIds.has(t.id)) return false
      return cronMatchesDate(t.recurrence_cron, sel)
    })

    return [...oneTime, ...recurring].sort((a, b) => {
      const timeA = a.scheduled_at ? new Date(a.scheduled_at).getTime() : cronToSortTime(a.recurrence_cron, sel)
      const timeB = b.scheduled_at ? new Date(b.scheduled_at).getTime() : cronToSortTime(b.recurrence_cron, sel)
      return timeA - timeB
    })
  }, [aiTasks, scheduledTasks, logic.selectedDate])

  const { boardItems, doneCount, eventCount, todoCount } = useMemo(() => {
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
    const todo = unique
    const doneCount = unique.filter(t => t.status === 'done').length

    const taskGoogleEventIds = new Set(
      allTasks.filter(t => t.google_event_id).map(t => t.google_event_id)
    )
    const events = logic.calendarEvents.filter(e => {
      if (taskGoogleEventIds.has(e.google_event_id)) return false
      if (e.is_all_day) return false
      const start = new Date(e.start_time)
      return start >= logic.today && start < logic.tomorrow
    })

    const items: BoardItem[] = [
      ...events.map(e => ({ kind: 'event' as const, data: e, sortTime: new Date(e.start_time).getTime() })),
      ...todo.map(t => ({ kind: 'task' as const, data: t, sortTime: t.scheduled_at ? new Date(t.scheduled_at).getTime() : Infinity })),
      ...todayAiSchedule.map(a => ({
        kind: 'ai' as const,
        data: a,
        sortTime: a.recurrence_cron
          ? cronToSortTime(a.recurrence_cron, logic.selectedDate)
          : a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity,
      })),
    ]
    items.sort((a, b) => a.sortTime - b.sortTime)

    return { boardItems: items, doneCount, eventCount: events.length, todoCount: todo.length - doneCount }
  }, [logic.todayScheduledTasks, logic.unscheduledTasks, logic.calendarEvents, logic.today, logic.tomorrow, allTasks, todayAiSchedule])

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.id, p.title)
    return map
  }, [projects])

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

  // 定期タスクの編集を開始
  const handleEditScheduledTask = useCallback((task: AiTask) => {
    setEditingTask(task)
    setSchedulePrompt(task.prompt)
    setScheduleDatetime(task.scheduled_at ? new Date(task.scheduled_at) : undefined)
    setSelectedRepo(task.cwd || '')
    setScheduleApprovalType(task.approval_type === 'auto' ? 'auto' : 'confirm')
    // cron式からrecurrenceパース
    if (!task.recurrence_cron) {
      setScheduleRecurrence('none')
      setScheduleDays([])
    } else {
      const parts = task.recurrence_cron.trim().split(/\s+/)
      if (parts.length === 5) {
        const [, , , , dow] = parts
        if (dow === '*') {
          setScheduleRecurrence('daily')
          setScheduleDays([])
        } else {
          setScheduleRecurrence('weekly')
          setScheduleDays(dow.split(',').map(Number).filter(n => !isNaN(n)))
        }
      } else {
        setScheduleRecurrence('custom')
        setScheduleCustomCron(task.recurrence_cron)
      }
    }
    setShowScheduleForm(true)
  }, [])

  const handleScheduleSubmit = useCallback(async () => {
    const prompt = schedulePrompt.trim()
    if (!prompt || !scheduleDatetime) return
    setIsScheduling(true)
    setScheduleSuccess(false)
    try {
      const scheduled_at = scheduleDatetime.toISOString()
      const hh = String(scheduleDatetime.getHours()).padStart(2, '0')
      const mm = String(scheduleDatetime.getMinutes()).padStart(2, '0')
      let recurrence_cron: string | undefined
      if (scheduleRecurrence === 'daily') {
        recurrence_cron = `${mm} ${hh} * * *`
      } else if (scheduleRecurrence === 'weekly') {
        const days = scheduleDays.length > 0 ? scheduleDays.join(',') : String(scheduleDatetime.getDay())
        recurrence_cron = `${mm} ${hh} * * ${days}`
      } else if (scheduleRecurrence === 'custom') {
        if (scheduleCustomCron.trim()) {
          recurrence_cron = scheduleCustomCron.trim()
        } else if (scheduleDays.length > 0) {
          const days = scheduleDays.join(',')
          recurrence_cron = `${mm} ${hh} * * ${days}`
        }
      }

      if (editingTask) {
        // 編集モード: PATCH
        const res = await fetch(`/api/ai-tasks/${editingTask.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            scheduled_at,
            recurrence_cron: recurrence_cron || null,
            cwd: selectedRepo || null,
            approval_type: scheduleApprovalType,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to update')
        }
      } else {
        // 新規作成モード: POST
        const res = await fetch('/api/ai-tasks/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            scheduled_at,
            recurrence_cron,
            skill_id: undefined,
            cwd: selectedRepo || undefined,
            approval_type: scheduleApprovalType,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error || 'Failed to schedule')
        }
        const created = await res.json()
        if (created?.id) addTaskOptimistic(created)
      }
      setScheduleSuccess(true)
      setEditingTask(null)
      setSchedulePrompt('')
      setScheduleDatetime(undefined)
      setScheduleRecurrence('none')
      setScheduleCustomCron('')
      setScheduleDays([])
      setScheduleWeekOrdinal('every')
      setSelectedRepo('')
      setScheduleApprovalType('confirm')
      refreshScheduled()
      refreshAiTasks()
      setTimeout(() => {
        setScheduleSuccess(false)
        setShowScheduleForm(false)
      }, 2000)
    } catch (err) {
      console.error('[schedule]', err)
    } finally {
      setIsScheduling(false)
    }
  }, [editingTask, schedulePrompt, scheduleDatetime, scheduleRecurrence, scheduleCustomCron, scheduleDays, selectedRepo, scheduleApprovalType, addTaskOptimistic, refreshScheduled, refreshAiTasks])

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* 日付ヘッダー */}
      <div className="flex-shrink-0 pl-14 pr-6 py-4 border-b">
        <div className="flex items-center gap-1">
          <button
            onClick={logic.goToPrevDay}
            className="p-2 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-lg font-bold">{logic.dateFmt}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {logic.isToday && <span className="text-primary font-semibold">Today · </span>}
              {todoCount > 0 ? `${todoCount}件のタスク` : 'タスクなし'}
              {eventCount > 0 && ` · ${eventCount}件の予定`}
              {doneCount > 0 && ` · ${doneCount}件完了`}
            </p>
          </div>
          <button
            onClick={logic.goToNextDay}
            className="p-2 rounded-full hover:bg-muted/60 transition-colors text-muted-foreground"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Auth Status */}
      <AuthStatusBar />

      {/* セットアップガイド — Claude Code 導入済みのため非表示 */}
      {/* <SetupGuideBanner /> */}

      {/* 承認待ちAIタスク（スクロール外固定） */}
      {pendingApprovalTasks.length > 0 && (
        <div className="flex-shrink-0 px-4 py-3 border-b bg-amber-50/30 dark:bg-amber-950/20 space-y-2 max-h-80 overflow-y-auto">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" />
            確認が必要なAIタスク ({pendingApprovalTasks.length})
          </p>
          {pendingApprovalTasks.map(task => (
            <AiTaskApprovalCard
              key={task.id}
              task={task}
              onApprove={approve}
              onReject={reject}
              onRequestRevision={requestRevision}
            />
          ))}
        </div>
      )}

      {/* スクロールエリア */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="px-4 py-4 space-y-5 pb-10">

          {/* やること（予定・タスク・AIスケジュール統合） */}
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <span>やること</span>
              {boardItems.length > 0 && (
                <span className="text-xs tabular-nums bg-muted rounded-full px-1.5 py-0.5">
                  {boardItems.length}
                </span>
              )}
            </h2>
            <div className="space-y-1">
              {boardItems.map(item => {
                if (item.kind === 'event') {
                  const event = item.data
                  const isDone = !!event.is_completed
                  return (
                    <div
                      key={`event-${event.id}`}
                      className="group flex items-center rounded-lg border border-border/60 bg-background hover:bg-muted/30 transition-colors"
                    >
                      <button
                        onClick={() => logic.toggleEventCompletion(event.id)}
                        className="flex items-center gap-3 py-2.5 px-3 flex-1 min-w-0 text-left"
                      >
                        {isDone
                          ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                          : <Square className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                        }
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[90px]">
                          {formatTimeRange(event.start_time, event.end_time)}
                        </span>
                        <span className={cn("text-sm truncate", isDone && "line-through text-muted-foreground")}>{event.title}</span>
                      </button>
                    </div>
                  )
                }
                if (item.kind === 'ai') {
                  const aiTask = item.data
                  const time = aiTask.recurrence_cron
                    ? (() => { const p = aiTask.recurrence_cron!.trim().split(/\s+/); return `${p[1]?.padStart(2,'0')}:${p[0]?.padStart(2,'0')}` })()
                    : aiTask.scheduled_at ? format(new Date(aiTask.scheduled_at), 'HH:mm') : ''
                  const isDone = aiTask.status === 'completed'
                  const isFailed = aiTask.status === 'failed'
                  const isRunning = aiTask.status === 'running'
                  return (
                    <AiScheduleRow key={`ai-${aiTask.id}`} task={aiTask} time={time} isDone={isDone} isFailed={isFailed} isRunning={isRunning} onCancel={reject} />
                  )
                }
                const task = item.data
                const projectName = task.project_id ? projectNameMap.get(task.project_id) : null
                const taskDone = task.status === 'done'
                return (
                  <div
                    key={`task-${task.id}`}
                    className="group flex items-center rounded-lg border border-border/60 bg-background hover:bg-muted/30 transition-colors"
                  >
                    <button
                      onClick={() => logic.toggleTask(task.id)}
                      className="flex items-center gap-3 py-2.5 px-3 flex-1 min-w-0 text-left"
                    >
                      {taskDone
                        ? <CheckSquare className="w-4 h-4 text-primary shrink-0" />
                        : <Square className="w-4 h-4 text-muted-foreground/40 shrink-0" />
                      }
                      {task.scheduled_at && (
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[90px]">
                          {formatScheduledTime(task.scheduled_at)}
                          {(task.estimated_time ?? 0) > 0 && <span className="text-muted-foreground/50 ml-1">{task.estimated_time}分</span>}
                        </span>
                      )}
                      <span className={cn("text-sm truncate", taskDone && "line-through text-muted-foreground")}>{task.title}</span>
                      {projectName && (
                        <span className="ml-2 text-[10px] text-muted-foreground/60 bg-muted rounded px-1.5 py-0.5">
                          {projectName}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => onDeleteTask?.(task.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 mr-2 rounded text-muted-foreground hover:text-destructive transition-all shrink-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}

              {boardItems.length === 0 && (
                <p className="text-sm text-muted-foreground/50 py-3 text-center">
                  タスクはありません
                </p>
              )}

              {/* インライン追加フォーム */}
              <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-lg border border-dashed border-border/60 hover:border-border transition-colors">
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
                {newTaskTitle.trim() && (
                  <button
                    onClick={handleAddTask}
                    disabled={isAdding}
                    className="text-xs text-primary hover:text-primary/80 font-medium transition-colors disabled:opacity-50"
                  >
                    追加
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 過去日の振り返り */}
          {!logic.isToday && (doneCount > 0 || eventCount > 0) && (
            <section className="rounded-lg bg-muted/30 px-3 py-3">
              <h2 className="text-sm font-semibold text-muted-foreground mb-1.5">
                {format(logic.selectedDate, 'M月d日', { locale: ja })}の振り返り
              </h2>
              <div className="space-y-0.5 text-xs text-muted-foreground">
                {doneCount > 0 && <p>タスク {doneCount}件完了</p>}
                {eventCount > 0 && <p>予定 {eventCount}件</p>}
                {todoCount > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">未完了 {todoCount}件</p>
                )}
              </div>
            </section>
          )}

          {/* 定期タスク */}
          <section ref={scheduleFormRef}>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
              <CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />
              <span>定期タスク</span>
              {scheduledTasks.length > 0 && (
                <span className="text-[10px] bg-primary/10 text-primary rounded-full px-1.5 tabular-nums">
                  {scheduledTasks.length}
                </span>
              )}
            </div>
            <button
              onClick={() => { setEditingTask(null); setShowScheduleForm(prev => !prev) }}
              aria-expanded={showScheduleForm}
              aria-label={showScheduleForm ? 'スケジュール設定を閉じる' : 'スケジュール設定を開く'}
              className={cn(
                'w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors mb-3',
                showScheduleForm
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted border border-border/60'
              )}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>予約</span>
            </button>

            <ScheduledTaskList
              tasks={scheduledTasks}
              isLoading={scheduledLoading}
              onDelete={deleteScheduledTask}
              onRefresh={refreshScheduled}
              onEdit={handleEditScheduledTask}
            />

            {/* スケジュール設定フォーム（ポップアップ） */}
            {showScheduleForm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowScheduleForm(false)}>
              <div className="w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto rounded-xl border border-primary/20 bg-background p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
                {/* 実行内容（自然言語） */}
                <div>
                  <textarea
                    id="schedule-prompt"
                    value={schedulePrompt}
                    onChange={(e) => setSchedulePrompt(e.target.value)}
                    placeholder="例: 経理やって、朝の確認して"
                    rows={2}
                    aria-label="実行内容"
                    className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-muted-foreground/40 border-b border-border/40 pb-2"
                    disabled={isScheduling}
                  />
                </div>

                {/* フォルダ + 開始日時（横並び） */}
                <div className="flex gap-2">
                  <select
                    value={selectedRepo}
                    onChange={(e) => setSelectedRepo(e.target.value)}
                    className="flex-1 min-h-[44px] bg-background text-sm outline-none border border-border/60 rounded-lg px-3 py-2"
                    disabled={isScheduling}
                  >
                    <option value="">フォルダを選択</option>
                    {skillRepos.map(repo => (
                      <option key={repo.path} value={repo.path}>
                        {repo.label}{repo.skills.length > 0 ? ` (${repo.skills.length}スキル)` : ''}
                      </option>
                    ))}
                  </select>

                {/* 開始日時 */}
                <DateTimePicker
                  date={scheduleDatetime}
                  setDate={setScheduleDatetime}
                  trigger={
                    <button
                      type="button"
                      className={cn(
                        'w-full min-h-[44px] rounded-lg border border-border/60 px-3 py-2 text-sm text-left flex items-center gap-2 transition-colors',
                        scheduleDatetime ? 'text-foreground' : 'text-muted-foreground/50',
                        isScheduling && 'opacity-50 pointer-events-none'
                      )}
                    >
                      <CalendarIcon className="w-3.5 h-3.5 shrink-0" />
                      {scheduleDatetime
                        ? format(scheduleDatetime, 'M月d日 (E) HH:mm', { locale: ja })
                        : '開始日時を選択'
                      }
                    </button>
                  }
                />
                </div>

                {/* 繰り返し */}
                <fieldset>
                  <legend className="text-xs text-muted-foreground/70 mb-1.5">繰り返し</legend>
                  <div className="flex gap-2 flex-wrap" role="group" aria-label="繰り返し設定">
                    {(['none', 'daily', 'weekly', 'custom'] as const).map(opt => {
                      const label = opt === 'none' ? 'なし' : opt === 'daily' ? '毎日' : opt === 'weekly' ? '毎週' : 'カスタム'
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setScheduleRecurrence(opt)
                            if (opt !== 'weekly' && opt !== 'custom') setScheduleDays([])
                          }}
                          aria-pressed={scheduleRecurrence === opt}
                          className={cn(
                            'text-sm px-4 min-h-[44px] rounded-full border transition-colors',
                            scheduleRecurrence === opt
                              ? 'bg-primary text-primary-foreground border-primary'
                              : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/40'
                          )}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>

                  {/* 毎週: 曜日選択（1週間ビュー） */}
                  {scheduleRecurrence === 'weekly' && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-1.5 justify-between">
                        {[
                          { day: 1, label: '月' },
                          { day: 2, label: '火' },
                          { day: 3, label: '水' },
                          { day: 4, label: '木' },
                          { day: 5, label: '金' },
                          { day: 6, label: '土' },
                          { day: 0, label: '日' },
                        ].map(({ day, label }) => {
                          const active = scheduleDays.includes(day)
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => setScheduleDays(prev =>
                                active ? prev.filter(d => d !== day) : [...prev, day]
                              )}
                              className={cn(
                                'flex-1 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                                active
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                                day === 0 && 'text-red-400',
                                day === 6 && !active && 'text-blue-400',
                              )}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* カスタム: 曜日 + 第N週 選択 */}
                  {scheduleRecurrence === 'custom' && (
                    <div className="mt-3 space-y-3">
                      {/* 曜日選択 */}
                      <div>
                        <span className="text-xs text-muted-foreground/70 mb-1.5 block">曜日</span>
                        <div className="flex gap-1.5 justify-between">
                          {[
                            { day: 1, label: '月' },
                            { day: 2, label: '火' },
                            { day: 3, label: '水' },
                            { day: 4, label: '木' },
                            { day: 5, label: '金' },
                            { day: 6, label: '土' },
                            { day: 0, label: '日' },
                          ].map(({ day, label }) => {
                            const active = scheduleDays.includes(day)
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => setScheduleDays(prev =>
                                  active ? prev.filter(d => d !== day) : [...prev, day]
                                )}
                                className={cn(
                                  'flex-1 min-h-[44px] rounded-lg text-sm font-medium border transition-colors',
                                  active
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'border-border/60 text-muted-foreground hover:bg-muted/40',
                                  day === 0 && 'text-red-400',
                                  day === 6 && !active && 'text-blue-400',
                                )}
                              >
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* 第N週 選択 */}
                      <div>
                        <span className="text-xs text-muted-foreground/70 mb-1.5 block">頻度</span>
                        <div className="flex gap-2 flex-wrap">
                          {([
                            { value: 'every', label: '毎週' },
                            { value: '1st', label: '第1' },
                            { value: '2nd', label: '第2' },
                            { value: '3rd', label: '第3' },
                            { value: '4th', label: '第4' },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setScheduleWeekOrdinal(opt.value)}
                              aria-pressed={scheduleWeekOrdinal === opt.value}
                              className={cn(
                                'text-sm px-3 min-h-[40px] rounded-lg border transition-colors',
                                scheduleWeekOrdinal === opt.value
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'border-border/60 text-muted-foreground hover:bg-muted/40'
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 選択結果のプレビュー */}
                      {scheduleDays.length > 0 && (
                        <p className="text-xs text-muted-foreground/60">
                          {scheduleWeekOrdinal === 'every' ? '毎週' : scheduleWeekOrdinal === '1st' ? '第1' : scheduleWeekOrdinal === '2nd' ? '第2' : scheduleWeekOrdinal === '3rd' ? '第3' : '第4'}
                          {scheduleDays.sort().map(d => ['日', '月', '火', '水', '木', '金', '土'][d]).join('・')}曜日
                          {scheduleDatetime && ` ${format(scheduleDatetime, 'HH:mm')}`}
                        </p>
                      )}
                    </div>
                  )}
                </fieldset>

                {/* 実行モード */}
                <fieldset>
                  <legend className="text-xs text-muted-foreground/70 mb-1.5">実行モード</legend>
                  <div className="flex gap-2" role="group" aria-label="実行モード">
                    {([
                      { value: 'confirm', label: 'ターミナルで実行', desc: '確認しながら進める' },
                      { value: 'auto', label: '自動実行', desc: 'バックグラウンドで完了' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setScheduleApprovalType(opt.value)}
                        aria-pressed={scheduleApprovalType === opt.value}
                        className={cn(
                          'flex-1 text-sm px-3 min-h-[44px] rounded-lg border transition-colors text-left',
                          scheduleApprovalType === opt.value
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'border-border/60 text-muted-foreground hover:border-border hover:bg-muted/40'
                        )}
                      >
                        <div className="font-medium">{opt.label}</div>
                        <div className={cn('text-[10px] mt-0.5', scheduleApprovalType === opt.value ? 'text-primary-foreground/70' : 'text-muted-foreground/50')}>
                          {opt.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </fieldset>

                {/* 登録ボタン — 44px */}
                <button
                  type="button"
                  onClick={handleScheduleSubmit}
                  disabled={isScheduling || !schedulePrompt.trim() || !scheduleDatetime}
                  aria-busy={isScheduling}
                  aria-disabled={!schedulePrompt.trim() || !scheduleDatetime}
                  className={cn(
                    'w-full min-h-[44px] rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2',
                    scheduleSuccess
                      ? 'bg-green-500 text-white'
                      : schedulePrompt.trim() && scheduleDatetime
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'bg-muted text-muted-foreground cursor-not-allowed'
                  )}
                >
                  {isScheduling ? (
                    <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /><span>{editingTask ? '更新中...' : '登録中...'}</span></>
                  ) : scheduleSuccess ? (
                    <><CheckCircle2 className="w-4 h-4" aria-hidden="true" /><span>{editingTask ? '更新完了' : '登録完了'}</span></>
                  ) : (
                    <><CalendarClock className="w-4 h-4" aria-hidden="true" /><span>{editingTask ? '更新する' : 'スケジュール登録'}</span></>
                  )}
                </button>
              </div>
              </div>
            )}
          </section>

          {/* AI実行ログ（完了・失敗、デフォルト折りたたみ） */}
          {logAiTasks.length > 0 && (
            <section>
              <button
                onClick={() => setShowAiLog(prev => !prev)}
                className="flex items-center gap-1.5 mb-2 text-sm font-semibold text-muted-foreground"
              >
                {showAiLog ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                <Bot className="w-3.5 h-3.5" />
                <span>AI実行ログ</span>
                <span className="text-xs tabular-nums bg-muted rounded-full px-1.5 py-0.5">
                  {logAiTasks.length}
                </span>
              </button>
              {showAiLog && (
                <div className="space-y-1.5">
                  {logAiTasks.map(task => (
                    <AiLogItem key={task.id} task={task} />
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Cronマッチング
// ─────────────────────────────────────────────────────────────────────────────

/** cron式の曜日が指定日にマッチするか判定 */
function cronMatchesDate(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const dow = parts[4]
  if (dow === '*') return true // 毎日
  // カンマ区切り対応 (例: "1,3,5")
  const days = dow.split(',').map(Number)
  return days.includes(date.getDay())
}

/** cron式の時刻をその日のsortTime（ms）に変換 */
function cronToSortTime(cron: string | null, date: Date): number {
  if (!cron) return Infinity
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return Infinity
  const [min, hour] = parts
  const h = parseInt(hour)
  const m = parseInt(min)
  if (isNaN(h) || isNaN(m)) return Infinity
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime()
}

// ─────────────────────────────────────────────────────────────────────────────
// 定期タスク一覧コンポーネント
// ─────────────────────────────────────────────────────────────────────────────
function formatCron(cron: string | null): string {
  if (!cron) return 'ワンタイム'
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return cron
  const [min, hour, , , dow] = parts
  const time = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (dow === '*') return `毎日 ${time}`
  const days = ['日', '月', '火', '水', '木', '金', '土']
  const d = parseInt(dow)
  if (!isNaN(d) && d >= 0 && d <= 6) return `毎週${days[d]} ${time}`
  return `${cron} (${time})`
}

function formatNextRun(scheduledAt: string | null): string {
  if (!scheduledAt) return ''
  const d = new Date(scheduledAt)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  if (diffMs < 0) return '実行待ち'
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 60) return `${diffMin}分後`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}時間後`
  return format(d, 'M/d H:mm', { locale: ja })
}

function ScheduledTaskList({
  tasks,
  isLoading,
  onDelete,
  onRefresh,
  onEdit,
}: {
  tasks: AiTask[]
  isLoading: boolean
  onDelete: (id: string) => Promise<void>
  onRefresh: () => void
  onEdit: (task: AiTask) => void
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm">読み込み中...</span>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="py-5 text-center text-sm text-muted-foreground/60">
        定期タスクは登録されていません
        <br />
        <span className="text-xs">右上の「+ 予約」から登録できます</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground/60">{tasks.length}件登録済み</span>
        <button
          onClick={onRefresh}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          aria-label="更新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>
      {tasks.map(task => (
        <div
          key={task.id}
          onClick={() => onEdit(task)}
          className="flex items-start gap-2 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors"
        >
          <CalendarClock className="w-4 h-4 text-primary/70 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm line-clamp-2">
              {task.skill_id && (
                <span className="text-primary/80 font-medium">/{task.skill_id} </span>
              )}
              {task.prompt}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] text-primary/70 font-medium">
                {formatCron(task.recurrence_cron)}
              </span>
              {task.cwd && (
                <span className="text-[11px] text-muted-foreground/50">
                  {task.cwd.split('/').pop()}
                </span>
              )}
              {task.scheduled_at && (
                <span className="text-[11px] text-muted-foreground/60">
                  次回: {formatNextRun(task.scheduled_at)}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(task.id) }}
            disabled={deletingId === task.id}
            aria-label="削除"
            className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-950/30 text-muted-foreground/40 hover:text-red-500 transition-colors shrink-0 min-h-[36px] min-w-[36px] flex items-center justify-center disabled:opacity-40"
          >
            {deletingId === task.id
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Trash2 className="w-3.5 h-3.5" />
            }
          </button>
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AIスケジュール行（カレンダー予定と同じスタイル）
// ─────────────────────────────────────────────────────────────────────────────
function AiScheduleRow({ task, time, isDone, isFailed, isRunning, onCancel }: {
  task: AiTask
  time: string
  isDone: boolean
  isFailed: boolean
  isRunning: boolean
  onCancel: (id: string) => Promise<unknown>
}) {
  const [expanded, setExpanded] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const isPending = task.status === 'pending'

  const resultText = task.result
    ? typeof task.result === 'object' && 'message' in task.result
      ? String((task.result as { message: unknown }).message).slice(0, 500)
      : JSON.stringify(task.result).replace(/[<>]/g, '').slice(0, 500)
    : null

  const handleCancel = async () => {
    setCancelling(true)
    try { await onCancel(task.id) } finally { setCancelling(false) }
  }

  return (
    <div>
      <div
        className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg border transition-colors text-left bg-purple-50 dark:bg-purple-950/20 border-purple-100 dark:border-purple-900/30"
      >
        {/* チェックボックス（完了/失敗で自動チェック） */}
        {(isDone || isFailed) ? (
          <CheckSquare className="w-4 h-4 text-purple-500 shrink-0" />
        ) : isRunning ? (
          <Loader2 className="w-4 h-4 text-purple-500 shrink-0 animate-spin" />
        ) : (
          <Square className="w-4 h-4 text-purple-400 shrink-0" />
        )}

        {/* 時刻（左側） */}
        <span className="text-xs text-purple-600 dark:text-purple-400 tabular-nums shrink-0 w-[90px]">
          {time}
        </span>

        {/* タスク名（クリックで結果展開） */}
        <button
          onClick={() => resultText && setExpanded(p => !p)}
          className="flex-1 min-w-0 text-left"
        >
          <span className={cn('text-sm truncate', (isDone || isFailed) && 'line-through text-muted-foreground')}>
            {task.skill_id && <span className="text-purple-500/70 font-medium">/{task.skill_id} </span>}
            {task.prompt}
          </span>
        </button>

        {/* キャンセル（pending / running のみ） */}
        {(isPending || isRunning) && (
          <span
            onClick={(e) => { e.stopPropagation(); handleCancel() }}
            className="text-[11px] text-muted-foreground/40 hover:text-red-500 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
          >
            {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : '×'}
          </span>
        )}

        {/* 結果あり表示 */}
        {resultText && (
          <button onClick={() => setExpanded(p => !p)} className="text-muted-foreground/30">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* エラー */}
      {isFailed && task.error && (
        <p className="text-xs text-red-500/70 mt-1 ml-10 line-clamp-2">{task.error}</p>
      )}

      {/* 結果展開 */}
      {expanded && resultText && (
        <pre className="mt-1 ml-10 text-xs bg-background/80 rounded-lg p-2.5 overflow-x-auto max-h-40 overflow-y-auto border border-border/30 whitespace-pre-wrap">
          {resultText}
        </pre>
      )}
    </div>
  )
}

function AiLogItem({ task }: { task: AiTask }) {
  const [expanded, setExpanded] = useState(false)
  const resultText = task.result
    ? typeof task.result === 'object' && 'message' in task.result
      ? String((task.result as { message: unknown }).message).slice(0, 500)
      : JSON.stringify(task.result).replace(/[<>]/g, '').slice(0, 500)
    : null

  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        task.status === 'failed' && 'border-red-200 bg-red-50/50 dark:border-red-900/30 dark:bg-red-950/20',
        task.status === 'completed' && 'border-border/40 bg-muted/20',
      )}
    >
      <div className="flex items-start gap-2">
        {task.status === 'completed'
          ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
          : <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-sm line-clamp-2">{task.prompt}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-muted-foreground">{aiTaskStatusLabel(task.status)}</span>
            <span className="text-[11px] text-muted-foreground/50">{formatRelativeTime(task.created_at)}</span>
          </div>
          {task.status === 'failed' && task.error && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{task.error}</p>
          )}
          {resultText && (
            <>
              <button
                onClick={() => setExpanded(p => !p)}
                className="text-[11px] text-muted-foreground hover:text-foreground mt-1 flex items-center gap-0.5"
              >
                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                結果を{expanded ? '閉じる' : '表示'}
              </button>
              {expanded && (
                <pre className="mt-1.5 text-xs bg-background/80 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto border border-border/40 whitespace-pre-wrap">
                  {resultText}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
