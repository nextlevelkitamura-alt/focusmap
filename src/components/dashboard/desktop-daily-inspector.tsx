"use client"

import { useMemo } from "react"
import { format } from "date-fns"
import { ja } from "date-fns/locale"
import { CalendarDays, Check, Clock3, Pencil, Square, X } from "lucide-react"
import type { TimeBlock } from "@/lib/time-block"
import { cn } from "@/lib/utils"
import { BoardSummaryPanel } from "@/components/dashboard/board-summary-panel"

interface DesktopDailyInspectorProps {
    selectedDate: Date
    items: TimeBlock[]
    selectedItem: TimeBlock | null
    onSelectItem: (item: TimeBlock) => void
    onEditItem: (item: TimeBlock) => void
    onClose: () => void
    width?: number
}

function itemKey(item: TimeBlock) {
    return `${item.source}-${item.id}`
}

function sourceLabel(item: TimeBlock) {
    return item.originalTask ? "タスク" : "カレンダー"
}

export function DesktopDailyInspector({
    selectedDate,
    items,
    selectedItem,
    onSelectItem,
    onEditItem,
    onClose,
    width,
}: DesktopDailyInspectorProps) {
    const sortedItems = useMemo(
        () => [...items].sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
        [items],
    )
    const activeSelectedItem = useMemo(() => {
        if (!selectedItem) return null
        return sortedItems.find((item) => itemKey(item) === itemKey(selectedItem)) ?? selectedItem
    }, [selectedItem, sortedItems])

    return (
        <aside
            aria-label="デイリー"
            className="flex h-full w-[360px] min-w-[320px] shrink-0 flex-col border-l border-border/60 bg-background/95 shadow-[-12px_0_32px_rgba(0,0,0,0.28)] backdrop-blur-sm"
            style={width ? { width } : undefined}
        >
            <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4 text-primary" />
                        <h2 className="text-sm font-semibold tracking-tight">デイリー</h2>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {format(selectedDate, "M月d日(E)", { locale: ja })}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                    aria-label="デイリーを閉じる"
                    title="デイリーを閉じる"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <BoardSummaryPanel selectedDate={selectedDate} />

                <section className="border-b border-border/35 px-3 py-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-[11px] font-semibold text-muted-foreground">選んだ予定</h3>
                        {activeSelectedItem && (
                            <span className="rounded border border-border/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {sourceLabel(activeSelectedItem)}
                            </span>
                        )}
                    </div>

                    {activeSelectedItem ? (
                        <div className="rounded-lg border border-primary/25 bg-primary/[0.07] p-3">
                            <div className="flex items-start gap-2">
                                <span
                                    className="mt-0.5 h-8 w-1 shrink-0 rounded-full"
                                    style={{ backgroundColor: activeSelectedItem.color }}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-semibold leading-5 text-foreground">
                                        {activeSelectedItem.title}
                                    </p>
                                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                        <Clock3 className="h-3.5 w-3.5" />
                                        <span>
                                            {format(activeSelectedItem.startTime, "HH:mm")} - {format(activeSelectedItem.endTime, "HH:mm")}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                                <span className={cn(
                                    "inline-flex items-center gap-1 text-[11px]",
                                    activeSelectedItem.isCompleted ? "text-emerald-400" : "text-muted-foreground",
                                )}>
                                    {activeSelectedItem.isCompleted ? <Check className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                                    {activeSelectedItem.isCompleted ? "完了" : "未完了"}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => onEditItem(activeSelectedItem)}
                                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/70"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    予定を編集
                                </button>
                            </div>
                        </div>
                    ) : (
                        <p className="rounded-lg border border-dashed border-border/50 px-3 py-4 text-center text-[11px] text-muted-foreground">
                            カレンダーまたは一覧から予定を選ぶと、内容をここに表示します。
                        </p>
                    )}
                </section>

                <section className="px-3 py-3">
                    <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-[11px] font-semibold text-muted-foreground">この日の予定</h3>
                        <span className="text-[11px] text-muted-foreground">{sortedItems.length}件</span>
                    </div>

                    {sortedItems.length > 0 ? (
                        <div className="space-y-1.5">
                            {sortedItems.map((item) => {
                                const isSelected = activeSelectedItem ? itemKey(activeSelectedItem) === itemKey(item) : false
                                return (
                                    <button
                                        key={itemKey(item)}
                                        type="button"
                                        onClick={() => onSelectItem(item)}
                                        className={cn(
                                            "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                                            isSelected
                                                ? "border-primary/40 bg-primary/10"
                                                : "border-border/45 bg-muted/[0.05] hover:bg-muted/45",
                                        )}
                                    >
                                        <span
                                            className="mt-0.5 h-6 w-1 shrink-0 rounded-full"
                                            style={{ backgroundColor: item.color }}
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[10px] text-muted-foreground">
                                                {format(item.startTime, "HH:mm")} - {format(item.endTime, "HH:mm")}
                                            </span>
                                            <span className={cn(
                                                "mt-0.5 block truncate text-xs",
                                                item.isCompleted && "text-muted-foreground line-through",
                                            )}>
                                                {item.title}
                                            </span>
                                        </span>
                                        {item.isCompleted && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                                    </button>
                                )
                            })}
                        </div>
                    ) : (
                        <p className="rounded-lg border border-dashed border-border/50 px-3 py-5 text-center text-[11px] text-muted-foreground">
                            この日の予定はありません。
                        </p>
                    )}
                </section>
            </div>
        </aside>
    )
}
