"use client"

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import ReactFlow, {
    Node,
    Edge,
    Handle,
    Position,
    NodeProps,
    ReactFlowProvider,
    useReactFlow,
    SelectionMode,
} from 'reactflow'
import 'reactflow/dist/style.css'
import dagre from 'dagre'
import { Task, Project } from "@/types/database"
import { cn } from "@/lib/utils"
import { Calendar as CalendarIcon, ChevronRight, ChevronDown, Target, Clock, MoreHorizontal, CornerDownRight, Trash2, ChevronDown as ChevronDownKb } from "lucide-react"
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight"
import { PriorityBadge, PriorityPopover, Priority, getPriorityIconColor } from "@/components/ui/priority-select"
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select"
import { DateTimePicker } from "@/lib/dynamic-imports"

// --- Dagre Layout ---
const NODE_WIDTH = 240
const NODE_HEIGHT = 48
const PROJECT_NODE_WIDTH = 260
const PROJECT_NODE_HEIGHT = 56

const estimateTaskNodeHeight = (title: string, hasInfoRow: boolean) => {
    const len = title?.length || 0
    const charsPerLine = 18
    const lines = Math.max(1, Math.ceil(len / charsPerLine))
    const textHeight = Math.max(38, 16 + lines * 18)
    const infoRowHeight = hasInfoRow ? 24 : 0
    return textHeight + infoRowHeight
}

function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))
    dagreGraph.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 140, align: undefined })

    nodes.forEach((node) => {
        let width = NODE_WIDTH
        let height = NODE_HEIGHT
        if (node.type === 'mobileProjectNode') {
            width = PROJECT_NODE_WIDTH
            height = PROJECT_NODE_HEIGHT
        } else if (node.type === 'mobileTaskNode' && node.height) {
            height = node.height
        }
        dagreGraph.setNode(node.id, { width, height })
    })

    edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target))
    dagre.layout(dagreGraph)

    const layoutedNodes = nodes.map((node) => {
        const pos = dagreGraph.node(node.id)
        let width = NODE_WIDTH
        if (node.type === 'mobileProjectNode') width = PROJECT_NODE_WIDTH
        let height = NODE_HEIGHT
        if (node.type === 'mobileProjectNode') height = PROJECT_NODE_HEIGHT
        else if (node.type === 'mobileTaskNode' && node.height) height = node.height

        return {
            ...node,
            position: { x: pos.x - width / 2, y: pos.y - height / 2 },
        }
    })

    return { nodes: layoutedNodes, edges }
}

// --- Habit Settings Panel ---
const HABIT_DAYS = [
    { key: 'mon', label: '月' }, { key: 'tue', label: '火' }, { key: 'wed', label: '水' },
    { key: 'thu', label: '木' }, { key: 'fri', label: '金' }, { key: 'sat', label: '土' }, { key: 'sun', label: '日' },
] as const

function HabitSettingsPanel({ data }: { data: any }) {
    const [isHabit, setIsHabit] = useState<boolean>(data?.is_habit ?? false)
    const [frequency, setFrequency] = useState<string>(data?.habit_frequency ?? '')
    const [startDate, setStartDate] = useState<string>(data?.habit_start_date ?? '')
    const [endDate, setEndDate] = useState<string>(data?.habit_end_date ?? '')
    const onUpdateHabitRef = useRef(data?.onUpdateHabit)
    onUpdateHabitRef.current = data?.onUpdateHabit

    const saveNow = useCallback((updates: { isHabit: boolean; frequency: string; startDate: string; endDate: string }) => {
        onUpdateHabitRef.current?.({
            is_habit: updates.isHabit,
            habit_frequency: updates.frequency || null,
            habit_icon: null,
            habit_start_date: updates.startDate || null,
            habit_end_date: updates.endDate || null,
        })
    }, [])

    const handleToggle = useCallback(() => {
        setIsHabit(prev => {
            const next = !prev
            saveNow({ isHabit: next, frequency, startDate, endDate })
            return next
        })
    }, [saveNow, frequency, startDate, endDate])

    const selectedDays = new Set(frequency.split(',').filter(Boolean))
    const toggleDay = (key: string) => {
        const next = new Set(selectedDays)
        if (next.has(key)) next.delete(key); else next.add(key)
        const newFreq = HABIT_DAYS.map(d => d.key).filter(k => next.has(k)).join(',')
        setFrequency(newFreq)
        saveNow({ isHabit, frequency: newFreq, startDate, endDate })
    }

    const handlePreset = (val: string) => {
        setFrequency(val)
        saveNow({ isHabit, frequency: val, startDate, endDate })
    }

    return (
        <>
            <div className="px-3 py-2 text-xs font-medium text-muted-foreground">習慣</div>
            <div className="nodrag nopan px-3 pb-3 space-y-3">
                <button type="button" className="flex items-center justify-between w-full"
                    onClick={(e) => { e.stopPropagation(); handleToggle() }}
                    onPointerDown={(e) => e.stopPropagation()}>
                    <span className="text-sm">習慣として設定</span>
                    <div className={cn("inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors", isHabit ? "bg-primary" : "bg-input")}>
                        <span className={cn("pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform", isHabit ? "translate-x-5" : "translate-x-0")} />
                    </div>
                </button>
                {isHabit && (
                    <>
                        <div className="text-xs text-muted-foreground">曜日</div>
                        <div className="flex gap-1">
                            {HABIT_DAYS.map(({ key, label }) => (
                                <button key={key} type="button"
                                    className={cn("flex-1 h-8 text-xs rounded font-medium transition-colors",
                                        selectedDays.has(key) ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground")}
                                    onClick={(e) => { e.stopPropagation(); toggleDay(key) }}>
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex gap-1.5">
                            {[{ label: '毎日', val: 'mon,tue,wed,thu,fri,sat,sun' }, { label: '平日', val: 'mon,tue,wed,thu,fri' }, { label: '土日', val: 'sat,sun' }].map(p => (
                                <button key={p.val} type="button"
                                    className={cn("flex-1 h-7 text-xs rounded transition-colors", frequency === p.val ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/50")}
                                    onClick={(e) => { e.stopPropagation(); handlePreset(p.val) }}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                        <div className="text-xs text-muted-foreground">期間</div>
                        <div className="flex items-center gap-1.5">
                            <input type="date" className="flex-1 h-8 px-2 text-xs border rounded bg-background min-w-0"
                                value={startDate} onChange={(e) => { e.stopPropagation(); setStartDate(e.target.value); saveNow({ isHabit, frequency, startDate: e.target.value, endDate }) }}
                                onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />
                            <span className="text-xs text-muted-foreground shrink-0">〜</span>
                            <input type="date" className="flex-1 h-8 px-2 text-xs border rounded bg-background min-w-0"
                                value={endDate} onChange={(e) => { e.stopPropagation(); setEndDate(e.target.value); saveNow({ isHabit, frequency, startDate, endDate: e.target.value }) }}
                                onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />
                        </div>
                    </>
                )}
            </div>
        </>
    )
}

// --- Mobile Project Node ---
const MobileProjectNode = React.memo(({ data, selected }: NodeProps) => {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(data?.label ?? '')
    const inputRef = useRef<HTMLInputElement>(null)
    const wasSelectedRef = useRef(false)

    useEffect(() => { setEditValue(data?.label ?? '') }, [data?.label])

    // Single tap → edit mode (detect selected transition)
    useEffect(() => {
        if (selected && !wasSelectedRef.current) {
            setIsEditing(true)
        }
        if (!selected && wasSelectedRef.current) {
            // Deselected → save & exit edit mode
            if (inputRef.current) {
                const val = inputRef.current.value
                if (val !== data?.label) data?.onSave?.(val)
            }
            setIsEditing(false)
        }
        wasSelectedRef.current = !!selected
    }, [selected, data?.label, data?.onSave])

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const handleSave = useCallback(async () => {
        if (editValue !== data?.label) {
            await data?.onSave?.(editValue)
        }
        // Don't exit edit mode - keyboard stays open
    }, [editValue, data])

    return (
        <div
            className={cn(
                "w-[260px] h-[56px] rounded-xl bg-primary text-primary-foreground px-4 flex items-center shadow-md transition-all",
                selected && "ring-2 ring-white ring-offset-2"
            )}
        >
            <Handle type="source" position={Position.Right} className="!bg-primary-foreground !w-2 !h-2" />
            {isEditing ? (
                <input
                    ref={inputRef}
                    className="w-full bg-transparent border-none text-base font-semibold focus:outline-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => { if (editValue !== data?.label) data?.onSave?.(editValue) }}
                    enterKeyHint="return"
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') { e.preventDefault(); handleSave() }
                        if (e.key === 'Escape') { setEditValue(data?.label ?? ''); setIsEditing(false) }
                    }}
                />
            ) : (
                <div className="text-base font-semibold truncate">{data?.label ?? 'Project'}</div>
            )}
        </div>
    )
})
MobileProjectNode.displayName = 'MobileProjectNode'

// --- Mobile Task Node ---
const MobileTaskNode = React.memo(({ data, selected }: NodeProps) => {
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(data?.label ?? '')
    const [showMenu, setShowMenu] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const wasSelectedRef = useRef(false)
    const justSavedRef = useRef(false)

    useEffect(() => { setEditValue(data?.label ?? '') }, [data?.label])

    // Single tap → edit mode (detect selected transition)
    useEffect(() => {
        if (selected && !wasSelectedRef.current) {
            setIsEditing(true)
            justSavedRef.current = false
        }
        if (!selected && wasSelectedRef.current) {
            // Deselected → save & exit edit mode
            if (inputRef.current) {
                const val = inputRef.current.value
                if (val !== data?.label) data?.onSave?.(val)
            }
            setIsEditing(false)
            justSavedRef.current = false
        }
        wasSelectedRef.current = !!selected
    }, [selected, data?.label, data?.onSave])

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isEditing])

    const isHabit = data?.is_habit || data?.parentIsHabit
    const isDone = data?.status === 'done'
    const hasEstimatedTime = (data?.estimatedDisplayMinutes ?? 0) > 0
    const hasPriority = data?.priority != null
    const hasScheduledAt = !!data?.scheduled_at
    const hasInfoRow = hasEstimatedTime || hasPriority || hasScheduledAt

    return (
        <div
            className={cn(
                "relative w-[240px] px-3 py-2 rounded-lg bg-background border text-sm shadow-sm flex flex-col gap-1 transition-all min-h-[44px]",
                isHabit && "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
                selected && isHabit && "ring-2 ring-blue-400 ring-offset-2 ring-offset-background",
                selected && !isHabit && "ring-2 ring-primary ring-offset-2 ring-offset-background",
            )}
        >
            <Handle type="target" position={Position.Left} className="!bg-muted-foreground/50 !w-2 !h-2" />

            {/* Row 1: Content */}
            <div className="flex items-center gap-1.5 w-full">
                {/* Collapse button */}
                {data?.hasChildren && (
                    <button
                        className="nodrag nopan w-5 h-5 flex items-center justify-center text-muted-foreground shrink-0"
                        onClick={(e) => { e.stopPropagation(); data.onToggleCollapse?.() }}
                    >
                        {data?.collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                )}

                {/* Status dot */}
                <div className={cn("w-2 h-2 rounded-full shrink-0", isDone ? "bg-primary" : "bg-muted-foreground/30")} />

                {/* Habit icon */}
                {data?.is_habit && data?.habit_icon && (
                    <span className="text-sm shrink-0">{data.habit_icon}</span>
                )}

                {/* Title */}
                {isEditing ? (
                    <input
                        ref={inputRef}
                        className="nodrag nopan flex-1 bg-transparent border-none text-sm focus:outline-none min-w-0"
                        value={editValue}
                        onChange={(e) => { setEditValue(e.target.value); justSavedRef.current = false }}
                        onBlur={() => { if (editValue !== data?.label) data?.onSave?.(editValue) }}
                        enterKeyHint="return"
                        onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                if (!justSavedRef.current) {
                                    // First Enter: save text, keep keyboard open
                                    if (editValue !== data?.label) data?.onSave?.(editValue)
                                    justSavedRef.current = true
                                } else {
                                    // Second Enter: create sibling task
                                    justSavedRef.current = false
                                    data?.onAddSibling?.()
                                }
                            }
                            if (e.key === 'Tab') {
                                e.preventDefault()
                                // Tab: create child task
                                if (editValue !== data?.label) data?.onSave?.(editValue)
                                data?.onAddChildAndFocus?.()
                            }
                            if (e.key === 'Escape') { setEditValue(data?.label ?? ''); setIsEditing(false) }
                        }}
                    />
                ) : (
                    <span className={cn("flex-1 text-sm truncate", isDone && "line-through text-muted-foreground")}>
                        {data?.label || ''}
                    </span>
                )}

                {/* Calendar sync indicator */}
                {data?.google_event_id && (
                    <CalendarIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                )}

                {/* Menu button */}
                <Popover open={showMenu} onOpenChange={setShowMenu}>
                    <PopoverTrigger asChild>
                        <button
                            className="nodrag nopan w-7 h-7 flex items-center justify-center text-muted-foreground active:bg-muted rounded shrink-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="w-4 h-4" />
                        </button>
                    </PopoverTrigger>
                    <PopoverContent
                        align="end"
                        side="bottom"
                        className="nodrag nopan w-64 p-1 max-h-[60vh] overflow-y-auto"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                        onPointerDownOutside={(e) => e.preventDefault()}
                        onFocusOutside={(e) => e.preventDefault()}
                        onInteractOutside={(e) => e.preventDefault()}
                    >
                        {/* Priority */}
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">優先度</div>
                        <div className="px-3 pb-2">
                            <PriorityPopover
                                value={(data?.priority ?? 3) as Priority}
                                onChange={(priority) => data?.onUpdatePriority?.(priority)}
                                trigger={
                                    <Button variant="outline" size="sm" className="w-full justify-start text-sm h-9">
                                        <Target className="w-4 h-4 mr-2" style={{ color: getPriorityIconColor((data?.priority ?? 3) as Priority) }} />
                                        {data?.priority != null ? <PriorityBadge value={data.priority as Priority} /> : <span className="text-muted-foreground">優先度を設定</span>}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Estimated Time */}
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">所要時間</div>
                        <div className="px-3 pb-2">
                            <EstimatedTimePopover
                                valueMinutes={data?.estimatedDisplayMinutes ?? 0}
                                onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                isOverridden={!!data?.estimatedIsOverride}
                                autoMinutes={data?.estimatedAutoMinutes}
                                onResetAuto={data?.hasChildren ? () => data?.onUpdateEstimatedTime?.(0) : undefined}
                                trigger={
                                    <Button variant="outline" size="sm" className="w-full justify-start text-sm h-9">
                                        <Clock className="w-4 h-4 mr-2" />
                                        {(data?.estimatedDisplayMinutes ?? 0) > 0 ? <EstimatedTimeBadge minutes={data.estimatedDisplayMinutes} /> : <span className="text-muted-foreground">所要時間を設定</span>}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Schedule */}
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">スケジュール</div>
                        <div className="px-3 pb-2">
                            <DateTimePicker
                                date={data?.scheduled_at ? new Date(data.scheduled_at) : undefined}
                                setDate={(date) => data?.onUpdateScheduledAt?.(date ? date.toISOString() : null)}
                                trigger={
                                    <Button variant="outline" size="sm" className="w-full justify-start text-sm h-9">
                                        <CalendarIcon className="w-4 h-4 mr-2" />
                                        {data?.scheduled_at ? (
                                            <span>{new Date(data.scheduled_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                        ) : <span className="text-muted-foreground">日時を設定</span>}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Calendar */}
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">カレンダー</div>
                        <div className="px-3 pb-2">
                            <TaskCalendarSelect
                                value={data?.calendar_id || null}
                                onChange={(calendarId) => data?.onUpdateCalendar?.(calendarId)}
                                className="w-full h-9 justify-start"
                            />
                        </div>

                        {/* Habit */}
                        <HabitSettingsPanel data={data} />

                        <div className="px-3 pb-2 pt-1">
                            <Button size="sm" variant="destructive" className="w-full h-8 text-xs" onClick={(e) => { e.stopPropagation(); data?.onDelete?.(); setShowMenu(false) }}>
                                削除
                            </Button>
                        </div>

                        <div className="px-3 pb-2">
                            <Button size="sm" className="w-full h-8 text-xs" onClick={(e) => { e.stopPropagation(); setShowMenu(false) }}>
                                閉じる
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Row 2: Info */}
            {hasInfoRow && (
                <div className="flex items-center gap-2 pl-5 flex-wrap">
                    {hasEstimatedTime && <EstimatedTimeBadge minutes={data.estimatedDisplayMinutes} />}
                    {hasPriority && <PriorityBadge value={data.priority as Priority} />}
                    {hasScheduledAt && (
                        <span className="text-[11px] text-muted-foreground ml-auto">
                            {new Date(data.scheduled_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                </div>
            )}

            <Handle type="source" position={Position.Right} className="!bg-muted-foreground/50 !w-2 !h-2" />
        </div>
    )
})
MobileTaskNode.displayName = 'MobileTaskNode'

// --- Node Types ---
const mobileNodeTypes = { mobileProjectNode: MobileProjectNode, mobileTaskNode: MobileTaskNode }
const defaultViewport = { x: 0, y: 0, zoom: 0.6 }

// --- Effective minutes calculation ---
function getTaskEffectiveMinutes(taskId: string, childrenMap: Map<string, Task[]>, taskMap: Map<string, Task>): number {
    const self = taskMap.get(taskId)
    if (!self) return 0
    const children = childrenMap.get(taskId) ?? []
    if (children.length === 0) return self.estimated_time ?? 0
    if ((self.estimated_time ?? 0) > 0) return self.estimated_time
    return children.reduce((acc, child) => acc + getTaskEffectiveMinutes(child.id, childrenMap, taskMap), 0)
}

function getTaskAutoMinutes(taskId: string, childrenMap: Map<string, Task[]>, taskMap: Map<string, Task>): number {
    const children = childrenMap.get(taskId) ?? []
    if (children.length === 0) return taskMap.get(taskId)?.estimated_time ?? 0
    return children.reduce((acc, child) => acc + getTaskEffectiveMinutes(child.id, childrenMap, taskMap), 0)
}

// --- Main Component ---
interface MobileMindMapProps {
    project: Project
    groups: Task[]
    tasks: Task[]
    onCreateGroup?: (title: string) => Promise<Task | null>
    onDeleteGroup?: (groupId: string) => Promise<void>
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask?: (taskId: string) => Promise<void>
    onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
}

// --- Utility: find root group ID ---
function findRootGroupIdUtil(taskId: string, taskMap: Map<string, Task>): string {
    const t = taskMap.get(taskId)
    if (!t) return taskId
    if (!t.parent_task_id) return t.id
    return findRootGroupIdUtil(t.parent_task_id, taskMap)
}

function MobileMindMapContent({
    project, groups, tasks,
    onCreateGroup, onDeleteGroup, onUpdateProject,
    onCreateTask, onUpdateTask, onDeleteTask, onReorderTask,
}: MobileMindMapProps) {
    const reactFlow = useReactFlow()
    const [collapsedTaskIds, setCollapsedTaskIds] = useState<Set<string>>(new Set())
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
    const { keyboardHeight, isKeyboardOpen } = useKeyboardHeight()

    // Build task maps
    const { taskMap, childrenMap } = useMemo(() => {
        const all = [...groups, ...tasks]
        const tMap = new Map<string, Task>()
        const cMap = new Map<string, Task[]>()
        for (const t of all) {
            tMap.set(t.id, t)
            if (t.parent_task_id) {
                const arr = cMap.get(t.parent_task_id) ?? []
                arr.push(t)
                cMap.set(t.parent_task_id, arr)
            }
        }
        for (const [, arr] of cMap) arr.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        return { taskMap: tMap, childrenMap: cMap }
    }, [groups, tasks])

    // Build ReactFlow nodes and edges
    const { layoutNodes, edges } = useMemo(() => {
        const nodes: Node[] = []
        const edgeList: Edge[] = []
        const projectId = project?.id ?? 'project-root'

        // Project root node
        nodes.push({
            id: projectId,
            type: 'mobileProjectNode',
            position: { x: 0, y: 0 },
            data: {
                label: project?.title ?? 'Project',
                onSave: async (newTitle: string) => onUpdateProject?.(projectId, newTitle),
                onAddChild: async () => onCreateGroup?.('新しいグループ'),
            },
        })

        // DFS to add task nodes
        const addTaskNodes = (task: Task, parentNodeId: string) => {
            const children = childrenMap.get(task.id) ?? []
            const hasChildren = children.length > 0
            const isCollapsed = collapsedTaskIds.has(task.id)
            const effectiveMinutes = getTaskEffectiveMinutes(task.id, childrenMap, taskMap)
            const autoMinutes = hasChildren ? getTaskAutoMinutes(task.id, childrenMap, taskMap) : 0
            const isOverride = hasChildren && (task.estimated_time ?? 0) > 0

            // Check if parent is habit
            const parent = task.parent_task_id ? taskMap.get(task.parent_task_id) : null
            const parentIsHabit = parent?.is_habit ?? false

            const hasInfoRow = (effectiveMinutes > 0) || (task.priority != null) || !!task.scheduled_at
            const height = estimateTaskNodeHeight(task.title, hasInfoRow)

            nodes.push({
                id: task.id,
                type: 'mobileTaskNode',
                position: { x: 0, y: 0 },
                height,
                data: {
                    label: task.title,
                    taskId: task.id,
                    status: task.status,
                    priority: task.priority,
                    estimatedDisplayMinutes: effectiveMinutes,
                    estimatedAutoMinutes: autoMinutes,
                    estimatedIsOverride: isOverride,
                    scheduled_at: task.scheduled_at,
                    calendar_id: task.calendar_id,
                    google_event_id: task.google_event_id,
                    is_habit: task.is_habit,
                    parentIsHabit,
                    habit_frequency: task.habit_frequency,
                    habit_icon: task.habit_icon,
                    habit_start_date: task.habit_start_date,
                    habit_end_date: task.habit_end_date,
                    hasChildren,
                    collapsed: isCollapsed,
                    isSelected: selectedNodeId === task.id,
                    onSave: async (title: string) => onUpdateTask?.(task.id, { title }),
                    onToggleCollapse: () => {
                        setCollapsedTaskIds(prev => {
                            const next = new Set(prev)
                            if (next.has(task.id)) next.delete(task.id); else next.add(task.id)
                            return next
                        })
                    },
                    onDelete: async () => {
                        if (!task.parent_task_id) await onDeleteGroup?.(task.id)
                        else await onDeleteTask?.(task.id)
                    },
                    onAddChild: async () => {
                        const rootGroupId = findRootGroupIdUtil(task.id, taskMap)
                        await onCreateTask?.(rootGroupId, '', task.id)
                        setCollapsedTaskIds(prev => { const n = new Set(prev); n.delete(task.id); return n })
                    },
                    // Enter2回目: 兄弟ノード作成（キーボード維持）
                    onAddSibling: async () => {
                        const rootGroupId = findRootGroupIdUtil(task.id, taskMap)
                        const newTask = await onCreateTask?.(rootGroupId, '', task.parent_task_id || undefined)
                        if (newTask) setSelectedNodeId(newTask.id)
                    },
                    // Tab/子ノードボタン: 子ノード作成してフォーカス
                    onAddChildAndFocus: async () => {
                        const rootGroupId = findRootGroupIdUtil(task.id, taskMap)
                        const newTask = await onCreateTask?.(rootGroupId, '', task.id)
                        if (newTask) {
                            setCollapsedTaskIds(prev => { const n = new Set(prev); n.delete(task.id); return n })
                            setSelectedNodeId(newTask.id)
                        }
                    },
                    onUpdatePriority: (priority: number) => onUpdateTask?.(task.id, { priority }),
                    onUpdateEstimatedTime: (minutes: number) => onUpdateTask?.(task.id, { estimated_time: minutes }),
                    onUpdateScheduledAt: (isoString: string | null) => onUpdateTask?.(task.id, { scheduled_at: isoString }),
                    onUpdateCalendar: (calendarId: string | null) => onUpdateTask?.(task.id, { calendar_id: calendarId }),
                    onUpdateHabit: (updates: any) => onUpdateTask?.(task.id, {
                        is_habit: updates.is_habit,
                        habit_frequency: updates.habit_frequency,
                        habit_icon: updates.habit_icon,
                        habit_start_date: updates.habit_start_date,
                        habit_end_date: updates.habit_end_date,
                    }),
                },
            })

            edgeList.push({
                id: `e-${parentNodeId}-${task.id}`,
                source: parentNodeId,
                target: task.id,
                type: 'smoothstep',
            })

            if (!isCollapsed) {
                for (const child of children) {
                    addTaskNodes(child, task.id)
                }
            }
        }

        const sortedGroups = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        for (const group of sortedGroups) {
            addTaskNodes(group, projectId)
        }

        const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(nodes, edgeList)
        return { layoutNodes: layouted, edges: layoutedEdges }
    }, [project, groups, tasks, childrenMap, taskMap, collapsedTaskIds, selectedNodeId, onUpdateProject, onCreateGroup, onUpdateTask, onDeleteTask, onDeleteGroup, onCreateTask])

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        setSelectedNodeId(node.id)
    }, [])

    const handlePaneClick = useCallback(() => {
        setSelectedNodeId(null)
        // 背景タップ → キーボード収納
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }
    }, [])

    // Keyboard accessory bar callbacks for the selected node
    const selectedTask = selectedNodeId ? taskMap.get(selectedNodeId) : null
    const handleAccessoryAddChild = useCallback(() => {
        if (!selectedNodeId) return
        const task = taskMap.get(selectedNodeId)
        if (!task) return
        const rootGroupId = findRootGroupIdUtil(selectedNodeId, taskMap)
        onCreateTask?.(rootGroupId, '', selectedNodeId).then(newTask => {
            if (newTask) {
                setCollapsedTaskIds(prev => { const n = new Set(prev); n.delete(selectedNodeId); return n })
                setSelectedNodeId(newTask.id)
            }
        })
    }, [selectedNodeId, taskMap, onCreateTask])

    const handleAccessoryDelete = useCallback(() => {
        if (!selectedNodeId) return
        const task = taskMap.get(selectedNodeId)
        if (!task) return
        if (!task.parent_task_id) onDeleteGroup?.(selectedNodeId)
        else onDeleteTask?.(selectedNodeId)
        setSelectedNodeId(null)
    }, [selectedNodeId, taskMap, onDeleteGroup, onDeleteTask])

    const handleAccessoryDismiss = useCallback(() => {
        setSelectedNodeId(null)
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }
    }, [])

    return (
        <div className="w-full h-full" style={{ touchAction: 'none' }}>
            <ReactFlow
                nodes={layoutNodes}
                edges={edges}
                nodeTypes={mobileNodeTypes}
                defaultViewport={defaultViewport}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 1.0 }}
                deleteKeyCode={null}
                nodesConnectable={false}
                nodesDraggable={true}
                selectionOnDrag={false}
                panOnDrag={true}
                panOnScroll={false}
                zoomOnScroll={false}
                zoomOnPinch={true}
                zoomOnDoubleClick={false}
                preventScrolling={true}
                minZoom={0.2}
                maxZoom={2.0}
                selectNodesOnDrag={false}
                onlyRenderVisibleElements={true}
            >
                {/* No controls or background on mobile to save space */}
            </ReactFlow>

            {/* Keyboard Accessory Bar - マインドマップ編集用 */}
            {selectedNodeId && isKeyboardOpen && (
                <div
                    className="fixed left-0 right-0 z-[60] bg-background/95 backdrop-blur-sm border-t border-border md:hidden"
                    style={{ bottom: `${keyboardHeight}px` }}
                    onMouseDown={(e) => e.preventDefault()}
                    onTouchStart={(e) => e.preventDefault()}
                >
                    <div className="flex items-center justify-between px-2 py-1.5 safe-area-inset-bottom">
                        <div className="flex items-center gap-0.5">
                            {/* 子ノード作成（Tab相当） */}
                            <button
                                onClick={handleAccessoryAddChild}
                                className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-foreground active:bg-muted transition-colors"
                                title="子ノード追加"
                            >
                                <CornerDownRight className="w-5 h-5" />
                                <span className="text-xs">子追加</span>
                            </button>

                            {/* セパレータ */}
                            <div className="w-px h-5 bg-border mx-1" />

                            {/* 削除 */}
                            <button
                                onClick={handleAccessoryDelete}
                                className="flex items-center justify-center w-10 h-9 rounded-md text-destructive active:bg-destructive/10 transition-colors"
                                title="削除"
                            >
                                <Trash2 className="w-4.5 h-4.5" />
                            </button>
                        </div>

                        {/* キーボード閉じる */}
                        <button
                            onClick={handleAccessoryDismiss}
                            className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-muted-foreground active:bg-muted transition-colors"
                        >
                            <span className="text-xs">閉じる</span>
                            <ChevronDownKb className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// --- Exported Component ---
export function MobileMindMap(props: MobileMindMapProps) {
    return (
        <ReactFlowProvider>
            <MobileMindMapContent {...props} />
        </ReactFlowProvider>
    )
}
