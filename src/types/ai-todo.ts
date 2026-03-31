export interface AiTodoProgress {
    id: string
    user_id: string
    session_date: string
    task_title: string
    task_status: 'pending' | 'in_progress' | 'completed'
    task_tag: string | null
    scheduled_time: string | null
    source: 'claude_code' | 'schedule_md'
    completed_at: string | null
    order_index: number
    created_at: string
    updated_at: string
}

export interface PipelineSummary {
    active: number
    hot: number
    warm: number
    cold: number
    phases: Record<string, number>
}

export interface KpiSummary {
    hearing: number
    acquisition: number
    interview_set: number
    interview_done: number
    deals: number
    targets: Record<string, number>
}

export interface AiDashboardSnapshot {
    id: string
    user_id: string
    snapshot_date: string
    pipeline_summary: PipelineSummary | null
    kpi_summary: KpiSummary | null
    updated_at: string
}

export type AiTodoStatus = 'pending' | 'in_progress' | 'completed'
export type AiTodoSource = 'claude_code' | 'schedule_md'
