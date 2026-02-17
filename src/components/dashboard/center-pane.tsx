"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Task, Project } from "@/types/database"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Play, Check, ChevronRight, ChevronDown, Plus, Trash2, Pause, Timer, GripVertical, Calendar as CalendarIcon, X, Target, Clock, Maximize2, Minimize2 } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { MindMap } from "./mind-map"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd"
import { PriorityBadge, PriorityPopover, Priority, getPriorityIconColor } from "@/components/ui/priority-select"
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select"
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select"
import { TaskCalendarSyncStatus } from "@/components/tasks/task-calendar-sync-status"
import { useTaskCalendarSync } from "@/hooks/useTaskCalendarSync"
import { DateTimePicker } from "@/lib/dynamic-imports"

type TaskIndex = {
    byId: Map<string, Task>
    childrenByParentId: Map<string, Task[]>
    roots: Task[]
}

function buildTaskIndex(groupTasks: Task[]): TaskIndex {
    const byId = new Map<string, Task>()
    const childrenByParentId = new Map<string, Task[]>()
    const roots: Task[] = []

    for (const t of groupTasks) {
        if (!t?.id) continue
        byId.set(t.id, t)
        if (t.parent_task_id) {
            const arr = childrenByParentId.get(t.parent_task_id) ?? []
            arr.push(t)
            childrenByParentId.set(t.parent_task_id, arr)
        } else {
            roots.push(t)
        }
    }

    for (const [k, arr] of childrenByParentId.entries()) {
        arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        childrenByParentId.set(k, arr)
    }
    roots.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

    return { byId, childrenByParentId, roots }
}

function getChildren(taskId: string, index: TaskIndex): Task[] {
    return index.childrenByParentId.get(taskId) ?? []
}

// Effective minutes for a task subtree:
// - leaf => own estimated_time
// - parent with override (estimated_time > 0) => override value (descendants ignored)
// - parent auto => sum of children's effective minutes
function getTaskEffectiveMinutes(taskId: string, index: TaskIndex): number {
    const self = index.byId.get(taskId)
    if (!self) return 0
    const children = getChildren(taskId, index)
    if (children.length === 0) return self.estimated_time ?? 0

    if ((self.estimated_time ?? 0) > 0) return self.estimated_time

    return children.reduce((acc, child) => acc + getTaskEffectiveMinutes(child.id, index), 0)
}

// Auto minutes for a parent task (ignores the parent's own override)
function getTaskAutoMinutes(taskId: string, index: TaskIndex): number {
    const children = getChildren(taskId, index)
    if (children.length === 0) return index.byId.get(taskId)?.estimated_time ?? 0
    return children.reduce((acc, child) => acc + getTaskEffectiveMinutes(child.id, index), 0)
}

function getGroupAutoMinutes(index: TaskIndex): number {
    return index.roots.reduce((acc, root) => acc + getTaskEffectiveMinutes(root.id, index), 0)
}

interface CenterPaneProps {
    project?: Project
    groups: Task[]
    tasks: Task[]
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateGroup?: (title: string) => Promise<Task | null>
    onDeleteGroup?: (groupId: string) => void
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onBulkDelete?: (groupIds: string[], taskIds: string[]) => Promise<void>
    onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
    onReorderGroup?: (groupId: string, referenceGroupId: string, position: 'above' | 'below') => Promise<void>
    onRefreshCalendar?: () => Promise<void>
}

// Progress Bar Component
function MiniProgress({ value, total }: { value: number, total: number }) {
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
function TaskItem({
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

                                {/* Clear (leaf) / Reset (parent override) - ホバー時のみ表示 */}
                                {(!hasChildren || isEstimatedOverride) && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 p-0 opacity-0 group-hover/estimated:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            onUpdateTask?.(task.id, { estimated_time: 0 })
                                        }}
                                        title={hasChildren ? "自動集計に戻す" : "見積もり時間を削除"}
                                    >
                                        <X className="w-3 h-3" />
                                    </Button>
                                )}
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
                                            {new Date(task.scheduled_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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

export function CenterPane({
    project,
    groups,
    tasks,
    onUpdateProject,
    onCreateGroup,
    onDeleteGroup,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
    onBulkDelete,
    onReorderTask,
    onReorderGroup,
    onRefreshCalendar
}: CenterPaneProps) {
    // Splitter State
    const [topHeight, setTopHeight] = useState(50)
    const containerRef = useRef<HTMLDivElement>(null)
    const isDraggingRef = useRef(false)

    // Fullscreen State
    const [isFullscreen, setIsFullscreen] = useState(false)

    // Escape key to exit fullscreen
    useEffect(() => {
        if (!isFullscreen) return
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsFullscreen(false)
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isFullscreen])

    // Group Collapse State
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

    // Newly created task tracking for auto-focus
    const [newlyCreatedTaskId, setNewlyCreatedTaskId] = useState<string | null>(null)

    // Onboarding tooltip state - localStorageに保存
    const [showDragHint, setShowDragHint] = useState(() => {
        if (typeof window === 'undefined') return true
        const dismissed = localStorage.getItem('drag-hint-dismissed')
        return !dismissed
    })

    const handleDismissHint = useCallback(() => {
        setShowDragHint(false)
        localStorage.setItem('drag-hint-dismissed', 'true')
    }, [])

    const toggleGroup = (groupId: string) => {
        setCollapsedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
    }

    // 新スキーマ: parent_task_id でグループに属するタスクを取得
    const taskIndexByGroupId = useMemo(() => {
        const map = new Map<string, TaskIndex>()
        for (const g of groups) {
            const groupTasks = tasks.filter(t => t.parent_task_id === g.id)
            map.set(g.id, buildTaskIndex(groupTasks))
        }
        return map
    }, [groups, tasks])

    const handleAddTask = async (groupId: string) => {
        if (onCreateTask) {
            const newTask = await onCreateTask(groupId, "New Task", null)
            if (newTask?.id) {
                setNewlyCreatedTaskId(newTask.id)
            }
        }
    }

    // Drag & Drop handler
    const handleDragEnd = useCallback(async (result: DropResult) => {
        if (!result.destination || !onUpdateTask) return;

        const { source, destination, draggableId } = result;

        // Same position - no change
        if (source.index === destination.index && source.droppableId === destination.droppableId) return;

        const groupId = destination.droppableId;
        // 新スキーマ: parent_task_id = groupId でグループ直下のタスクを取得
        const groupTasks = tasks
            .filter(t => t.parent_task_id === groupId)
            .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));

        // Calculate new order_index
        let newOrderIndex: number;
        const destIndex = destination.index;

        // Remove dragged item from list for calculation
        const filteredTasks = groupTasks.filter(t => t.id !== draggableId);

        if (destIndex === 0) {
            // First position
            const firstTask = filteredTasks[0];
            newOrderIndex = firstTask ? (firstTask.order_index ?? 0) - 1 : 0;
        } else if (destIndex >= filteredTasks.length) {
            // Last position
            const lastTask = filteredTasks[filteredTasks.length - 1];
            newOrderIndex = lastTask ? (lastTask.order_index ?? 0) + 1 : destIndex;
        } else {
            // Middle - calculate midpoint
            const prevTask = filteredTasks[destIndex - 1];
            const nextTask = filteredTasks[destIndex];
            const prevIndex = prevTask?.order_index ?? 0;
            const nextIndex = nextTask?.order_index ?? prevIndex + 2;
            newOrderIndex = Math.floor((prevIndex + nextIndex) / 2);

            // If integers collide, reindex all tasks
            if (newOrderIndex === prevIndex || newOrderIndex === nextIndex) {
                newOrderIndex = prevIndex + 1;
            }
        }

        await onUpdateTask(draggableId, { order_index: newOrderIndex });
    }, [tasks, onUpdateTask]);

    // Splitter Logic
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRef.current = true
        e.preventDefault()
    }, [])

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDraggingRef.current || !containerRef.current) return
        const containerRect = containerRef.current.getBoundingClientRect()
        const newHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100
        if (newHeight >= 20 && newHeight <= 80) setTopHeight(newHeight)
    }, [])

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false
    }, [])

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [handleMouseMove, handleMouseUp])

    if (!project) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground bg-background">
                Select a project to view details
            </div>
        )
    }

    return (
        <div ref={containerRef} className="h-full flex flex-col bg-background overflow-hidden relative">
            {/* Mind Map Area - Fullscreen or Split */}
            {isFullscreen ? (
                <div className="fixed inset-0 z-50 bg-background">
                    <MindMap
                        project={project}
                        groups={groups}
                        tasks={tasks}
                        onUpdateProject={onUpdateProject}
                        onCreateGroup={onCreateGroup}
                        onDeleteGroup={onDeleteGroup}
                        onCreateTask={onCreateTask}
                        onUpdateTask={onUpdateTask}
                        onDeleteTask={onDeleteTask}
                        onBulkDelete={onBulkDelete}
                        onReorderTask={onReorderTask}
                        onReorderGroup={onReorderGroup}
                        onRefreshCalendar={onRefreshCalendar}
                    />
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setIsFullscreen(false)}
                        className="absolute top-3 right-14 z-10 h-8 w-8 bg-background/80 backdrop-blur"
                    >
                        <Minimize2 className="h-4 w-4" />
                    </Button>
                </div>
            ) : (
                <>
                    <div style={{ height: `${topHeight}%` }} className="min-h-[100px] border-b bg-muted/5 relative overflow-hidden group flex flex-col transition-none">
                        <MindMap
                            project={project}
                            groups={groups}
                            tasks={tasks}
                            onUpdateProject={onUpdateProject}
                            onCreateGroup={onCreateGroup}
                            onDeleteGroup={onDeleteGroup}
                            onCreateTask={onCreateTask}
                            onUpdateTask={onUpdateTask}
                            onDeleteTask={onDeleteTask}
                            onReorderTask={onReorderTask}
                            onReorderGroup={onReorderGroup}
                            onRefreshCalendar={onRefreshCalendar}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setIsFullscreen(true)}
                            className="absolute top-3 right-14 z-10 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Maximize2 className="h-4 w-4" />
                        </Button>
                    </div>

                    {/* Splitter Handle */}
                    <div
                        className="h-2 bg-background border-b hover:bg-primary/10 cursor-row-resize flex items-center justify-center z-10 -mt-1"
                        onMouseDown={handleMouseDown}
                    >
                        <div className="w-8 h-1 bg-muted-foreground/20 rounded-full" />
                    </div>
                </>
            )}

            {/* Task List (Bottom) - hidden in fullscreen */}
            <div className={cn("flex-1 min-h-0 bg-background flex flex-col", isFullscreen && "hidden")}>
                <div className="px-4 py-2 border-b flex justify-between items-center bg-card">
                    <h2 className="font-semibold text-sm">タスク</h2>
                </div>

                {/* オンボーディングツールチップ - 初回ユーザー向け */}
                {showDragHint && (
                    <div className="mx-2 mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg flex items-start gap-2">
                        <CalendarIcon className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                        <div className="flex-1 text-xs text-blue-700 dark:text-blue-300">
                            <span className="font-semibold">ヒント:</span> タスクをカレンダーにドラッグしてスケジュール設定
                            <button
                                onClick={handleDismissHint}
                                className="ml-2 text-blue-500 hover:text-blue-700 underline"
                            >
                                閉じる
                            </button>
                        </div>
                    </div>
                )}

                <DragDropContext onDragEnd={handleDragEnd}>
                    <ScrollArea className="flex-1 h-full overflow-y-auto">
                        <div className="space-y-3 p-2 pb-20">
                            {groups.map((group) => {
                                // 新スキーマ: parent_task_id = group.id でグループ直下のタスクを取得
                                const parentTasks = tasks
                                    .filter(t => t.parent_task_id === group.id)
                                    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))

                                // グループに属する全タスクを取得（進捗計算用）
                                const allGroupTasks = tasks.filter(t => t.parent_task_id === group.id)
                                const groupIndex = taskIndexByGroupId.get(group.id) ?? buildTaskIndex(allGroupTasks)
                                const groupAutoMinutes = getGroupAutoMinutes(groupIndex)
                                const groupIsOverridden = (group.estimated_time ?? 0) > 0
                                const groupDisplayMinutes = groupIsOverridden ? (group.estimated_time ?? 0) : groupAutoMinutes
                                const completedCount = allGroupTasks.filter(t => t.status === 'done').length
                                const isCollapsed = collapsedGroups[group.id]

                                // Auto-complete logic: Check if all tasks are completed
                                const isGroupCompleted = allGroupTasks.length > 0 && allGroupTasks.every(t => t.status === 'done')

                                // Calculate total elapsed time for all tasks in group
                                const totalElapsedSeconds = allGroupTasks.reduce((acc, t) => acc + (t.total_elapsed_seconds ?? 0), 0)

                                // Handle group checkbox toggle
                                const handleGroupCheckToggle = async () => {
                                    const newStatus = isGroupCompleted ? 'todo' : 'done'
                                    // Update all tasks in group
                                    for (const task of allGroupTasks) {
                                        await onUpdateTask?.(task.id, { status: newStatus })
                                    }
                                }

                                return (
                                    <div key={group.id} className="rounded-lg border bg-card overflow-hidden">
                                        {/* Group Header */}
                                        <div className="group flex items-center gap-2 p-2 bg-muted/30 hover:bg-muted/50 transition-colors">
                                            {/* Checkbox (Auto-complete) */}
                                            <button
                                                className={cn(
                                                    "w-5 h-5 rounded border flex items-center justify-center transition-colors shrink-0",
                                                    isGroupCompleted ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/30 hover:border-primary"
                                                )}
                                                onClick={handleGroupCheckToggle}
                                                title={isGroupCompleted ? "グループを未完了に戻す" : "グループを完了"}
                                            >
                                                {isGroupCompleted && <Check className="w-3.5 h-3.5" />}
                                            </button>

                                            {/* Collapse/Expand Button */}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-5 w-5 shrink-0 text-muted-foreground"
                                                onClick={() => toggleGroup(group.id)}
                                            >
                                                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                            </Button>

                                            {/* Group Title */}
                                            <input
                                                key={group.title}
                                                className="font-medium text-sm bg-transparent border-none focus:outline-none focus:ring-0 px-1 min-w-0 flex-1"
                                                defaultValue={group.title}
                                                onBlur={(e) => {
                                                    if (e.target.value !== group.title) {
                                                        onUpdateTask?.(group.id, { title: e.target.value })
                                                    }
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.nativeEvent.isComposing) return;
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        e.currentTarget.blur();
                                                    }
                                                }}
                                            />

                                            {/* Total Elapsed Time */}
                                            {totalElapsedSeconds > 0 && (
                                                <span className="text-xs font-mono tabular-nums text-muted-foreground px-1.5 py-0.5 rounded">
                                                    <Timer className="inline w-3 h-3 mr-1" />
                                                    {formatTime(totalElapsedSeconds)}
                                                </span>
                                            )}

                                            {/* Progress */}
                                            <MiniProgress value={completedCount} total={allGroupTasks.length} />

                                            {/* Group Controls */}
                                            <div className="flex items-center gap-3">
                                                {/* Estimated Time (Group total; auto + manual override) */}
                                                <div className="flex items-center gap-1">
                                                    {groupDisplayMinutes > 0 ? (
                                                        <div className="group/estimated flex items-center gap-0.5">
                                                            <EstimatedTimePopover
                                                                valueMinutes={groupDisplayMinutes}
                                                                onChangeMinutes={(minutes) => onUpdateTask?.(group.id, { estimated_time: minutes })}
                                                                isOverridden={groupIsOverridden}
                                                                autoMinutes={groupAutoMinutes}
                                                                onResetAuto={() => onUpdateTask?.(group.id, { estimated_time: 0 })}
                                                                trigger={
                                                                    <span
                                                                        className="cursor-pointer"
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    >
                                                                        <EstimatedTimeBadge
                                                                            minutes={groupDisplayMinutes}
                                                                            title={
                                                                                groupIsOverridden
                                                                                    ? `手動設定（自動集計: ${groupAutoMinutes > 0 ? formatEstimatedTime(groupAutoMinutes) : "0分"}）`
                                                                                    : `自動集計（全階層）: ${formatEstimatedTime(groupAutoMinutes)}`
                                                                            }
                                                                        />
                                                                    </span>
                                                                }
                                                            />
                                                            {groupIsOverridden && (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-4 w-4 p-0 opacity-0 group-hover/estimated:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation()
                                                                        onUpdateTask?.(group.id, { estimated_time: 0 })
                                                                    }}
                                                                    title="自動集計に戻す"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <EstimatedTimePopover
                                                            valueMinutes={0}
                                                            onChangeMinutes={(minutes) => onUpdateTask?.(group.id, { estimated_time: minutes })}
                                                            isOverridden={false}
                                                            autoMinutes={groupAutoMinutes}
                                                            trigger={
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6 text-zinc-500 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                                                                    title="見積もり（ルートタスク上書き）"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <Clock className="w-4 h-4" />
                                                                </Button>
                                                            }
                                                        />
                                                    )}
                                                </div>

                                                {/* Priority */}
                                                <div className="flex items-center gap-1">
                                                    {group.priority != null ? (
                                                        <>
                                                            <PriorityPopover
                                                                value={group.priority as Priority}
                                                                onChange={(priority) => onUpdateTask?.(group.id, { priority })}
                                                                trigger={
                                                                    <span className="cursor-pointer">
                                                                        <PriorityBadge value={group.priority as Priority} />
                                                                    </span>
                                                                }
                                                            />
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-4 w-4 text-zinc-500 hover:text-red-400 transition-colors"
                                                                onClick={(e) => {
                                                                    e.stopPropagation()
                                                                    onUpdateTask?.(group.id, { priority: undefined as any })
                                                                }}
                                                                title="優先度を削除"
                                                            >
                                                                <X className="w-3 h-3" />
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <PriorityPopover
                                                            value={3}
                                                            onChange={(priority) => onUpdateTask?.(group.id, { priority })}
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

                                                {/* Date */}
                                                <div className="flex items-center gap-1">
                                                    <DateTimePicker
                                                        date={group.scheduled_at ? new Date(group.scheduled_at) : undefined}
                                                        setDate={(date) => onUpdateTask?.(group.id, { scheduled_at: date ? date.toISOString() : null })}
                                                        trigger={
                                                            group.scheduled_at ? (
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer">
                                                                        {new Date(group.scheduled_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                                    </span>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-4 w-4 text-zinc-500 hover:text-red-400 transition-colors"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation()
                                                                            onUpdateTask?.(group.id, { scheduled_at: null })
                                                                        }}
                                                                        title="日時設定を削除"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </Button>
                                                                </div>
                                                            ) : (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6 text-zinc-500 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100"
                                                                    title="日時設定"
                                                                >
                                                                    <CalendarIcon className="w-4 h-4" />
                                                                </Button>
                                                            )
                                                        }
                                                    />
                                                </div>

                                                {/* Calendar Selection */}
                                                <TaskCalendarSelect
                                                    value={group.calendar_id ?? null}
                                                    onChange={(calendarId) => onUpdateTask?.(group.id, { calendar_id: calendarId })}
                                                    className={group.calendar_id ? "" : "opacity-0 group-hover:opacity-100"}
                                                />

                                                {/* Add Task Button */}
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-[10px] gap-1 opacity-0 group-hover:opacity-100"
                                                    onClick={() => handleAddTask(group.id)}
                                                    title="タスク追加"
                                                >
                                                    <Plus className="w-3 h-3" />
                                                    追加
                                                </Button>

                                                {/* Delete Group Button */}
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-6 w-6 text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100"
                                                    onClick={() => onDeleteGroup?.(group.id)}
                                                    title="グループ削除"
                                                >
                                                    <Trash2 className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Tasks */}
                                        {!isCollapsed && (
                                            <Droppable droppableId={group.id}>
                                                {(provided) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.droppableProps}
                                                        className="border-t divide-y"
                                                    >
                                                        {parentTasks.map((task, index) => (
                                                            <Draggable key={task.id} draggableId={task.id} index={index}>
                                                                {(provided, snapshot) => (
                                                                    <div
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        className={cn(
                                                                            snapshot.isDragging && "bg-muted/50 shadow-lg rounded"
                                                                        )}
                                                                    >
                                                                        <TaskItem
                                                                            task={task}
                                                                            allTasks={allGroupTasks}
                                                                            taskIndex={groupIndex}
                                                                            onUpdateTask={onUpdateTask}
                                                                            onDeleteTask={onDeleteTask}
                                                                            onCreateTask={onCreateTask}
                                                                            groupId={group.id}
                                                                            dragHandleProps={provided.dragHandleProps}
                                                                            newlyCreatedTaskId={newlyCreatedTaskId}
                                                                            onClearNewlyCreated={() => setNewlyCreatedTaskId(null)}
                                                                            onRefreshCalendar={onRefreshCalendar}
                                                                        />
                                                                    </div>
                                                                )}
                                                            </Draggable>
                                                        ))}
                                                        {provided.placeholder}

                                                        {/* Add Task Button */}
                                                        <button
                                                            className="w-full p-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/20 flex items-center justify-center gap-2 transition-colors"
                                                            onClick={() => handleAddTask(group.id)}
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                            タスクを追加...
                                                        </button>
                                                    </div>
                                                )}
                                            </Droppable>
                                        )}
                                    </div>
                                )
                            })}

                            <Button
                                variant="outline"
                                className="w-full border-dashed text-muted-foreground"
                                onClick={() => onCreateGroup?.("New Task")}
                            >
                                <Plus className="w-4 h-4 mr-2" />
                                新しいタスクを追加
                            </Button>
                        </div>
                    </ScrollArea>
                </DragDropContext>
            </div>
        </div>
    )
}
