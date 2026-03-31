import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { AiTodosView } from "@/components/ai-todos/ai-todos-view"

export default async function AiTodosPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    const today = new Date().toISOString().split('T')[0]

    const [tasksResult, snapshotResult] = await Promise.all([
        supabase
            .from('ai_todo_progress')
            .select('*')
            .eq('session_date', today)
            .order('order_index', { ascending: true }),
        supabase
            .from('ai_dashboard_snapshot')
            .select('*')
            .eq('snapshot_date', today)
            .maybeSingle(),
    ])

    return (
        <AiTodosView
            initialTasks={tasksResult.data || []}
            initialSnapshot={snapshotResult.data || null}
            sessionDate={today}
        />
    )
}
