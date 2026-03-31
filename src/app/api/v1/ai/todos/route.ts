import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
    return handleCors()
}

// GET /api/v1/ai/todos — Read today's tasks and dashboard snapshot
export async function GET(request: NextRequest) {
    const auth = await authenticateApiKey(request, 'ai_todos:read')
    if (isAuthError(auth)) return auth

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

    let serviceClient
    try {
        serviceClient = createServiceClient()
    } catch {
        return apiError('SERVER_ERROR', 'Service configuration error', 500)
    }

    // Fetch tasks and snapshot in parallel
    const [tasksResult, snapshotResult] = await Promise.all([
        serviceClient
            .from('ai_todo_progress')
            .select('*')
            .eq('user_id', auth.userId)
            .eq('session_date', date)
            .order('order_index', { ascending: true }),
        serviceClient
            .from('ai_dashboard_snapshot')
            .select('*')
            .eq('user_id', auth.userId)
            .eq('snapshot_date', date)
            .maybeSingle(),
    ])

    if (tasksResult.error) {
        return apiError('QUERY_ERROR', tasksResult.error.message, 500)
    }

    return apiSuccess({
        tasks: tasksResult.data,
        dashboard: snapshotResult.data || null,
    })
}
