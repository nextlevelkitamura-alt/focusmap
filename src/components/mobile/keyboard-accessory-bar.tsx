"use client"

import { IndentIncrease, IndentDecrease, Plus, Trash2, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface KeyboardAccessoryBarProps {
    keyboardHeight: number
    canIndent: boolean
    canOutdent: boolean
    onIndent: () => void
    onOutdent: () => void
    onAddChild: () => void
    onDelete: () => void
    onDismiss: () => void
}

export function KeyboardAccessoryBar({
    keyboardHeight,
    canIndent,
    canOutdent,
    onIndent,
    onOutdent,
    onAddChild,
    onDelete,
    onDismiss,
}: KeyboardAccessoryBarProps) {
    return (
        <div
            className="fixed left-0 right-0 z-[60] bg-background/95 backdrop-blur-sm border-t border-border md:hidden"
            style={{ bottom: `${keyboardHeight}px` }}
        >
            <div className="flex items-center justify-between px-2 py-1.5 safe-area-inset-bottom">
                <div className="flex items-center gap-0.5">
                    {/* インデント（子ノード化） */}
                    <button
                        disabled={!canIndent}
                        onClick={onIndent}
                        className={cn(
                            "flex items-center justify-center w-10 h-9 rounded-md transition-colors",
                            canIndent
                                ? "text-foreground active:bg-muted"
                                : "text-muted-foreground/40"
                        )}
                        title="インデント"
                    >
                        <IndentIncrease className="w-5 h-5" />
                    </button>

                    {/* アウトデント（親レベルへ） */}
                    <button
                        disabled={!canOutdent}
                        onClick={onOutdent}
                        className={cn(
                            "flex items-center justify-center w-10 h-9 rounded-md transition-colors",
                            canOutdent
                                ? "text-foreground active:bg-muted"
                                : "text-muted-foreground/40"
                        )}
                        title="アウトデント"
                    >
                        <IndentDecrease className="w-5 h-5" />
                    </button>

                    {/* セパレータ */}
                    <div className="w-px h-5 bg-border mx-1" />

                    {/* 子タスク追加 */}
                    <button
                        onClick={onAddChild}
                        className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-foreground active:bg-muted transition-colors"
                        title="子タスク追加"
                    >
                        <Plus className="w-4 h-4" />
                        <span className="text-xs">子追加</span>
                    </button>

                    {/* セパレータ */}
                    <div className="w-px h-5 bg-border mx-1" />

                    {/* 削除 */}
                    <button
                        onClick={onDelete}
                        className="flex items-center justify-center w-10 h-9 rounded-md text-destructive active:bg-destructive/10 transition-colors"
                        title="削除"
                    >
                        <Trash2 className="w-4.5 h-4.5" />
                    </button>
                </div>

                {/* キーボード閉じる */}
                <button
                    onClick={onDismiss}
                    className="flex items-center justify-center gap-1 h-9 px-2.5 rounded-md text-muted-foreground active:bg-muted transition-colors"
                >
                    <span className="text-xs">閉じる</span>
                    <ChevronDown className="w-4 h-4" />
                </button>
            </div>
        </div>
    )
}
