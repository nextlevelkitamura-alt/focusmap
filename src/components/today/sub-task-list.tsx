"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Task } from "@/types/database"
import { useTimer, formatTime } from "@/contexts/TimerContext"
import { Play, Pause, CheckSquare, Square, Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"

interface SubTaskSectionProps {
    parentTaskId: string
    childTasks: Task[]
    onCreateSubTask: (parentTaskId: string, title: string) => void
    onToggleSubTask: (taskId: string) => void
    onDeleteSubTask?: (taskId: string) => void
}

export function SubTaskSection({ parentTaskId, childTasks, onCreateSubTask, onToggleSubTask, onDeleteSubTask }: SubTaskSectionProps) {
    const timer = useTimer()
    const [inputValue, setInputValue] = useState("")
    const [showInput, setShowInput] = useState(childTasks.length === 0)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (showInput) {
            setTimeout(() => inputRef.current?.focus(), 100)
        }
    }, [showInput])

    const handleSubmit = useCallback(() => {
        const title = inputValue.trim()
        if (!title) return
        onCreateSubTask(parentTaskId, title)
        setInputValue("")
    }, [inputValue, parentTaskId, onCreateSubTask])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === "Enter" && inputValue.trim()) {
            e.preventDefault()
            handleSubmit()
        } else if (e.key === "Escape") {
            setShowInput(false)
            setInputValue("")
        }
    }, [handleSubmit, inputValue])

    const doneCount = childTasks.filter(t => t.status === 'done').length
    const totalCount = childTasks.length

    return (
        <div
            className="mt-1 bg-background/95 backdrop-blur-sm rounded-lg border border-border shadow-lg p-2 space-y-0.5 touch-auto"
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Child tasks list */}
            {childTasks.map((child) => {
                const isDone = child.status === 'done'
                const isRunning = timer.runningTaskId === child.id
                const hasElapsed = (child.total_elapsed_seconds ?? 0) > 0

                return (
                    <div
                        key={child.id}
                        className={cn(
                            "flex items-center gap-1.5 py-1 px-1 rounded",
                            isRunning && "bg-primary/5"
                        )}
                    >
                        <button
                            onClick={() => onToggleSubTask(child.id)}
                            className="flex-shrink-0"
                        >
                            {isDone ? (
                                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                            ) : (
                                <Square className="w-3.5 h-3.5 text-muted-foreground/50" />
                            )}
                        </button>
                        <span className={cn(
                            "text-[11px] flex-1 truncate",
                            isDone ? "line-through text-muted-foreground" : "text-foreground"
                        )}>
                            {child.title}
                        </span>
                        {isRunning ? (
                            <span className="text-[9px] font-mono text-primary flex-shrink-0">
                                {formatTime(timer.currentElapsedSeconds)}
                            </span>
                        ) : hasElapsed ? (
                            <span className="text-[9px] font-mono text-muted-foreground flex-shrink-0">
                                {formatTime(child.total_elapsed_seconds ?? 0)}
                            </span>
                        ) : null}
                        <button
                            onClick={() => isRunning ? timer.pauseTimer() : timer.startTimer(child)}
                            className={cn(
                                "p-0.5 rounded flex-shrink-0",
                                isRunning ? "text-primary" : "text-muted-foreground/40"
                            )}
                        >
                            {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                        {onDeleteSubTask && (
                            <button
                                onClick={() => onDeleteSubTask(child.id)}
                                className="p-0.5 rounded flex-shrink-0 text-muted-foreground/30 hover:text-destructive transition-colors"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                )
            })}

            {/* Inline input */}
            {showInput ? (
                <div className="flex items-center gap-1.5 py-1 px-1">
                    <Plus className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
                    <input
                        ref={inputRef}
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={() => {
                            if (!inputValue.trim()) setShowInput(false)
                        }}
                        placeholder="サブタスクを追加..."
                        className="flex-1 text-[11px] bg-transparent outline-none placeholder:text-muted-foreground/40"
                    />
                </div>
            ) : (
                <button
                    onClick={() => setShowInput(true)}
                    className="flex items-center gap-1.5 py-1 px-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors w-full"
                >
                    <Plus className="w-3.5 h-3.5" />
                    <span className="text-[11px]">追加</span>
                </button>
            )}

            {/* Progress bar */}
            {totalCount > 0 && (
                <div className="pt-1 px-1">
                    <div className="flex items-center gap-2">
                        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                            <div
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                style={{ width: `${(doneCount / totalCount) * 100}%` }}
                            />
                        </div>
                        <span className="text-[9px] text-muted-foreground flex-shrink-0">
                            {doneCount}/{totalCount}
                        </span>
                    </div>
                </div>
            )}
        </div>
    )
}
