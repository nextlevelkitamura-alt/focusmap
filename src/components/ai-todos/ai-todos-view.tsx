"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/utils/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    CheckCircle2,
    Circle,
    Loader2,
    RefreshCw,
    Users,
    TrendingUp,
    Clock,
} from "lucide-react"
import type { AiTodoProgress, PipelineSummary, KpiSummary } from "@/types/ai-todo"

interface AiTodosViewProps {
    initialTasks: AiTodoProgress[]
    initialSnapshot: {
        pipeline_summary: PipelineSummary | null
        kpi_summary: KpiSummary | null
        updated_at: string
    } | null
    sessionDate: string
}

const TAG_COLORS: Record<string, string> = {
    "#line": "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    "#dev": "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    "#routine": "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
    "#meeting": "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    "#admin": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    "#idea": "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
}

const STATUS_CONFIG = {
    in_progress: {
        icon: Loader2,
        iconClass: "text-blue-500 animate-spin",
        label: "進行中",
        sectionClass: "border-l-blue-500",
    },
    pending: {
        icon: Circle,
        iconClass: "text-gray-400",
        label: "未着手",
        sectionClass: "border-l-gray-300",
    },
    completed: {
        icon: CheckCircle2,
        iconClass: "text-green-500",
        label: "完了",
        sectionClass: "border-l-green-500",
    },
} as const

const KPI_LABELS: Record<string, string> = {
    hearing: "ヒアリング",
    acquisition: "獲得",
    interview_set: "面接設定",
    interview_done: "面接実施",
    deals: "成約",
}

const KPI_TARGETS: Record<string, number> = {
    hearing: 40,
    acquisition: 0,
    interview_set: 16,
    interview_done: 10,
    deals: 4,
}

export function AiTodosView({ initialTasks, initialSnapshot, sessionDate }: AiTodosViewProps) {
    const [tasks, setTasks] = useState<AiTodoProgress[]>(initialTasks)
    const [snapshot, setSnapshot] = useState(initialSnapshot)
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
    const [isRefreshing, setIsRefreshing] = useState(false)

    const fetchData = useCallback(async () => {
        const supabase = createClient()

        const [tasksResult, snapshotResult] = await Promise.all([
            supabase
                .from('ai_todo_progress')
                .select('*')
                .eq('session_date', sessionDate)
                .order('order_index', { ascending: true }),
            supabase
                .from('ai_dashboard_snapshot')
                .select('*')
                .eq('snapshot_date', sessionDate)
                .maybeSingle(),
        ])

        if (tasksResult.data) setTasks(tasksResult.data as AiTodoProgress[])
        if (snapshotResult.data) setSnapshot(snapshotResult.data as typeof snapshot)
        setLastUpdated(new Date())
    }, [sessionDate])

    // 15 second polling
    useEffect(() => {
        const interval = setInterval(fetchData, 15000)
        return () => clearInterval(interval)
    }, [fetchData])

    const handleRefresh = async () => {
        setIsRefreshing(true)
        await fetchData()
        setIsRefreshing(false)
    }

    // Group tasks by status
    const inProgress = tasks.filter(t => t.task_status === 'in_progress')
    const pending = tasks.filter(t => t.task_status === 'pending')
    const completed = tasks.filter(t => t.task_status === 'completed')
    const completedCount = completed.length
    const totalCount = tasks.length
    const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

    const pipeline = snapshot?.pipeline_summary as PipelineSummary | null
    const kpi = snapshot?.kpi_summary as KpiSummary | null

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-2xl mx-auto space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold">AI Todo 進捗</h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {sessionDate} - 最終更新 {lastUpdated.toLocaleTimeString('ja-JP')}
                        </p>
                    </div>
                    <button
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="p-2 rounded-lg hover:bg-accent transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>

                {/* Progress Bar */}
                {totalCount > 0 && (
                    <Card>
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium">
                                    {completedCount} / {totalCount} タスク完了
                                </span>
                                <span className="text-2xl font-bold">{progressPercent}%</span>
                            </div>
                            <div className="w-full h-3 bg-secondary rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 rounded-full transition-all duration-500"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Task Sections */}
                {totalCount === 0 ? (
                    <Card>
                        <CardContent className="py-12 text-center">
                            <Circle className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                            <p className="text-muted-foreground">まだタスクが同期されていません</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Claude Code でタスクを実行すると自動で表示されます
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <>
                        <TaskSection tasks={inProgress} status="in_progress" />
                        <TaskSection tasks={pending} status="pending" />
                        <TaskSection tasks={completed} status="completed" />
                    </>
                )}

                {/* Pipeline Card */}
                {pipeline && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <Users className="h-4 w-4" />
                                パイプライン
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {/* Temperature bars */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs w-16 text-right font-medium">対応中</span>
                                    <span className="text-lg font-bold">{pipeline.active}名</span>
                                </div>
                                <div className="flex gap-1 h-6 rounded-full overflow-hidden">
                                    {pipeline.hot > 0 && (
                                        <div
                                            className="bg-red-500 flex items-center justify-center text-[10px] text-white font-medium"
                                            style={{ flex: pipeline.hot }}
                                        >
                                            HOT {pipeline.hot}
                                        </div>
                                    )}
                                    {pipeline.warm > 0 && (
                                        <div
                                            className="bg-orange-400 flex items-center justify-center text-[10px] text-white font-medium"
                                            style={{ flex: pipeline.warm }}
                                        >
                                            WARM {pipeline.warm}
                                        </div>
                                    )}
                                    {pipeline.cold > 0 && (
                                        <div
                                            className="bg-blue-400 flex items-center justify-center text-[10px] text-white font-medium"
                                            style={{ flex: pipeline.cold }}
                                        >
                                            COLD {pipeline.cold}
                                        </div>
                                    )}
                                </div>
                                {/* Phase breakdown */}
                                {pipeline.phases && Object.keys(pipeline.phases).length > 0 && (
                                    <div className="grid grid-cols-2 gap-1.5 mt-2">
                                        {Object.entries(pipeline.phases).map(([phase, count]) => (
                                            <div key={phase} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-secondary/50">
                                                <span className="text-muted-foreground">{phase}</span>
                                                <span className="font-medium">{count as number}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* KPI Card */}
                {kpi && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-base">
                                <TrendingUp className="h-4 w-4" />
                                月間 KPI
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {(Object.keys(KPI_LABELS) as Array<keyof typeof KPI_LABELS>).map(key => {
                                    const value = kpi[key as keyof KpiSummary] as number || 0
                                    const target = kpi.targets?.[key] || KPI_TARGETS[key] || 0
                                    const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
                                    return (
                                        <div key={key}>
                                            <div className="flex items-center justify-between text-sm mb-1">
                                                <span>{KPI_LABELS[key]}</span>
                                                <span className="font-medium">
                                                    {value} / {target}
                                                    <span className="text-xs text-muted-foreground ml-1">({percent}%)</span>
                                                </span>
                                            </div>
                                            <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-500 ${percent >= 100 ? 'bg-green-500' : percent >= 50 ? 'bg-blue-500' : 'bg-orange-400'}`}
                                                    style={{ width: `${percent}%` }}
                                                />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}

function TaskSection({ tasks, status }: { tasks: AiTodoProgress[]; status: keyof typeof STATUS_CONFIG }) {
    if (tasks.length === 0) return null

    const config = STATUS_CONFIG[status]
    const Icon = config.icon

    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <Icon className={`h-4 w-4 ${config.iconClass}`} />
                <h2 className="text-sm font-medium text-muted-foreground">
                    {config.label} ({tasks.length})
                </h2>
            </div>
            <div className="space-y-1.5">
                {tasks.map(task => (
                    <TaskCard key={task.id} task={task} />
                ))}
            </div>
        </div>
    )
}

function TaskCard({ task }: { task: AiTodoProgress }) {
    const config = STATUS_CONFIG[task.task_status as keyof typeof STATUS_CONFIG]
    const Icon = config.icon
    const tagColorClass = task.task_tag ? TAG_COLORS[task.task_tag] || "bg-secondary text-secondary-foreground" : null

    return (
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-3 ${config.sectionClass} bg-card border border-border/50`}>
            <Icon className={`h-4 w-4 shrink-0 ${config.iconClass}`} />
            <div className="flex-1 min-w-0">
                <span className="text-sm">{task.task_title}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
                {task.scheduled_time && (
                    <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {task.scheduled_time}
                    </span>
                )}
                {task.task_tag && tagColorClass && (
                    <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${tagColorClass}`}>
                        {task.task_tag.replace('#', '')}
                    </Badge>
                )}
            </div>
        </div>
    )
}
