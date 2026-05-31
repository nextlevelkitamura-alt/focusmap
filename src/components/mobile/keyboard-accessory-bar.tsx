"use client"

import type React from "react"
import { IndentIncrease, IndentDecrease, Plus, Trash2, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface KeyboardAccessoryBarProps {
    keyboardHeight: number
    viewportBottom?: number
    canIndent?: boolean
    canOutdent?: boolean
    showIndentControls?: boolean
    addSiblingLabel?: string
    addSiblingAriaLabel?: string
    onIndent?: () => void
    onOutdent?: () => void
    onAddChild?: () => void
    onAddSibling?: () => void
    onDelete?: () => void
    onDismiss: () => void
}

export function KeyboardAccessoryBar({
    keyboardHeight,
    viewportBottom = 0,
    canIndent = false,
    canOutdent = false,
    showIndentControls = true,
    addSiblingLabel = "兄弟",
    addSiblingAriaLabel = "兄弟ノード追加",
    onIndent,
    onOutdent,
    onAddChild,
    onAddSibling,
    onDelete,
    onDismiss,
}: KeyboardAccessoryBarProps) {
    const positionStyle = viewportBottom > 0
        ? { top: `${viewportBottom}px`, bottom: "auto", transform: "translateY(-100%)" }
        : { bottom: `${keyboardHeight}px` }
    const preserveKeyboardFocus = (event: React.PointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
    }

    return (
        <div
            className="fixed left-0 right-0 z-[60] bg-background/95 backdrop-blur-sm border-t border-border md:hidden"
            style={positionStyle}
        >
            <div className="flex items-center justify-between px-2 py-1.5 safe-area-inset-bottom">
                {/* キーボード閉じる */}
                <button
                    type="button"
                    onClick={onDismiss}
                    className="flex min-h-11 items-center justify-center gap-1 rounded-md px-2.5 text-muted-foreground transition-colors active:bg-muted"
                    aria-label="キーボードを閉じる"
                >
                    <ChevronDown className="h-4 w-4" />
                    <span className="text-xs">閉じる</span>
                </button>

                <div className="ml-auto flex items-center justify-end gap-0.5">
                    {showIndentControls && (
                        <>
                            {/* インデント（子ノード化） */}
                            <button
                                type="button"
                                disabled={!canIndent || !onIndent}
                                onPointerDown={preserveKeyboardFocus}
                                onMouseDown={preserveKeyboardFocus}
                                onClick={onIndent}
                                className={cn(
                                    "flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors",
                                    canIndent && onIndent
                                        ? "text-foreground active:bg-muted"
                                        : "text-muted-foreground/40"
                                )}
                                title="インデント"
                                aria-label="インデント"
                            >
                                <IndentIncrease className="h-5 w-5" />
                            </button>

                            {/* アウトデント（親レベルへ） */}
                            <button
                                type="button"
                                disabled={!canOutdent || !onOutdent}
                                onPointerDown={preserveKeyboardFocus}
                                onMouseDown={preserveKeyboardFocus}
                                onClick={onOutdent}
                                className={cn(
                                    "flex min-h-11 min-w-11 items-center justify-center rounded-md transition-colors",
                                    canOutdent && onOutdent
                                        ? "text-foreground active:bg-muted"
                                        : "text-muted-foreground/40"
                                )}
                                title="アウトデント"
                                aria-label="アウトデント"
                            >
                                <IndentDecrease className="h-5 w-5" />
                            </button>

                            {/* セパレータ */}
                            <div className="mx-1 h-5 w-px bg-border" />
                        </>
                    )}

                    {/* 子タスク追加 */}
                    {onAddChild && (
                        <button
                            type="button"
                            onPointerDown={preserveKeyboardFocus}
                            onMouseDown={preserveKeyboardFocus}
                            onClick={onAddChild}
                            className="flex min-h-11 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors active:bg-muted"
                            title="子タスク追加"
                            aria-label="子ノード追加"
                        >
                            <Plus className="h-4 w-4" />
                            <span className="text-xs">子追加</span>
                        </button>
                    )}

                    {onAddSibling && (
                        <button
                            type="button"
                            onPointerDown={preserveKeyboardFocus}
                            onMouseDown={preserveKeyboardFocus}
                            onClick={onAddSibling}
                            className="flex min-h-11 items-center justify-center gap-1 rounded-md px-3 text-foreground transition-colors active:bg-muted"
                            title={addSiblingAriaLabel}
                            aria-label={addSiblingAriaLabel}
                        >
                            <Plus className="h-4 w-4" />
                            <span className="text-xs">{addSiblingLabel}</span>
                        </button>
                    )}

                    {/* セパレータ */}
                    {onDelete && <div className="mx-1 h-5 w-px bg-border" />}

                    {/* 削除 */}
                    {onDelete && (
                        <button
                            type="button"
                            onPointerDown={preserveKeyboardFocus}
                            onMouseDown={preserveKeyboardFocus}
                            onClick={onDelete}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-destructive transition-colors active:bg-destructive/10"
                            title="削除"
                            aria-label="ノード削除"
                        >
                            <Trash2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
