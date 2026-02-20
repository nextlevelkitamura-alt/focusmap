"use client"

import { useState, useRef, useEffect } from "react"
import { Task } from "@/types/database"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Play, Check, ChevronRight, ChevronDown, Plus, Trash2, Pause, Timer, GripVertical, Calendar as CalendarIcon, X, Target, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { PriorityBadge, PriorityPopover, Priority } from "@/components/ui/priority-select"
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select"
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select"
import { TaskCalendarSyncStatus } from "@/components/tasks/task-calendar-sync-status"
import { useTaskCalendarSync } from "@/hooks/useTaskCalendarSync"
import { DateTimePicker } from "@/lib/dynamic-imports"
import { format } from "date-fns"
import { TaskIndex, getChildren, getTaskAutoMinutes } from "@/lib/task-index-utils"

// Progress Bar Component
export function MiniProgress({ value, total }: { value: number, total: number }) {
    const percentage = total === 0 ? 0 : Math.round((value / total) * 100)
    return (
        <div className="flex items-center gap-2 min-w-[80px]">
            <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary/70 rounded-full transition-all duration-500" style={{ width: `${percentage}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">{value}/{total}</span>
        </div>
    )
}

// Task Item Component (Recursive for parent-child, supports up to 6 levels)
export function TaskItem({
    task,
    allTasks,
    taskIndex,
    depth = 0,
    onUpdateTask,
    onDeleteTask,
    onCreateTask,
    groupId,
    dragHandleProps,
    newlyCreatedTaskId,
    onClearNewlyCreated,
    onRefreshCalendar
}: {
    task: Task
    allTasks: Task[]
    taskIndex: TaskIndex
    depth?: number
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    groupId: string
    dragHandleProps?: any
    newlyCreatedTaskId?: string | null
    onClearNewlyCreated?: () => void
    onRefreshCalendar?: () => Promise<void>
}) {
    const [isExpanded, setIsExpanded] = useState(true)
    const inputRef = useRef<HTMLInputElement>(null)

    // Auto-focus for newly created tasks
    useEffect(() => {
        if (task.id === newlyCreatedTaskId && inputRef.current) {
            setTimeout(() => {
                inputRef.current?.focus()
                inputRef.current?.select()
                // Clear the flag after focusing
                onClearNewlyCreated?.()
            }, 50)
        }
    }, [task.id, newlyCreatedTaskId, onClearNewlyCreated])

    // 外部からのタイトル変更を同期（カレンダー編集モーダルからの更新など）
    // input が未フォーカス時のみ更新（ユーザーの入力中は上書きしない）
    useEffect(() => {
        if (inputRef.current && inputRef.current !== document.activeElement) {
            inputRef.current.value = task.title
        }
    }, [task.title])

    // Max depth limit (6 levels)
    const MAX_DEPTH = 6;
    const canAddChildren = depth < MAX_DEPTH - 1;

    // Safety: Return null if task is invalid
    if (!task || !task.id) {
        return null;
    }

    // Safely filter allTasks to prevent undefined access
    const safeTasks = (allTasks ?? []).filter(t => t && t.id);

    // Get child tasks
    const childTasks = getChildren(task.id, taskIndex)
    const hasChildren = childTasks.length > 0

    // Calculate progress for parent tasks
    const completedChildren = childTasks.filter(t => t.status === 'done').length

    const isEstimatedOverride = hasChildren && (task.estimated_time ?? 0) > 0
    const autoEstimatedMinutes = hasChildren ? getTaskAutoMinutes(task.id, taskIndex) : 0
    const displayEstimatedMinutes = hasChildren
        ? (isEstimatedOverride ? (task.estimated_time ?? 0) : autoEstimatedMinutes)
        : (task.estimated_time ?? 0)

    const handleAddChildTask = async () => {
        if (onCreateTask) {
            const newTask = await onCreateTask(groupId, "New Subtask", task.id)
            if (newTask?.id && onClearNewlyCreated) {
                // This will be handled by parent CenterPane
            }
        }
    }

    // Timer hook
    const { runningTaskId, currentElapsedSeconds, startTimer, pauseTimer, completeTimer, interruptTimer, isLoading } = useTimer();
    const isTimerRunning = runningTaskId === task.id;

    // Calendar sync hook（カレンダー同期の一元管理）
    const { status: syncStatus, error: syncError, retry: syncRetry } = useTaskCalendarSync({
        taskId: task.id,
        scheduled_at: task.scheduled_at,
        estimated_time: task.estimated_time,
        calendar_id: task.calendar_id,
        google_event_id: task.google_event_id,
        enabled: !task.is_group, // グループは同期しない
        onSyncSuccess: async () => {
            // カレンダーを更新
            await onRefreshCalendar?.()
        },
        onGoogleEventIdChange: (googleEventId) => {
            // 同期成功時に google_event_id をローカルステートに反映
            onUpdateTask?.(task.id, { google_event_id: googleEventId })
        }
    });

    // Calculate elapsed time for this task
    const taskElapsedSeconds = isTimerRunning
        ? currentElapsedSeconds
        : (task.total_elapsed_seconds ?? 0);


    return (
        <div className="w-full">
            <div
                className="group flex items-center gap-2 p-2 hover:bg-muted/10 transition-colors"
                style={{ paddingLeft: `calc(${depth * 1.5}rem + 0.5rem)` }}
            >
                {/* Expand/Collapse for parent tasks */}
                {hasChildren ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                        onClick={() => setIsExpanded(!isExpanded)}
                    >
                        {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </Button>
                ) : (
                    <div className="w-5" />
                )}

                {/* Checkbox */}
                <button
                    className={cn(
                        "w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0",
                        task.status === 'done' ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 hover:border-primary"
                    )}
                    onClick={() => onUpdateTask?.(task.id, { status: task.status === 'done' ? 'todo' : 'done' })}
                >
                    {task.status === 'done' && <Check className="w-3.5 h-3.5" />}
                </button>

                {/* Title */}
                <input
                    ref={inputRef}
                    className={cn(
                        "flex-1 bg-transparent border-none text-sm focus:outline-none focus:ring-0 px-1 min-w-0",
                        task.status === 'done' && "text-muted-foreground line-through"
                    )}
                    defaultValue={task.title}
                    onBlur={(e) => {
                        const newValue = e.target.value;
                        if (newValue !== task.title) {
                            onUpdateTask?.(task.id, { title: newValue })
                        }
                    }}
                    onKeyDown={(e) => {
                        // Skip if IME is composing (Japanese/Chinese input)
                        if (e.nativeEvent.isComposing) return;

                        if (e.key === 'Enter') {
                            e.preventDefault();
                            e.currentTarget.blur();
                        }
                    }}
                />

                {/* Progress Bar for parent tasks with children */}
                {hasChildren && (
                    <MiniProgress value={completedChildren} total={childTasks.length} />
                )}

                {/* Timer & Date Controls */}
                <div className="flex items-center gap-3">
                    {/* Timer Controls */}
                    <div className="flex items-center gap-1">
                        {isTimerRunning ? (
                            /* 実行中: コンパクトに統合 */
                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 border border-primary/20">
                                {/* 時間表示 */}
                                <span className="text-[10px] font-mono text-primary tabular-nums">
                                    <Timer className="inline w-3 h-3 mr-0.5" />
                                    {formatTime(taskElapsedSeconds)}
                                </span>

                                {/* 区切り線 */}
                                <div className="h-3 w-px bg-primary/20 mx-0.5" />

                                {/* 一時停止ボタン */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 text-amber-500 hover:bg-amber-500/10 p-0"
                                    onClick={() => pauseTimer()}
                                    disabled={isLoading}
                                    title="一時停止"
                                >
                                    <Pause className="w-3 h-3" />
                                </Button>

                                {/* 完了ボタン */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 text-green-500 hover:bg-green-500/10 p-0"
                                    onClick={() => completeTimer()}
                                    disabled={isLoading}
                                    title="完了"
                                >
                                    <Check className="w-3 h-3" />
                                </Button>
                            </div>
                        ) : (
                            /* 停止中 */
                            <>
                                {taskElapsedSeconds > 0 ? (
                                    /* 記録時間あり: 統合ボタン + 削除ボタン（ホバーで▶と×出現） */
                                    <div className="group flex items-center gap-0.5">
                                        {/* クリックで再開 */}
                                        <button
                                            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-foreground hover:bg-muted/30 hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            onClick={() => startTimer(task)}
                                            disabled={isLoading || task.status === 'done'}
                                            title="クリックでタイマー再開"
                                        >
                                            <Timer className="w-3 h-3" />
                                            <span className="tabular-nums">{formatTime(taskElapsedSeconds)}</span>

                                            {/* 再開アイコン（ホバー時のみ表示） */}
                                            <Play className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity ml-0.5" />
                                        </button>

                                        {/* 削除ボタン（ホバー時のみ表示） */}
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                onUpdateTask?.(task.id, { total_elapsed_seconds: 0 })
                                            }}
                                            disabled={isLoading}
                                            title="タイマー記録を削除"
                                        >
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    /* 記録時間なし: Focusボタン（再生マーク + "Focus"テキスト） */
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className={cn(
                                            "h-6 px-2 gap-1 text-[10px]",
                                            runningTaskId && runningTaskId !== task.id
                                                ? "border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
                                                : "hover:bg-primary hover:text-primary-foreground"
                                        )}
                                        onClick={() => startTimer(task)}
                                        disabled={isLoading || task.status === 'done'}
                                        title={runningTaskId && runningTaskId !== task.id ? "別タスクで計測中（切替可能）" : "タイマー開始"}
                                    >
                                        <Play className="w-3 h-3" />
                                        <span>Focus</span>
                                    </Button>
                                )}
                            </>
                        )}
                    </div>

                    {/* Group 1.5: Estimated Time */}
                    <div className="flex items-center gap-1">
                        {displayEstimatedMinutes > 0 ? (
                            <div className="group/estimated flex items-center gap-0.5">
                                <EstimatedTimePopover
                                    valueMinutes={displayEstimatedMinutes}
                                    onChangeMinutes={(minutes) => onUpdateTask?.(task.id, { estimated_time: minutes })}
                                    isOverridden={isEstimatedOverride}
                                    autoMinutes={hasChildren ? autoEstimatedMinutes : undefined}
                                    onResetAuto={hasChildren ? () => onUpdateTask?.(task.id, { estimated_time: 0 }) : undefined}
                                    trigger={
                                        <span
                                            className="cursor-pointer"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <EstimatedTimeBadge
                                                minutes={displayEstimatedMinutes}
                                                title={
                                                    hasChildren
                                                        ? (isEstimatedOverride
                                                            ? `手動設定（自動集計: ${autoEstimatedMinutes > 0 ? formatEstimatedTime(autoEstimatedMinutes) : "0分"}）`
                                                            : `子孫合計: ${formatEstimatedTime(displayEstimatedMinutes)}`)
                                                        : `見積もり: ${formatEstimatedTime(displayEstimatedMinutes)}`
                                                }
                                            />
                                        </span>
                                    }
                                />

                                {/* Clear button - ホバー時のみ */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 opacity-0 group-hover/estimated:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onUpdateTask?.(task.id, { estimated_time: 0 })
                                    }}
                                    title="見積もり時間を削除"
                                >
                                    <X className="w-3 h-3" />
                                </Button>
                            </div>
                        ) : (
                            <EstimatedTimePopover
                                valueMinutes={0}
                                onChangeMinutes={(minutes) => onUpdateTask?.(task.id, { estimated_time: minutes })}
                                isOverridden={false}
                                autoMinutes={hasChildren ? autoEstimatedMinutes : undefined}
                                trigger={
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-zinc-500 hover:text-zinc-400 opacity-0 group-hover:opacity-100"
                                        title={hasChildren ? "見積もり（親タスク上書き）" : "見積もり時間を設定"}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <Clock className="w-4 h-4" />
                                    </Button>
                                }
                            />
                        )}
                    </div>

                    {/* Group 2: Priority */}
                    <div className="flex items-center gap-1">
                        {task.priority ? (
                            <div className="group/priority flex items-center gap-0.5">
                                {/* Priority Badge (clickable) */}
                                <PriorityPopover
                                    value={task.priority as Priority}
                                    onChange={(priority) => onUpdateTask?.(task.id, { priority })}
                                    trigger={
                                        <span className="cursor-pointer">
                                            <PriorityBadge value={task.priority as Priority} />
                                        </span>
                                    }
                                />

                                {/* Clear Button - ホバー時のみ表示 */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 opacity-0 group-hover/priority:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onUpdateTask?.(task.id, { priority: undefined as any })
                                    }}
                                    title="優先度を削除"
                                >
                                    <X className="w-3 h-3" />
                                </Button>
                            </div>
                        ) : (
                            /* Priority not set: Icon only (gray) */
                            <PriorityPopover
                                value={3}
                                onChange={(priority) => onUpdateTask?.(task.id, { priority })}
                                trigger={
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-zinc-500 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                                        title="優先度を設定"
                                    >
                                        <Target className="w-4 h-4" />
                                    </Button>
                                }
                            />
                        )}
                    </div>

                    {/* Group 3: Date Info */}
                    <div className="flex items-center gap-1">
                        {task.scheduled_at ? (
                            <div className="group/datetime flex items-center gap-0.5">
                                {/* Date Text (clickable) */}
                                <DateTimePicker
                                    date={new Date(task.scheduled_at)}
                                    setDate={(date) => onUpdateTask?.(task.id, { scheduled_at: date ? date.toISOString() : null })}
                                    trigger={
                                        <span className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
                                            {format(new Date(task.scheduled_at), 'M/d HH:mm')}
                                        </span>
                                    }
                                />

                                {/* Clear Button - ホバー時のみ表示 */}
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-4 w-4 p-0 opacity-0 group-hover/datetime:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onUpdateTask?.(task.id, { scheduled_at: null })
                                    }}
                                    title="日時設定を削除"
                                >
                                    <X className="w-3 h-3" />
                                </Button>
                            </div>
                        ) : (
                            /* Date not set: Calendar icon only */
                            <DateTimePicker
                                date={undefined}
                                setDate={(date) => onUpdateTask?.(task.id, { scheduled_at: date ? date.toISOString() : null })}
                                trigger={
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-zinc-500 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                                        title="日時設定"
                                    >
                                        <CalendarIcon className="w-4 h-4" />
                                    </Button>
                                }
                            />
                        )}
                    </div>

                    {/* Group 3.5: Calendar Selection + Sync Status */}
                    <div className="flex items-center gap-1">
                        <TaskCalendarSelect
                            value={task.calendar_id}
                            onChange={(calendarId) => onUpdateTask?.(task.id, { calendar_id: calendarId })}
                            className={task.calendar_id ? "" : "opacity-0 group-hover:opacity-100"}
                        />
                        <TaskCalendarSyncStatus
                            status={syncStatus}
                            error={syncError}
                            onRetry={syncRetry}
                        />
                    </div>

                    {/* Group 4: Other Actions (Hover) */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canAddChildren && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-primary"
                                onClick={handleAddChildTask}
                                title="サブタスク追加"
                            >
                                <Plus className="w-3 h-3" />
                            </Button>
                        )}

                        {/* Direct Delete Button */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-destructive hover:bg-destructive/10"
                            onClick={() => onDeleteTask?.(task.id)}
                            title="削除"
                        >
                            <Trash2 className="w-3 h-3" />
                        </Button>

                        {/* Drag Handle - 並び替え用（depth === 0 のみ） */}
                        {depth === 0 && dragHandleProps && (
                            <div
                                {...dragHandleProps}
                                className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors p-1 rounded hover:bg-muted/50"
                                title="ドラッグして並び替え"
                            >
                                <GripVertical className="h-4 w-4" />
                            </div>
                        )}

                        {/* Calendar Drag Handle - カレンダーにドラッグ用 */}
                        <div
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', task.id)
                                e.dataTransfer.effectAllowed = 'copy'

                                // カスタムドラッグゴーストを作成
                                const ghost = document.createElement('div')
                                ghost.className = 'px-3 py-2 bg-primary text-primary-foreground text-xs rounded shadow-lg border border-primary/20 flex items-center gap-2 pointer-events-none'
                                ghost.innerHTML = `
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                    <line x1="16" y1="2" x2="16" y2="6"></line>
                                    <line x1="8" y1="2" x2="8" y2="6"></line>
                                    <line x1="3" y1="10" x2="21" y2="10"></line>
                                </svg>
                                <span class="font-medium">${task.title || 'タスク'}</span>
                            `
                                document.body.appendChild(ghost)
                                e.dataTransfer.setDragImage(ghost, 20, 20)
                                setTimeout(() => ghost.remove(), 0)
                            }}
                            className="cursor-grab active:cursor-grabbing text-blue-500/30 hover:text-blue-500 transition-colors p-1 rounded hover:bg-blue-500/10"
                            title="カレンダーにドラッグしてスケジュール"
                        >
                            <CalendarIcon className="h-4 w-4" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Child Tasks (Recursive) */}
            {hasChildren && isExpanded && (
                <div className="border-l border-muted" style={{ marginLeft: `calc(${depth * 1.5}rem + 1.5rem)` }}>
                    {childTasks.map(child => (
                        <TaskItem
                            key={child.id}
                            task={child}
                            allTasks={allTasks}
                            taskIndex={taskIndex}
                            depth={depth + 1}
                            onUpdateTask={onUpdateTask}
                            onDeleteTask={onDeleteTask}
                            onCreateTask={onCreateTask}
                            groupId={groupId}
                            newlyCreatedTaskId={newlyCreatedTaskId}
                            onClearNewlyCreated={onClearNewlyCreated}
                            onRefreshCalendar={onRefreshCalendar}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}
