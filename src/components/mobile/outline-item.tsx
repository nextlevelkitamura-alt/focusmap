"use client"

import { memo, useRef, useEffect, useCallback } from "react"
import { Task } from "@/types/database"
import { ChevronRight, ChevronDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import { EstimatedTimeBadge } from "@/components/ui/estimated-time-select"

interface OutlineItemProps {
    task: Task
    depth: number
    isFocused: boolean
    isCollapsed: boolean
    hasChildren: boolean
    isNewlyCreated: boolean
    onToggleCollapse: () => void
    onFocus: (taskId: string) => void
    onTitleChange: (taskId: string, newTitle: string) => void
    onKeyDown: (taskId: string, e: React.KeyboardEvent<HTMLInputElement>) => void
    onToggleStatus: (taskId: string) => void
    inputRef: (el: HTMLInputElement | null) => void
}

const INDENT_PX = 20
const MAX_DEPTH = 6

export const OutlineItem = memo(function OutlineItem({
    task,
    depth,
    isFocused,
    isCollapsed,
    hasChildren,
    isNewlyCreated,
    onToggleCollapse,
    onFocus,
    onTitleChange,
    onKeyDown,
    onToggleStatus,
    inputRef,
}: OutlineItemProps) {
    const localRef = useRef<HTMLInputElement>(null)

    const setRef = useCallback((el: HTMLInputElement | null) => {
        (localRef as React.MutableRefObject<HTMLInputElement | null>).current = el
        inputRef(el)
    }, [inputRef])

    // 新規作成時のオートフォーカス
    useEffect(() => {
        if (isNewlyCreated && localRef.current) {
            setTimeout(() => {
                localRef.current?.focus()
                localRef.current?.select()
                // キーボード展開時にアイテムが見えるようにスクロール
                localRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }, 100)
        }
    }, [isNewlyCreated])

    // 外部からのタイトル変更を同期（フォーカスしていない時のみ）
    useEffect(() => {
        if (localRef.current && localRef.current !== document.activeElement) {
            localRef.current.value = task.title
        }
    }, [task.title])

    const isRootGroup = !task.parent_task_id
    const isDone = task.status === 'done'

    return (
        <div
            className={cn(
                "flex items-center gap-1 py-1.5 px-2 min-h-[40px] border-b border-border/30 transition-colors",
                isFocused && "bg-primary/5",
            )}
            style={{ paddingLeft: `${depth * INDENT_PX + 8}px` }}
        >
            {/* 折りたたみ / バレット */}
            <button
                onClick={hasChildren ? onToggleCollapse : undefined}
                className={cn(
                    "relative flex items-center justify-center w-6 h-6 shrink-0 rounded transition-colors before:absolute before:-inset-2 before:content-['']",
                    hasChildren ? "text-muted-foreground active:bg-muted" : "text-muted-foreground/30"
                )}
            >
                {hasChildren ? (
                    isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                ) : (
                    <Minus className="w-3 h-3" />
                )}
            </button>

            {/* チェックボックス */}
            {!isRootGroup && (
                <button
                    className={cn(
                        "relative w-5 h-5 rounded border flex items-center justify-center transition-all shrink-0 before:absolute before:-inset-2.5 before:content-[''] active:scale-90",
                        isDone
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-muted-foreground/30 active:border-primary"
                    )}
                    onClick={() => onToggleStatus(task.id)}
                >
                    {isDone && (
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </button>
            )}

            {/* タイトル入力 */}
            <input
                ref={setRef}
                className={cn(
                    "flex-1 bg-transparent border-none text-sm focus:outline-none focus:ring-0 px-1 min-w-0",
                    isRootGroup && "font-semibold text-base",
                    isDone && "text-muted-foreground line-through",
                )}
                defaultValue={task.title}
                placeholder={isRootGroup ? "グループ名..." : "タスク名..."}
                enterKeyHint="done"
                onFocus={() => onFocus(task.id)}
                onBlur={(e) => {
                    const newValue = e.target.value
                    if (newValue !== task.title) {
                        onTitleChange(task.id, newValue)
                    }
                }}
                onKeyDown={(e) => onKeyDown(task.id, e)}
            />

            {/* 使用時間バッジ */}
            {!isRootGroup && (task.estimated_time ?? 0) > 0 && (
                <span className="text-[10px] text-muted-foreground whitespace-nowrap px-1">
                    {task.estimated_time >= 60
                        ? `${Math.floor(task.estimated_time / 60)}h${task.estimated_time % 60 > 0 ? `${task.estimated_time % 60}m` : ''}`
                        : `${task.estimated_time}m`
                    }
                </span>
            )}
        </div>
    )
})
