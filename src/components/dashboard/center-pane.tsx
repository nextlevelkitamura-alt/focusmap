"use client"

import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { Task, Project } from "@/types/database"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Check, ChevronRight, ChevronDown, Plus, Trash2, Timer, Calendar as CalendarIcon, X, Target, Clock, Maximize2, Minimize2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { MindMap } from "./mind-map"
import { formatTime } from "@/contexts/TimerContext"
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd"
import { PriorityBadge, PriorityPopover, Priority } from "@/components/ui/priority-select"
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select"
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select"
import { DateTimePicker } from "@/lib/dynamic-imports"
import { format } from "date-fns"
import { TaskIndex, buildTaskIndex, getGroupAutoMinutes } from "@/lib/task-index-utils"
import { MiniProgress, TaskItem } from "./center-pane-task-item"

interface CenterPaneProps {
    project?: Project
    groups: Task[]
    tasks: Task[]
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateGroup?: (title: string) => Promise<Task | null>
    onDeleteGroup?: (groupId: string) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onBulkDelete?: (groupIds: string[], taskIds: string[]) => Promise<void>
    onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
    onReorderGroup?: (groupId: string, referenceGroupId: string, position: 'above' | 'below') => Promise<void>
    onRefreshCalendar?: () => Promise<void>
    onAddOptimisticEvent?: (event: import('@/types/calendar').CalendarEvent) => void
    onRemoveOptimisticEvent?: (eventId: string) => void
    isTaskListVisible?: boolean
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
    onRefreshCalendar,
    onAddOptimisticEvent,
    onRemoveOptimisticEvent,
    isTaskListVisible = false,
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
    const [showDragHint, setShowDragHint] = useState(true)
    useEffect(() => {
        const dismissed = localStorage.getItem('drag-hint-dismissed')
        if (dismissed) setShowDragHint(false)
    }, [])

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
                        onAddOptimisticEvent={onAddOptimisticEvent}
                        onRemoveOptimisticEvent={onRemoveOptimisticEvent}
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
                    <div
                        style={{ height: isTaskListVisible ? `${topHeight}%` : '100%' }}
                        className={cn(
                            "min-h-[100px] bg-muted/5 relative overflow-hidden group flex flex-col transition-none",
                            isTaskListVisible && "border-b"
                        )}
                    >
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
                    {isTaskListVisible && (
                        <div
                            className="h-2 bg-background border-b hover:bg-primary/10 cursor-row-resize flex items-center justify-center z-10 -mt-1"
                            onMouseDown={handleMouseDown}
                        >
                            <div className="w-8 h-1 bg-muted-foreground/20 rounded-full" />
                        </div>
                    )}
                </>
            )}

            {/* Task List (Bottom) - hidden in fullscreen */}
            <div className={cn("flex-1 min-h-0 bg-background flex flex-col", (isFullscreen || !isTaskListVisible) && "hidden")}>
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
                                                                        {format(new Date(group.scheduled_at), 'M/d HH:mm')}
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
