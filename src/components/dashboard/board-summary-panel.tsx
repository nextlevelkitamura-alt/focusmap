"use client"

import { useEffect, useState } from "react"
import { format } from "date-fns"
import { LayoutGrid, ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface SummaryTask {
    id: string
    title: string
    statusLabel: string | null
}

interface SummaryTheme {
    id: string
    name: string
    pct: number | null
    liveCount: number
    waitCount: number
    openTasks: SummaryTask[]
    doneCount: number
}

interface BoardSummary {
    progressPct: number | null
    liveTotal: number
    waitTotal: number
    asksCount: number
    themes: SummaryTheme[]
}

interface BoardSummaryPanelProps {
    selectedDate: Date
}

const MAX_TASKS = 5

// PCサイドバー上段の当日ボード要約。スマホboardページと同一DB・同一導出（/api/board/summary）。
// 失敗時はサイドバーを壊さないため非表示、取得中は薄いスケルトンを出す。
export function BoardSummaryPanel({ selectedDate }: BoardSummaryPanelProps) {
    const dateStr = format(selectedDate, "yyyy-MM-dd")
    const [summary, setSummary] = useState<BoardSummary | null>(null)
    const [loading, setLoading] = useState(true)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setFailed(false)
        fetch(`/api/board/summary?date=${dateStr}`)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return res.json()
            })
            .then((json) => {
                if (cancelled) return
                if (json?.success && json.summary) {
                    setSummary(json.summary as BoardSummary)
                } else {
                    setFailed(true)
                }
            })
            .catch(() => {
                if (!cancelled) setFailed(true)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [dateStr])

    // 失敗時はサイドバーを壊さないため何も描画しない。
    if (failed) return null

    if (loading && !summary) {
        return (
            <section className="border-b border-border/35 px-3 py-3">
                <div className="mb-2 h-3 w-24 animate-pulse rounded bg-muted/60" />
                <div className="space-y-2">
                    <div className="h-14 animate-pulse rounded-lg bg-muted/40" />
                    <div className="h-14 animate-pulse rounded-lg bg-muted/40" />
                </div>
            </section>
        )
    }

    if (!summary) return null

    const hasContent = summary.themes.length > 0 || summary.progressPct !== null

    return (
        <section className="border-b border-border/35 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-primary" />
                    <h3 className="text-[11px] font-semibold text-muted-foreground">当日ボード</h3>
                </div>
                <Link
                    href={`/dashboard/board?date=${dateStr}`}
                    className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary transition-colors hover:text-primary/80"
                >
                    ボードを開く
                    <ArrowUpRight className="h-3 w-3" />
                </Link>
            </div>

            {/* 全体サマリ帯 */}
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/45 bg-muted/[0.06] px-2.5 py-2 text-[11px]">
                <span className="font-semibold text-foreground">
                    {summary.progressPct !== null ? `${summary.progressPct}%` : "—"}
                </span>
                <span className="text-muted-foreground">進捗</span>
                <span className="ml-auto flex items-center gap-2 text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {summary.liveTotal}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {summary.waitTotal}
                    </span>
                    {summary.asksCount > 0 && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                            きみの番 {summary.asksCount}
                        </span>
                    )}
                </span>
            </div>

            {hasContent && summary.themes.length > 0 ? (
                <div className="space-y-1.5">
                    {summary.themes.map((theme) => {
                        const shown = theme.openTasks.slice(0, MAX_TASKS)
                        const remaining = theme.openTasks.length - shown.length
                        return (
                            <div
                                key={theme.id}
                                className="rounded-lg border border-border/45 bg-muted/[0.05] px-2.5 py-2"
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                                        {theme.name}
                                    </span>
                                    {theme.pct !== null && (
                                        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                                            {theme.pct}%
                                        </span>
                                    )}
                                    {theme.liveCount > 0 && (
                                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                                            🟢{theme.liveCount}
                                        </span>
                                    )}
                                    {theme.waitCount > 0 && (
                                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                                            ⏸{theme.waitCount}
                                        </span>
                                    )}
                                </div>

                                {shown.length > 0 ? (
                                    <ul className="mt-1.5 space-y-1">
                                        {shown.map((task) => (
                                            <li key={task.id} className="flex items-start gap-1.5 text-[11px]">
                                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                                                <span className="min-w-0 flex-1 truncate text-foreground/90">
                                                    {task.title}
                                                </span>
                                                {task.statusLabel && (
                                                    <span className="shrink-0 rounded border border-border/50 px-1 py-0 text-[9px] text-muted-foreground">
                                                        {task.statusLabel}
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                        {remaining > 0 && (
                                            <li className="pl-2.5 text-[10px] text-muted-foreground">
                                                ほか {remaining} 件
                                            </li>
                                        )}
                                    </ul>
                                ) : (
                                    <p className={cn("mt-1 text-[10px] text-muted-foreground")}>
                                        やることなし
                                    </p>
                                )}
                            </div>
                        )
                    })}
                </div>
            ) : (
                <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-center text-[11px] text-muted-foreground">
                    この日のテーマ・やることはまだありません。
                </p>
            )}
        </section>
    )
}
