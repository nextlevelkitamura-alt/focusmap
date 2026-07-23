"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { LayoutGrid, ArrowUpRight, Plus } from "lucide-react"
import Link from "next/link"
import { ThemePlanBoard } from "@/components/today/board-v2/theme-plan-board"
import { StrayBox } from "@/components/today/board-v2/stray-box"
import { UnplannedAgents } from "@/components/today/board-v2/unplanned-agents"
import type { BoardV2Data } from "@/components/today/board-v2/types"
import type { Theme } from "@/lib/turso/themes"

interface BoardSummaryPanelProps {
    selectedDate: Date
    projectRepoPath?: string | null
}

// PCサイドバー上段の当日ボード。スマホboardページと同一DB・同一導出・同一部品（/api/board/summary が
// 完全な BoardV2Data を返し、ThemeCardV2 / StrayBox でそのまま描画する。修正01・条件7）。
// 折りたたみ挙動も同一部品側に持たせる（パネル側に個別実装しない。修正02・条件2）。
// 失敗時はサイドバーを壊さないため非表示、取得中は薄いスケルトンを出す。
export function BoardSummaryPanel({ selectedDate, projectRepoPath }: BoardSummaryPanelProps) {
    const dateStr = format(selectedDate, "yyyy-MM-dd")
    const [board, setBoard] = useState<BoardV2Data | null>(null)
    const [loading, setLoading] = useState(true)
    const [failed, setFailed] = useState(false)
    const [phaseNotice, setPhaseNotice] = useState(false)

    // Theme本体だけを楽観的に置き換える。plan_refsやPlan本文は変更しない。
    const applyOptimisticTheme = useCallback((nextTheme: Theme) => {
        setBoard((previous) => {
            if (!previous) return previous
            const replaceTheme = (theme: Theme | null) => theme?.id === nextTheme.id ? nextTheme : theme
            return {
                ...previous,
                themeGroups: previous.themeGroups.map((group) => ({
                    ...group,
                    theme: replaceTheme(group.theme),
                    title: group.theme?.id === nextTheme.id ? nextTheme.name : group.title,
                    plans: group.plans.map((plan) => ({ ...plan, theme: replaceTheme(plan.theme) })),
                })),
                planCards: previous.planCards.map((plan) => ({ ...plan, theme: replaceTheme(plan.theme) })),
            }
        })
    }, [])

    // スマホboardページのBoardPoller(10秒)と同じ周期で再取得し、開きっぱなしのPCでも
    // スマホ側の変更が自動で追随する。裏の再取得ではloadingを立てない（ちらつき防止）。
    useEffect(() => {
        let cancelled = false
        const load = (initial: boolean) => {
            if (initial) {
                setLoading(true)
                setFailed(false)
            }
            fetch(`/api/board/summary?date=${dateStr}`)
                .then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    return res.json()
                })
                .then((json) => {
                    if (cancelled) return
                    if (json?.success && json.board) {
                        setBoard(json.board as BoardV2Data)
                        setFailed(false)
                    } else if (initial) {
                        setFailed(true)
                    }
                })
                .catch(() => {
                    if (!cancelled && initial) setFailed(true)
                })
                .finally(() => {
                    if (!cancelled && initial) setLoading(false)
                })
        }
        load(true)
        const timer = window.setInterval(() => load(false), 10_000)
        const refreshOnReturn = () => {
            if (document.visibilityState === "visible") load(false)
        }
        document.addEventListener("visibilitychange", refreshOnReturn)
        window.addEventListener("focus", refreshOnReturn)
        return () => {
            cancelled = true
            window.clearInterval(timer)
            document.removeEventListener("visibilitychange", refreshOnReturn)
            window.removeEventListener("focus", refreshOnReturn)
        }
    }, [dateStr])

    // 失敗時はサイドバーを壊さないため何も描画しない。
    if (failed) return null

    if (loading && !board) {
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

    if (!board) return null

    const strayHasContent =
        board.stray.tasks.length > 0 ||
        board.stray.sessions.length > 0 ||
        board.stray.finishedTodos.length > 0 ||
        board.stray.finishedLogs.length > 0
    const hasUnplanned = board.unplannedSessions.length > 0

    return (
        <section className="border-b border-border/35 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-primary" />
                    <h3 className="text-[11px] font-semibold text-muted-foreground">当日ボード</h3>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => setPhaseNotice(true)}
                        aria-label="テーマを追加"
                        aria-describedby={phaseNotice ? "sidebar-theme-draft-notice" : undefined}
                        className="inline-grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <Plus className="h-3.5 w-3.5" />
                    </button>
                    <Link
                        href={`/dashboard/board?date=${dateStr}`}
                        className="inline-flex min-h-11 items-center gap-0.5 rounded-lg px-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-muted hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        ボードを開く
                        <ArrowUpRight className="h-3 w-3" />
                    </Link>
                </div>
            </div>

            {phaseNotice ? (
                <p id="sidebar-theme-draft-notice" role="status" className="mb-2 rounded-lg border border-dashed border-border px-2.5 py-2 text-[10.5px] text-muted-foreground">
                    テーマ追加の保存は次のDB接続段階で実装します。
                </p>
            ) : null}

            {board.isPreview ? (
                <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-2 text-[10.5px] text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-100">
                    <span className="font-semibold">サンプル表示</span>
                    <span className="ml-1 opacity-75">実データが空の開発環境だけ・保存なし</span>
                </div>
            ) : null}

            {/* 全体サマリ帯 */}
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/45 bg-muted/[0.06] px-2.5 py-2 text-[11px]">
                <span className="font-semibold text-foreground">
                    {board.progressPct !== null ? `${board.progressPct}%` : "—"}
                </span>
                <span className="text-muted-foreground">進捗</span>
                <span className="ml-auto flex items-center gap-2 text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {board.liveTotal}
                    </span>
                    <span className="inline-flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        {board.waitTotal}
                    </span>
                </span>
            </div>

            {/* スマホboardと同一部品でそのまま描画（テーマ→計画カード→未分類・子07） */}
            <div className="space-y-2.5">
                {board.themeGroups.length > 0 ? (
                    <ThemePlanBoard
                        groups={board.themeGroups}
                        selectedDate={dateStr}
                        aiTargets={board.aiTargets}
                        compact
                        isPreview={board.isPreview}
                        projectRepoPath={projectRepoPath}
                        onThemeChange={applyOptimisticTheme}
                    />
                ) : null}

                {hasUnplanned ? (
                    <UnplannedAgents sessions={board.unplannedSessions} selectedDate={dateStr} />
                ) : null}

                {strayHasContent ? (
                    <StrayBox stray={board.stray} selectedDate={dateStr} aiTargets={board.aiTargets} />
                ) : null}

                {board.themeGroups.length === 0 && !strayHasContent && !hasUnplanned ? (
                    <p className="rounded-lg border border-dashed border-border/50 px-3 py-3 text-center text-[11px] text-muted-foreground">
                        この日の計画・やることはまだありません。
                    </p>
                ) : null}
            </div>
        </section>
    )
}
