"use client"

import { useCallback, useMemo, useState } from "react"
import {
    ArrowRight,
    CalendarClock,
    Clock3,
    Loader2,
    NotebookPen,
    Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Project } from "@/types/database"

interface LongTermTaskDraft {
    title: string
    memo: string
    estimated_time: number
    priority: number | null
    reason: string
}

interface ScheduleProposalDraft {
    task_title: string
    title: string
    scheduled_at: string
    estimated_time: number
    calendar_id: string | null
    reason: string
}

interface LongTermPlanDraft {
    title: string
    horizon: string
    summary: string
    memo: string
    tasks: LongTermTaskDraft[]
    schedule_proposals: ScheduleProposalDraft[]
}

interface LongTermPlannerViewProps {
    projects: Project[]
    selectedProjectId: string | null
    onSelectProject: (id: string) => void
}

const EXAMPLES = [
    "生成AIの勉強をちゃんと進めたい。まず何を調べて、いつ時間を取るか決めたい",
    "新しい事業アイデアを調べたい。競合、料金、最初の検証をメモにして予定も入れたい",
    "英語の会話練習を始めたい。平日夜か週末で続けやすい時間を提案して",
]

function formatDateTime(iso: string): string {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return iso
    const day = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()]
    const datePart = `${date.getMonth() + 1}/${date.getDate()}(${day})`
    const timePart = date.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Tokyo",
    })
    return `${datePart} ${timePart}`
}

function priorityLabel(priority: number | null): string {
    if (priority === 1) return "高"
    if (priority === 2) return "中"
    if (priority === 3) return "低"
    return "未設定"
}

export function LongTermPlannerView({
    projects,
    selectedProjectId,
    onSelectProject,
}: LongTermPlannerViewProps) {
    const [input, setInput] = useState("")
    const [plan, setPlan] = useState<LongTermPlanDraft | null>(null)
    const [suggestionId, setSuggestionId] = useState<string | null>(null)
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const selectedProject = useMemo(
        () => projects.find(project => project.id === selectedProjectId) ?? null,
        [projects, selectedProjectId],
    )

    const analyze = useCallback(async () => {
        const message = input.trim()
        if (!message || isAnalyzing) return

        setError(null)
        setIsAnalyzing(true)
        try {
            const res = await fetch("/api/ai/long-term-planner", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "整理に失敗しました")
            setPlan(data.plan)
            setSuggestionId(data.suggestionId ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "整理に失敗しました")
        } finally {
            setIsAnalyzing(false)
        }
    }, [input, isAnalyzing])

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-background">
            <div className="border-b px-4 py-3 md:px-6">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-base font-semibold">長期プラン</h1>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            雑な文章を、メモ・タスク・予定候補に整理します
                        </p>
                    </div>
                    {projects.length > 0 && (
                        <select
                            value={selectedProjectId || ""}
                            onChange={(e) => onSelectProject(e.target.value)}
                            className="h-9 max-w-[180px] rounded-md border bg-background px-2 text-xs"
                        >
                            {projects.map(project => (
                                <option key={project.id} value={project.id}>{project.title}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 pb-24 md:px-6 md:pb-6">
                <div className="mx-auto grid w-full max-w-6xl gap-4 md:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
                    <section className="space-y-3">
                        <div className="rounded-lg border bg-card p-3">
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                                <Sparkles className="h-4 w-4 text-primary" />
                                入力
                            </div>
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="やりたいこと、勉強したいこと、調べたいことをそのまま入力..."
                                className="min-h-[180px] w-full resize-none rounded-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                            />
                            <div className="mt-3 flex flex-wrap gap-2">
                                {EXAMPLES.map(example => (
                                    <button
                                        key={example}
                                        onClick={() => setInput(example)}
                                        className="rounded-md border px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
                                    >
                                        {example}
                                    </button>
                                ))}
                            </div>
                            <Button
                                onClick={analyze}
                                disabled={!input.trim() || isAnalyzing}
                                className="mt-3 h-11 w-full gap-2"
                            >
                                {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                                予定案に整理
                            </Button>
                        </div>

                        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
                            対象: {selectedProject?.title ?? "プロジェクト未選択"}。ここではプラン作成だけ行い、タスク作成やカレンダー登録はしません。
                        </div>
                    </section>

                    <section className="min-h-[420px] rounded-lg border bg-card">
                        {!plan ? (
                            <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
                                <NotebookPen className="mb-3 h-8 w-8 text-muted-foreground" />
                                <p className="text-sm font-medium">整理結果がここに出ます</p>
                                <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                                    濃い内容はメモに残し、最初の一歩だけ予定候補にします。
                                </p>
                            </div>
                        ) : (
                            <div className="flex h-full flex-col">
                                <div className="border-b p-4">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h2 className="text-lg font-semibold">{plan.title}</h2>
                                        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                                            {plan.horizon}
                                        </span>
                                    </div>
                                    {plan.summary && (
                                        <p className="mt-2 text-sm text-muted-foreground">{plan.summary}</p>
                                    )}
                                </div>

                                <div className="space-y-4 p-4">
                                    {plan.memo && (
                                        <PlanBlock icon={<NotebookPen className="h-4 w-4" />} title="メモ">
                                            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{plan.memo}</p>
                                        </PlanBlock>
                                    )}

                                    <PlanBlock icon={<ArrowRight className="h-4 w-4" />} title="タスク案">
                                        <div className="space-y-2">
                                            {plan.tasks.map((task) => (
                                                <div key={task.title} className="rounded-md border p-3">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-medium">{task.title}</p>
                                                            {task.memo && <p className="mt-1 text-xs text-muted-foreground">{task.memo}</p>}
                                                        </div>
                                                        <span className="shrink-0 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                                                            {priorityLabel(task.priority)}
                                                        </span>
                                                    </div>
                                                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                                        <Clock3 className="h-3.5 w-3.5" />
                                                        {task.estimated_time}分
                                                        {task.reason && <span className="truncate">・{task.reason}</span>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </PlanBlock>

                                    <PlanBlock icon={<CalendarClock className="h-4 w-4" />} title="時間候補">
                                        {plan.schedule_proposals.length > 0 ? (
                                            <div className="grid gap-2 md:grid-cols-2">
                                                {plan.schedule_proposals.map((proposal) => (
                                                    <div key={`${proposal.task_title}-${proposal.scheduled_at}`} className="rounded-md border p-3">
                                                        <p className="text-sm font-medium">{proposal.title}</p>
                                                        <p className="mt-1 text-xs text-primary">
                                                            {formatDateTime(proposal.scheduled_at)} / {proposal.estimated_time}分
                                                        </p>
                                                        {proposal.reason && (
                                                            <p className="mt-2 text-xs text-muted-foreground">{proposal.reason}</p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-muted-foreground">時間候補はまだありません。</p>
                                        )}
                                    </PlanBlock>
                                </div>

                                <div className="mt-auto border-t p-4">
                                    {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
                                    <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                                        プランID: {suggestionId ?? "未保存"}。この画面では提案の作成までで止めています。
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                {error && !plan && (
                    <p className="mx-auto mt-3 max-w-6xl text-sm text-destructive">{error}</p>
                )}
            </div>
        </div>
    )
}

function PlanBlock({ icon, title, children }: {
    icon: React.ReactNode
    title: string
    children: React.ReactNode
}) {
    return (
        <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                {icon}
                {title}
            </div>
            {children}
        </div>
    )
}
