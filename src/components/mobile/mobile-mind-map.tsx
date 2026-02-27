"use client"

import React, { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
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
import { Calendar as CalendarIcon, ChevronRight, ChevronDown, Target, Clock, MoreHorizontal, CornerDownRight, Trash2, ChevronDown as ChevronDownKb, Plus, StickyNote, X, ImagePlus, Copy, Link2, Sparkles, Download } from "lucide-react"
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight"
import { PriorityBadge, PriorityPopover, Priority, getPriorityIconColor } from "@/components/ui/priority-select"
import { EstimatedTimeBadge, EstimatedTimePopover, formatEstimatedTime } from "@/components/ui/estimated-time-select"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { TaskCalendarSelect } from "@/components/tasks/task-calendar-select"
import { DateTimePicker } from "@/lib/dynamic-imports"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { BranchEdge } from "@/components/mindmap/branch-edge"
import { createPortal } from "react-dom"

// --- Dagre Layout ---
const NODE_WIDTH = 200
const NESTED_NODE_WIDTH = 160
const NODE_HEIGHT = 40
const PROJECT_NODE_WIDTH = 220
const PROJECT_NODE_HEIGHT = 48
const fileToDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.onerror = () => reject(new Error('Failed to read image file'))
        reader.readAsDataURL(file)
    })

/** テキストの視覚的な幅をピクセル単位で推定（全角=13px, 半角=7px） */
const estimateTextWidthPx = (text: string): number => {
    let width = 0
    for (const ch of text) {
        const code = ch.codePointAt(0) ?? 0
        const isWide =
            (code >= 0x3000 && code <= 0x9FFF) ||
            (code >= 0xF900 && code <= 0xFAFF) ||
            (code >= 0xFF01 && code <= 0xFF60) ||
            (code >= 0xFFE0 && code <= 0xFFE6) ||
            (code >= 0x20000 && code <= 0x2FA1F)
        width += isWide ? 13 : 7
    }
    return width
}

const estimateTaskNodeHeight = (title: string, hasInfoRow: boolean, nodeWidth: number = NODE_WIDTH) => {
    const availableWidthPx = Math.max(48, nodeWidth - 48) // パディング・アイコン分を引く
    const text = (title || '').trim()
    const lines = Math.max(
        1,
        text.split('\n').reduce((acc, line) => {
            const linePx = estimateTextWidthPx(line)
            return acc + Math.max(1, Math.ceil(linePx / availableWidthPx))
        }, 0)
    )
    const textHeight = lines * 16 + 8 // 16px/行 + パディング
    const infoRowHeight = hasInfoRow ? 16 : 0
    return Math.max(NODE_HEIGHT, textHeight + infoRowHeight)
}

function getLayoutedElements(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
    const dagreGraph = new dagre.graphlib.Graph()
    dagreGraph.setDefaultEdgeLabel(() => ({}))

    // ノード最大高さに基づいてnodesepを動的計算
    let maxH = NODE_HEIGHT
    nodes.forEach(n => {
        const h = n.type === 'mobileProjectNode' ? PROJECT_NODE_HEIGHT : (n.height ?? NODE_HEIGHT)
        if (h > maxH) maxH = h
    })
    const dynamicNodesep = Math.max(16, Math.round(maxH / 2) + 12)

    dagreGraph.setGraph({ rankdir: 'LR', nodesep: dynamicNodesep, ranksep: 96, align: undefined })

    nodes.forEach((node) => {
        let width = NODE_WIDTH
        let height = NODE_HEIGHT
        if (node.type === 'mobileProjectNode') {
            width = PROJECT_NODE_WIDTH
            height = PROJECT_NODE_HEIGHT
        } else if (node.type === 'mobileTaskNode' && node.height) {
            width = node.width ?? NODE_WIDTH
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
        else if (node.type === 'mobileTaskNode') width = node.width ?? NODE_WIDTH
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
    const isNodeSelected = data?.isSelected ?? false
    useEffect(() => {
        if (isNodeSelected && !wasSelectedRef.current) {
            setIsEditing(true)
        }
        if (!isNodeSelected && wasSelectedRef.current) {
            // Deselected → save & exit edit mode
            if (inputRef.current) {
                const val = inputRef.current.value
                if (val !== data?.label) data?.onSave?.(val)
            }
            setIsEditing(false)
        }
        wasSelectedRef.current = isNodeSelected
    }, [isNodeSelected, data?.label, data?.onSave])

    useLayoutEffect(() => {
        if (isEditing && inputRef.current) {
            const input = inputRef.current
            input.focus()
            input.select()
            const timer = setTimeout(() => {
                if (document.activeElement !== input) {
                    input.focus()
                    input.select()
                }
            }, 80)
            return () => clearTimeout(timer)
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
                "w-[220px] h-[48px] rounded-xl bg-primary text-primary-foreground px-3 flex items-center shadow-md transition-all",
                isNodeSelected && "ring-2 ring-white ring-offset-2"
            )}
        >
            <Handle type="source" position={Position.Right} className="!bg-primary-foreground !w-2 !h-2" />
            {isEditing ? (
                <input
                    ref={inputRef}
                    className="w-full bg-transparent border-none text-sm font-semibold focus:outline-none"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => { if (editValue !== data?.label) data?.onSave?.(editValue) }}
                    enterKeyHint="enter"
                    onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') { e.preventDefault(); handleSave() }
                        if (e.key === 'Escape') { setEditValue(data?.label ?? ''); setIsEditing(false) }
                    }}
                />
            ) : (
                <div className="text-sm font-semibold truncate">{data?.label ?? 'Project'}</div>
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
    const [imageUrlInput, setImageUrlInput] = useState('')
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const wasSelectedRef = useRef(false)
    const justSavedRef = useRef(false)

    useEffect(() => { setEditValue(data?.label ?? '') }, [data?.label])

    // Single tap → edit mode (detect isSelected transition)
    const isNodeSelected = data?.isSelected ?? false
    useEffect(() => {
        if (isNodeSelected && !wasSelectedRef.current) {
            setIsEditing(true)
            justSavedRef.current = false
        }
        if (!isNodeSelected && wasSelectedRef.current) {
            // Deselected → save & exit edit mode
            if (inputRef.current) {
                const val = inputRef.current.value
                if (val !== data?.label) data?.onSave?.(val)
            }
            setIsEditing(false)
            justSavedRef.current = false
        }
        wasSelectedRef.current = isNodeSelected
    }, [isNodeSelected, data?.label, data?.onSave])

    useLayoutEffect(() => {
        if (isEditing && inputRef.current) {
            const input = inputRef.current
            input.focus()
            input.select()
            const timer = setTimeout(() => {
                if (document.activeElement !== input) {
                    input.focus()
                    input.select()
                }
            }, 80)
            return () => clearTimeout(timer)
        }
    }, [isEditing])

    const isHabit = data?.is_habit || data?.parentIsHabit
    // 習慣タスクは期間完了（end_date 過ぎ + status='done'）のみ完了表示
    const isDone = data?.is_habit
        ? (data?.status === 'done' && !!data?.habit_end_date && new Date(data.habit_end_date) < new Date())
        : data?.status === 'done'
    const hasEstimatedTime = (data?.estimatedDisplayMinutes ?? 0) > 0
    const hasPriority = data?.priority != null
    const hasScheduledAt = !!data?.scheduled_at
    const hasMemo = !!data?.memo
    const memoImages: string[] = Array.isArray(data?.memo_images)
        ? (data.memo_images as string[]).filter((url: string) => typeof url === 'string' && !!url.trim())
        : []
    const hasMemoImages = memoImages.length > 0
    const hasInfoRow = hasEstimatedTime || hasPriority || hasScheduledAt || hasMemo || hasMemoImages

    const writeClipboard = useCallback(async (text: string, successMessage: string) => {
        try {
            await navigator.clipboard.writeText(text)
            setCopyFeedback(successMessage)
            setTimeout(() => setCopyFeedback(null), 1400)
        } catch (error) {
            console.error('[MobileTaskNode] Failed to write clipboard:', error)
            setCopyFeedback('コピーに失敗しました')
            setTimeout(() => setCopyFeedback(null), 1600)
        }
    }, [])

    const handleAddImageUrl = useCallback(() => {
        const nextUrl = imageUrlInput.trim()
        if (!nextUrl) return
        if (memoImages.includes(nextUrl)) {
            setImageUrlInput('')
            return
        }
        data?.onUpdateMemoImages?.([...memoImages, nextUrl])
        setImageUrlInput('')
    }, [imageUrlInput, memoImages, data])

    const handleImageFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? [])
        if (files.length === 0) return
        try {
            const encoded = await Promise.all(
                files
                    .filter(file => file.type.startsWith('image/'))
                    .map(fileToDataUrl)
            )
            const merged = [...memoImages, ...encoded.filter(Boolean)]
            data?.onUpdateMemoImages?.(merged.length > 0 ? merged : null)
        } catch (error) {
            console.error('[MobileTaskNode] Failed to encode image files:', error)
        } finally {
            event.target.value = ''
        }
    }, [memoImages, data])

    const handleRemoveImage = useCallback((targetUrl: string) => {
        const filtered = memoImages.filter(url => url !== targetUrl)
        data?.onUpdateMemoImages?.(filtered.length > 0 ? filtered : null)
    }, [memoImages, data])

    const buildAiMemoPayload = useCallback(() => {
        const memoText = typeof data?.memo === 'string' ? data.memo.trim() : ''
        const sections: string[] = []
        if (memoText) sections.push(`メモ:\n${memoText}`)
        if (memoImages.length > 0) {
            sections.push(`画像:\n${memoImages.map((url, idx) => `![image-${idx + 1}](${url})`).join('\n')}`)
        }
        return sections.join('\n\n').trim()
    }, [data?.memo, memoImages])

    const handleSaveImage = useCallback(async (url: string, index: number) => {
        const filename = `mindmap-memo-image-${index + 1}.png`
        try {
            if (url.startsWith('data:image/')) {
                const link = document.createElement('a')
                link.href = url
                link.download = filename
                document.body.appendChild(link)
                link.click()
                link.remove()
                setCopyFeedback('画像の保存を開始しました')
                setTimeout(() => setCopyFeedback(null), 1600)
                return
            }

            const response = await fetch(url, { mode: 'cors' })
            if (!response.ok) throw new Error('Failed to fetch image')
            const blob = await response.blob()
            const objectUrl = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.href = objectUrl
            link.download = filename
            document.body.appendChild(link)
            link.click()
            link.remove()
            URL.revokeObjectURL(objectUrl)
            setCopyFeedback('画像の保存を開始しました')
            setTimeout(() => setCopyFeedback(null), 1600)
        } catch (error) {
            console.error('[MobileTaskNode] Failed to download image:', error)
            window.open(url, '_blank', 'noopener,noreferrer')
            setCopyFeedback('画像を新しいタブで開きました')
            setTimeout(() => setCopyFeedback(null), 1800)
        }
    }, [])

    return (
        <div
            className={cn(
                "relative px-2 py-1.5 rounded-lg bg-background border text-xs shadow-sm flex flex-col gap-0.5 transition-all min-h-[36px]",
                data?.compact ? "w-[160px]" : "w-[200px]",
                isHabit && "border-blue-400 bg-blue-50 dark:bg-blue-950/30",
                isNodeSelected && isHabit && "ring-2 ring-blue-400 ring-offset-2 ring-offset-background",
                isNodeSelected && !isHabit && "ring-2 ring-primary ring-offset-2 ring-offset-background",
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
                    data?.isProxyTarget ? (
                        // Proxy mode: bridge input captures keystrokes, display here with fake cursor
                        <div className="nodrag nopan flex-1 text-sm min-w-0 flex items-center">
                            <span>{data.proxyText}</span>
                            <span
                                className="inline-block w-0.5 h-[1.1em] bg-foreground/80 ml-px"
                                style={{ animation: 'proxy-caret 1s step-end infinite' }}
                            />
                        </div>
                    ) : (
                        <input
                            ref={inputRef}
                            className="nodrag nopan flex-1 bg-transparent border-none text-sm focus:outline-none min-w-0"
                            value={editValue}
                            onChange={(e) => { setEditValue(e.target.value) }}
                            onBlur={() => { if (editValue !== data?.label) data?.onSave?.(editValue) }}
                            onFocus={(e) => { e.target.scrollIntoView = () => {} }}
                            enterKeyHint="done"
                            onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) return
                                if (e.key === 'Enter') {
                                    e.preventDefault()
                                    if (editValue !== data?.label) data?.onSave?.(editValue)
                                    inputRef.current?.blur()
                                    setIsEditing(false)
                                }
                                if (e.key === 'Escape') { setEditValue(data?.label ?? ''); setIsEditing(false) }
                            }}
                        />
                    )
                ) : (
                    <span className={cn("flex-1 text-xs truncate", isDone && "line-through text-muted-foreground")}>
                        {data?.label || ''}
                    </span>
                )}

                {/* Calendar sync indicator */}
                {data?.google_event_id && (
                    <CalendarIcon className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                )}

                {/* Menu button */}
                <button
                    className="nodrag nopan w-7 h-7 flex items-center justify-center text-muted-foreground active:bg-muted rounded shrink-0"
                    onClick={(e) => {
                        e.stopPropagation()
                        setShowMenu(true)
                    }}
                >
                    <MoreHorizontal className="w-4 h-4" />
                </button>
            </div>

            {showMenu && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 z-[80]"
                    onClick={() => setShowMenu(false)}
                >
                    <div className="absolute inset-0 bg-black/40" />
                    <div
                        className="absolute inset-x-0 bottom-0 bg-background rounded-t-2xl shadow-xl max-h-[84dvh] flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
                            <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                        </div>

                        <div className="flex items-center justify-between px-4 py-2 border-b flex-shrink-0">
                            <h3 className="text-base font-semibold">ノード詳細</h3>
                            <button
                                className="p-1.5 rounded-full hover:bg-muted transition-colors"
                                onClick={() => setShowMenu(false)}
                            >
                                <X className="w-4 h-4 text-muted-foreground" />
                            </button>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">タスク</div>
                                <button
                                    type="button"
                                    className="flex items-center justify-between w-full h-9 rounded px-1 active:bg-muted"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        data?.onUpdateStatus?.(isDone ? 'todo' : 'done')
                                    }}
                                >
                                    <span className="text-sm">完了</span>
                                    <Switch
                                        checked={isDone}
                                        onCheckedChange={(checked) => data?.onUpdateStatus?.(checked ? 'done' : 'todo')}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </button>
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">優先度</div>
                                <PriorityPopover
                                    value={(data?.priority ?? 3) as Priority}
                                    onChange={(priority) => data?.onUpdatePriority?.(priority)}
                                    trigger={
                                        <Button variant="outline" size="sm" className="w-full justify-start text-sm h-10">
                                            <Target className="w-4 h-4 mr-2" style={{ color: getPriorityIconColor((data?.priority ?? 3) as Priority) }} />
                                            {data?.priority != null ? <PriorityBadge value={data.priority as Priority} /> : <span className="text-muted-foreground">優先度を設定</span>}
                                        </Button>
                                    }
                                />
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">所要時間</div>
                                <EstimatedTimePopover
                                    valueMinutes={data?.estimatedDisplayMinutes ?? 0}
                                    onChangeMinutes={(minutes) => data?.onUpdateEstimatedTime?.(minutes)}
                                    isOverridden={!!data?.estimatedIsOverride}
                                    autoMinutes={data?.estimatedAutoMinutes}
                                    onResetAuto={data?.hasChildren ? () => data?.onUpdateEstimatedTime?.(0) : undefined}
                                    trigger={
                                        <Button variant="outline" size="sm" className="w-full justify-start text-sm h-10">
                                            <Clock className="w-4 h-4 mr-2" />
                                            {(data?.estimatedDisplayMinutes ?? 0) > 0 ? <EstimatedTimeBadge minutes={data.estimatedDisplayMinutes} /> : <span className="text-muted-foreground">所要時間を設定</span>}
                                        </Button>
                                    }
                                />
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">スケジュール</div>
                                <DateTimePicker
                                    date={data?.scheduled_at ? new Date(data.scheduled_at) : undefined}
                                    setDate={(date) => data?.onUpdateScheduledAt?.(date ? date.toISOString() : null)}
                                    trigger={
                                        <Button variant="outline" size="sm" className="w-full justify-start text-sm h-10">
                                            <CalendarIcon className="w-4 h-4 mr-2" />
                                            {data?.scheduled_at ? (
                                                <span>{format(new Date(data.scheduled_at), 'M/d HH:mm', { locale: ja })}</span>
                                            ) : <span className="text-muted-foreground">日時を設定</span>}
                                        </Button>
                                    }
                                />
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">カレンダー</div>
                                <TaskCalendarSelect
                                    value={data?.calendar_id || null}
                                    onChange={(calendarId) => data?.onUpdateCalendar?.(calendarId)}
                                    className="w-full h-10 justify-start"
                                />
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">メモ</div>
                                <textarea
                                    className="nodrag nopan w-full text-sm border rounded-lg p-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none min-h-[100px]"
                                    placeholder="メモを入力..."
                                    defaultValue={data?.memo || ''}
                                    key={data?.taskId + '-memo'}
                                    onBlur={(e) => {
                                        const val = e.target.value.trim() || null
                                        if (val !== (data?.memo || null)) {
                                            data?.onUpdateMemo?.(val)
                                        }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                />
                            </div>

                            <div className="rounded-lg border p-3 space-y-2">
                                <div className="text-xs font-medium text-muted-foreground">画像</div>
                                <div className="flex gap-1">
                                    <input
                                        className="nodrag nopan flex-1 h-9 text-sm border rounded px-2 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                                        placeholder="画像URL または data:image..."
                                        value={imageUrlInput}
                                        onChange={(e) => setImageUrlInput(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-9 px-3 text-xs"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleAddImageUrl()
                                        }}
                                    >
                                        追加
                                    </Button>
                                </div>

                                <label className="flex items-center justify-center gap-1 h-9 border rounded text-xs cursor-pointer hover:bg-muted/40">
                                    <ImagePlus className="w-3 h-3" />
                                    画像ファイルを追加
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        className="hidden"
                                        onChange={handleImageFileChange}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </label>

                                {memoImages.length > 0 && (
                                    <div className="space-y-2">
                                        {memoImages.map((url, index) => (
                                            <div key={`${url}-${index}`} className="border rounded p-2 space-y-2">
                                                <img
                                                    src={url}
                                                    alt={`memo-image-${index + 1}`}
                                                    className="w-full h-24 object-cover rounded bg-muted"
                                                />
                                                <div className="grid grid-cols-4 gap-1">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-[10px] px-1"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            writeClipboard(url, 'URLをコピーしました')
                                                        }}
                                                    >
                                                        <Link2 className="w-3 h-3 mr-1" />
                                                        URL
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-[10px] px-1"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            writeClipboard(`![image-${index + 1}](${url})`, 'Markdownをコピーしました')
                                                        }}
                                                    >
                                                        <Copy className="w-3 h-3 mr-1" />
                                                        MD
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-[10px] px-1"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleSaveImage(url, index)
                                                        }}
                                                    >
                                                        <Download className="w-3 h-3 mr-1" />
                                                        保存
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 text-[10px] px-1 text-red-400"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            handleRemoveImage(url)
                                                        }}
                                                    >
                                                        削除
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-9 justify-start text-xs"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        const aiPayload = buildAiMemoPayload()
                                        if (!aiPayload) return
                                        writeClipboard(aiPayload, 'AI用メモをコピーしました')
                                    }}
                                >
                                    <Sparkles className="w-3 h-3 mr-2" />
                                    AI用にメモ+画像をコピー
                                </Button>
                                {copyFeedback && (
                                    <div className="text-[10px] text-emerald-400">{copyFeedback}</div>
                                )}
                            </div>

                            <div className="rounded-lg border p-3">
                                <HabitSettingsPanel data={data} />
                            </div>
                        </div>

                        <div className="border-t px-4 py-3 grid grid-cols-2 gap-2 flex-shrink-0 bg-background">
                            <Button
                                size="sm"
                                variant="destructive"
                                className="h-10 text-sm"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    data?.onDelete?.()
                                    setShowMenu(false)
                                }}
                            >
                                <Trash2 className="w-4 h-4 mr-1" />
                                削除
                            </Button>
                            <Button
                                size="sm"
                                className="h-10 text-sm"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setShowMenu(false)
                                }}
                            >
                                閉じる
                            </Button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Row 2: Info */}
            {hasInfoRow && (
                <div className="flex items-center gap-1.5 pl-4 flex-wrap">
                    {hasEstimatedTime && <EstimatedTimeBadge minutes={data.estimatedDisplayMinutes} />}
                    {hasPriority && <PriorityBadge value={data.priority as Priority} />}
                    {hasMemo && <StickyNote className="w-3 h-3 text-muted-foreground" />}
                    {hasScheduledAt && (
                        <span className="text-[10px] text-muted-foreground ml-auto">
                            {format(new Date(data.scheduled_at), 'M/d HH:mm', { locale: ja })}
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
const mobileEdgeTypes = { branch: BranchEdge }
const defaultViewport = { x: 0, y: 0, zoom: 0.55 }

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
    const { keyboardHeight, isKeyboardOpen, viewportBottom } = useKeyboardHeight()

    // Hidden bridge input to maintain keyboard during node transitions
    const bridgeInputRef = useRef<HTMLInputElement>(null)

    // Keyboard accessory bar ref (passive: false で touchstart preventDefault を有効にする)
    const accessoryBarRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const el = accessoryBarRef.current
        if (!el) return
        const handler = (e: TouchEvent) => e.preventDefault()
        el.addEventListener('touchstart', handler, { passive: false })
        return () => el.removeEventListener('touchstart', handler)
    }, [selectedNodeId])

    // Text proxy: bridge captures keystrokes and forwards to new node display
    const [proxyTargetId, setProxyTargetId] = useState<string | null>(null)
    const [proxyText, setProxyText] = useState('')

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
                isSelected: selectedNodeId === projectId,
                onSave: async (newTitle: string) => onUpdateProject?.(projectId, newTitle),
                onAddChild: async () => onCreateGroup?.('新しいグループ'),
            },
        })

        // DFS to add task nodes
        const addTaskNodes = (task: Task, parentNodeId: string, depth = 0) => {
            const children = childrenMap.get(task.id) ?? []
            const hasChildren = children.length > 0
            const isCollapsed = collapsedTaskIds.has(task.id)
            const effectiveMinutes = getTaskEffectiveMinutes(task.id, childrenMap, taskMap)
            const autoMinutes = hasChildren ? getTaskAutoMinutes(task.id, childrenMap, taskMap) : 0
            const isOverride = hasChildren && (task.estimated_time ?? 0) > 0

            // Check if parent is habit
            const parent = task.parent_task_id ? taskMap.get(task.parent_task_id) : null
            const parentIsHabit = parent?.is_habit ?? false

            const hasInfoRow = (effectiveMinutes > 0) || (task.priority != null) || !!task.scheduled_at || !!task.memo
            const height = estimateTaskNodeHeight(task.title, hasInfoRow)

            const isNested = depth >= 1
            const nodeWidth = isNested ? NESTED_NODE_WIDTH : NODE_WIDTH

            nodes.push({
                id: task.id,
                type: 'mobileTaskNode',
                position: { x: 0, y: 0 },
                width: nodeWidth,
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
                    compact: isNested,
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
                        // テキストを先に保存
                        const activeInput = document.activeElement as HTMLInputElement
                        if (activeInput?.tagName === 'INPUT') {
                            const currentText = activeInput.value
                            if (currentText !== task.title) {
                                onUpdateTask?.(task.id, { title: currentText })
                            }
                        }

                        if (!task.parent_task_id) {
                            const newTask = await onCreateGroup?.('')
                            if (newTask) {
                                setSelectedNodeId(newTask.id)
                                focusNewNode(newTask.id)
                            }
                        } else {
                            const rootGroupId = findRootGroupIdUtil(task.id, taskMap)
                            const newTask = await onCreateTask?.(rootGroupId, '', task.parent_task_id)
                            if (newTask) {
                                setSelectedNodeId(newTask.id)
                                focusNewNode(newTask.id)
                            }
                        }
                    },
                    // Tab/子ノードボタン: 子ノード作成してフォーカス
                    onAddChildAndFocus: async () => {
                        // テキストを先に保存
                        const activeInput = document.activeElement as HTMLInputElement
                        if (activeInput?.tagName === 'INPUT') {
                            const currentText = activeInput.value
                            if (currentText !== task.title) {
                                onUpdateTask?.(task.id, { title: currentText })
                            }
                        }

                        const rootGroupId = findRootGroupIdUtil(task.id, taskMap)
                        const newTask = await onCreateTask?.(rootGroupId, '', task.id)
                        if (newTask) {
                            setCollapsedTaskIds(prev => { const n = new Set(prev); n.delete(task.id); return n })
                            setSelectedNodeId(newTask.id)
                            focusNewNode(newTask.id)
                        }
                    },
                    onUpdatePriority: (priority: number) => onUpdateTask?.(task.id, { priority }),
                    onUpdateStatus: (status: string) => onUpdateTask?.(task.id, { status }),
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
                    memo: task.memo,
                    memo_images: task.memo_images ?? null,
                    onUpdateMemo: (memo: string | null) => onUpdateTask?.(task.id, { memo }),
                    onUpdateMemoImages: (memo_images: string[] | null) => onUpdateTask?.(task.id, { memo_images }),
                },
            })

            edgeList.push({
                id: `e-${parentNodeId}-${task.id}`,
                source: parentNodeId,
                target: task.id,
                type: 'branch',
            })

            if (!isCollapsed) {
                for (const child of children) {
                    addTaskNodes(child, task.id, depth + 1)
                }
            }
        }

        const sortedGroups = [...groups].sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        for (const group of sortedGroups) {
            addTaskNodes(group, projectId, 0)
        }

        const { nodes: layouted, edges: layoutedEdges } = getLayoutedElements(nodes, edgeList)
        return { layoutNodes: layouted, edges: layoutedEdges }
    }, [project, groups, tasks, childrenMap, taskMap, collapsedTaskIds, selectedNodeId, onUpdateProject, onCreateGroup, onUpdateTask, onDeleteTask, onDeleteGroup, onCreateTask])

    // Proxy text augmentation (Dagre 再計算を避けるため layout useMemo とは分離)
    const augmentedNodes = useMemo(() => {
        if (!proxyTargetId) return layoutNodes
        return layoutNodes.map(node => {
            if (node.id === proxyTargetId) {
                return { ...node, data: { ...node.data, proxyText, isProxyTarget: true } }
            }
            return node
        })
    }, [layoutNodes, proxyTargetId, proxyText])

    const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
        if (proxyTargetId) {
            if (proxyText) onUpdateTask?.(proxyTargetId, { title: proxyText })
            setProxyTargetId(null)
            setProxyText('')
        }
        setSelectedNodeId(node.id)
    }, [proxyTargetId, proxyText, onUpdateTask])

    const handlePaneClick = useCallback(() => {
        if (proxyTargetId) {
            if (proxyText) onUpdateTask?.(proxyTargetId, { title: proxyText })
            setProxyTargetId(null)
            setProxyText('')
        }
        setSelectedNodeId(null)
        // 背景タップ → キーボード収納
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }
    }, [proxyTargetId, proxyText, onUpdateTask])

    // --- focusNewNode (must be defined BEFORE handleAccessoryAddChild/Sibling) ---
    const focusNewNode = useCallback((nodeId: string, useBridge = false) => {
        // ブリッジ input にフォーカスしてキーボードを維持
        if (useBridge) {
            bridgeInputRef.current?.focus()
        }
        const startTime = Date.now()
        const timer = setInterval(() => {
            if (Date.now() - startTime > 1000) {
                clearInterval(timer)
                return
            }
            const nodeEl = document.querySelector(`[data-id="${nodeId}"]`)
            if (nodeEl) {
                const input = nodeEl.querySelector('input') as HTMLInputElement
                if (input) {
                    // ブリッジからテキスト入力システムを切り離してから新しい input にフォーカス
                    if (bridgeInputRef.current && document.activeElement === bridgeInputRef.current) {
                        bridgeInputRef.current.blur()
                    }
                    input.focus()
                    input.select()
                    clearInterval(timer)
                    // iOS: フォーカス移行が不完全な場合のリトライ
                    requestAnimationFrame(() => {
                        if (document.activeElement !== input) {
                            input.focus()
                            input.select()
                        }
                    })
                }
            }
        }, 30)
    }, [])

    // Keyboard accessory bar callbacks for the selected node
    const selectedTask = selectedNodeId ? taskMap.get(selectedNodeId) : null
    // --- Proxy 終了ヘルパー ---
    const endProxy = useCallback((save = true) => {
        if (proxyTargetId && save && proxyText) {
            onUpdateTask?.(proxyTargetId, { title: proxyText })
        }
        setProxyTargetId(null)
        setProxyText('')
    }, [proxyTargetId, proxyText, onUpdateTask])

    const isProjectNodeSelected = selectedNodeId === project?.id

    const handleAccessoryAddChild = useCallback(() => {
        if (!selectedNodeId) return

        // プロジェクトノード選択中 → グループ作成
        if (selectedNodeId === project?.id) {
            endProxy()
            bridgeInputRef.current?.focus()
            onCreateGroup?.('').then(newTask => {
                if (newTask) {
                    setSelectedNodeId(newTask.id)
                    setProxyTargetId(newTask.id)
                    setProxyText('')
                }
            })
            return
        }

        const task = taskMap.get(selectedNodeId)
        if (!task) return

        // 進行中の proxy を保存終了
        endProxy()

        // テキストを先に保存
        const activeInput = document.activeElement as HTMLInputElement
        if (activeInput?.tagName === 'INPUT') {
            const currentText = activeInput.value
            if (currentText !== task.title) {
                onUpdateTask?.(selectedNodeId, { title: currentText })
            }
        }

        // ブリッジ input にフォーカスしてキーボード維持（ジェスチャーコンテキスト内）
        bridgeInputRef.current?.focus()

        const rootGroupId = findRootGroupIdUtil(selectedNodeId, taskMap)
        onCreateTask?.(rootGroupId, '', selectedNodeId).then(newTask => {
            if (newTask) {
                setCollapsedTaskIds(prev => { const n = new Set(prev); n.delete(selectedNodeId); return n })
                setSelectedNodeId(newTask.id)
                // proxy モード開始: bridge がテキストを受け取り、ノードに表示
                setProxyTargetId(newTask.id)
                setProxyText('')
            }
        })
    }, [selectedNodeId, project?.id, taskMap, onCreateGroup, onCreateTask, onUpdateTask, endProxy])

    const handleAccessoryAddSibling = useCallback(() => {
        if (!selectedNodeId) return
        // プロジェクトノードに兄弟はない
        if (selectedNodeId === project?.id) return
        const task = taskMap.get(selectedNodeId)
        if (!task) return

        // 進行中の proxy を保存終了
        endProxy()

        // テキストを先に保存
        const activeInput = document.activeElement as HTMLInputElement
        if (activeInput?.tagName === 'INPUT') {
            const currentText = activeInput.value
            if (currentText !== task.title) {
                onUpdateTask?.(selectedNodeId, { title: currentText })
            }
        }

        // ブリッジ input にフォーカスしてキーボード維持（ジェスチャーコンテキスト内）
        bridgeInputRef.current?.focus()

        if (!task.parent_task_id) {
            onCreateGroup?.('').then(newTask => {
                if (newTask) {
                    setSelectedNodeId(newTask.id)
                    setProxyTargetId(newTask.id)
                    setProxyText('')
                }
            })
        } else {
            const rootGroupId = findRootGroupIdUtil(selectedNodeId, taskMap)
            onCreateTask?.(rootGroupId, '', task.parent_task_id).then(newTask => {
                if (newTask) {
                    setSelectedNodeId(newTask.id)
                    setProxyTargetId(newTask.id)
                    setProxyText('')
                }
            })
        }
    }, [selectedNodeId, project?.id, taskMap, onCreateTask, onCreateGroup, onUpdateTask, endProxy])

    const handleAccessoryDelete = useCallback(() => {
        if (!selectedNodeId) return
        // プロジェクトノードは削除不可
        if (selectedNodeId === project?.id) return
        const task = taskMap.get(selectedNodeId)
        if (!task) return

        // proxy をクリア（削除対象ノードのため保存不要）
        if (proxyTargetId === selectedNodeId) {
            setProxyTargetId(null)
            setProxyText('')
        } else {
            endProxy()
        }

        // 削除前に次のフォーカス先を決定
        let nextNodeId: string | null = null
        if (task.parent_task_id) {
            const siblings = childrenMap.get(task.parent_task_id) ?? []
            const currentIndex = siblings.findIndex(s => s.id === selectedNodeId)
            if (currentIndex >= 0) {
                if (currentIndex + 1 < siblings.length) nextNodeId = siblings[currentIndex + 1].id
                else if (currentIndex - 1 >= 0) nextNodeId = siblings[currentIndex - 1].id
                else nextNodeId = task.parent_task_id
            }
        }

        // 次のノードがある場合、ブリッジ input でキーボード維持
        if (nextNodeId) bridgeInputRef.current?.focus()

        // 削除実行
        if (!task.parent_task_id) onDeleteGroup?.(selectedNodeId)
        else onDeleteTask?.(selectedNodeId)

        // 次のノードを選択
        if (nextNodeId) {
            setSelectedNodeId(nextNodeId)
            focusNewNode(nextNodeId)
        } else {
            setSelectedNodeId(null)
        }
    }, [selectedNodeId, project?.id, taskMap, childrenMap, onDeleteGroup, onDeleteTask, focusNewNode, proxyTargetId, endProxy])

    const handleAccessoryDismiss = useCallback(() => {
        endProxy()
        setSelectedNodeId(null)
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }
    }, [endProxy])

    // ノード追加/削除時にfitViewで全体が見えるように調整
    const prevNodeCountRef = useRef(augmentedNodes.length)
    useEffect(() => {
        if (augmentedNodes.length !== prevNodeCountRef.current) {
            prevNodeCountRef.current = augmentedNodes.length
            // ノード数変化 → レイアウト再計算後にfitView
            requestAnimationFrame(() => {
                reactFlow.fitView({ padding: 0.3, maxZoom: 1.0, duration: 200 })
            })
        }
    }, [augmentedNodes.length, reactFlow])

    // マインドマップ表示中はbodyのスクロールを防止
    useEffect(() => {
        document.body.style.overflow = 'hidden'
        document.body.style.position = 'fixed'
        document.body.style.width = '100%'
        document.body.style.height = '100%'
        return () => {
            document.body.style.overflow = ''
            document.body.style.position = ''
            document.body.style.width = ''
            document.body.style.height = ''
        }
    }, [])

    return (
        <div className="w-full h-full" style={{ touchAction: 'none', overflow: 'hidden', overscrollBehavior: 'none' }}>
            {/* Proxy caret blink animation */}
            <style>{`@keyframes proxy-caret{0%,49%{opacity:1}50%,100%{opacity:0}}`}</style>
            {/* ブリッジ input: キーボード維持 + proxy テキスト入力用 */}
            <input
                ref={bridgeInputRef}
                value={proxyTargetId ? proxyText : ''}
                onChange={(e) => { if (proxyTargetId) setProxyText(e.target.value) }}
                onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter' && proxyTargetId) {
                        e.preventDefault()
                        if (proxyText) onUpdateTask?.(proxyTargetId, { title: proxyText })
                        setProxyTargetId(null)
                        setProxyText('')
                        bridgeInputRef.current?.blur()
                    }
                }}
                onBlur={() => {
                    if (proxyTargetId) {
                        if (proxyText) onUpdateTask?.(proxyTargetId, { title: proxyText })
                        setProxyTargetId(null)
                        setProxyText('')
                    }
                }}
                style={{
                    position: 'fixed',
                    bottom: '50%',
                    left: '50%',
                    opacity: 0,
                    width: '1px',
                    height: '1px',
                    fontSize: '16px',
                    pointerEvents: 'none',
                    border: 'none',
                    outline: 'none',
                    padding: 0,
                    margin: 0,
                    caretColor: 'transparent',
                    zIndex: -1,
                }}
                tabIndex={-1}
                aria-hidden="true"
                enterKeyHint="done"
            />
            <ReactFlow
                nodes={augmentedNodes}
                edges={edges}
                nodeTypes={mobileNodeTypes}
                edgeTypes={mobileEdgeTypes}
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
                onlyRenderVisibleElements={false}
            >
                {/* No controls or background on mobile to save space */}
            </ReactFlow>

            {/* キーボード表示時に BottomNav をカバーして干渉を防ぐ */}
            {isKeyboardOpen && selectedNodeId && (
                <div
                    className="fixed left-0 right-0 bottom-0 z-[55] bg-background md:hidden"
                    style={{ top: `${viewportBottom}px` }}
                />
            )}

            {/* Keyboard Accessory Bar - top ベース配置で確実に可視領域の下端に表示 */}
            {selectedNodeId && (
                <div
                    ref={accessoryBarRef}
                    className="fixed left-0 right-0 z-[60] bg-background/95 backdrop-blur-sm border-t border-border md:hidden"
                    style={{
                        top: `${isKeyboardOpen ? viewportBottom - 48 : viewportBottom - 48 - 64}px`,
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <div className="flex items-center justify-between px-2 py-1.5 safe-area-inset-bottom">
                        {/* 左: 閉じる */}
                        <button
                            onTouchEnd={(e) => { e.preventDefault(); handleAccessoryDismiss() }}
                            onClick={handleAccessoryDismiss}
                            className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-muted-foreground active:bg-muted transition-colors"
                        >
                            <span className="text-xs">閉じる</span>
                            <ChevronDownKb className="w-4 h-4" />
                        </button>

                        {/* 右: 兄弟・子・削除（右手操作に最適化） */}
                        <div className="flex items-center gap-0.5">
                            {/* 兄弟ノード追加（プロジェクトノード選択中は非表示） */}
                            {!isProjectNodeSelected && (
                                <>
                                    <button
                                        onTouchEnd={(e) => { e.preventDefault(); handleAccessoryAddSibling() }}
                                        onClick={handleAccessoryAddSibling}
                                        className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-foreground active:bg-muted transition-colors"
                                        title="兄弟ノード追加"
                                    >
                                        <Plus className="w-5 h-5" />
                                        <span className="text-xs">兄弟</span>
                                    </button>

                                    {/* セパレータ */}
                                    <div className="w-px h-5 bg-border mx-1" />
                                </>
                            )}

                            {/* 子ノード作成 */}
                            <button
                                onTouchEnd={(e) => { e.preventDefault(); handleAccessoryAddChild() }}
                                onClick={handleAccessoryAddChild}
                                className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-foreground active:bg-muted transition-colors"
                                title="子ノード追加"
                            >
                                <CornerDownRight className="w-5 h-5" />
                                <span className="text-xs">子</span>
                            </button>

                            {/* 削除（プロジェクトノード選択中は非表示） */}
                            {!isProjectNodeSelected && (
                                <>
                                    {/* セパレータ */}
                                    <div className="w-px h-5 bg-border mx-1" />

                                    <button
                                        onTouchEnd={(e) => { e.preventDefault(); handleAccessoryDelete() }}
                                        onClick={handleAccessoryDelete}
                                        className="flex items-center justify-center w-10 h-9 rounded-md text-destructive active:bg-destructive/10 transition-colors"
                                        title="削除"
                                    >
                                        <Trash2 className="w-4.5 h-4.5" />
                                    </button>
                                </>
                            )}
                        </div>
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
