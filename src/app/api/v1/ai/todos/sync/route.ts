import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
    return handleCors()
}

// POST /api/v1/ai/todos/sync — Full-state sync of today's tasks
export async function POST(request: NextRequest) {
    const auth = await authenticateApiKey(request, 'ai_todos:write')
    if (isAuthError(auth)) return auth

    let body: {
        session_date?: string
        tasks?: Array<{
            title: string
            status: string
            tag?: string | null
            scheduled_time?: string | null
            source?: string
            order_index?: number
        }>
    }
    try {
        body = await request.json()
    } catch {
        return apiError('INVALID_BODY', 'Invalid request body', 400)
    }

    if (!body.tasks || !Array.isArray(body.tasks)) {
        return apiError('VALIDATION_ERROR', 'tasks array is required', 400)
    }

    const sessionDate = body.session_date || new Date().toISOString().split('T')[0]

    let serviceClient
    try {
        serviceClient = createServiceClient()
    } catch {
        return apiError('SERVER_ERROR', 'Service configuration error', 500)
    }

    // Delete existing tasks for this date
    const { error: deleteError } = await serviceClient
        .from('ai_todo_progress')
        .delete()
        .eq('user_id', auth.userId)
        .eq('session_date', sessionDate)

    if (deleteError) {
        return apiError('DELETE_ERROR', deleteError.message, 500)
    }

    // Insert new tasks
    if (body.tasks.length > 0) {
        const now = new Date().toISOString()
        const rows = body.tasks.map((task, index) => ({
            user_id: auth.userId,
            session_date: sessionDate,
            task_title: task.title,
            task_status: task.status || 'pending',
            task_tag: task.tag || null,
            scheduled_time: task.scheduled_time || null,
            source: task.source || 'claude_code',
            completed_at: task.status === 'completed' ? now : null,
            order_index: task.order_index ?? index,
        }))

        const { data, error: insertError } = await serviceClient
            .from('ai_todo_progress')
            .insert(rows)
            .select('*')

        if (insertError) {
            return apiError('INSERT_ERROR', insertError.message, 500)
        }

        return apiSuccess(data, 200)
    }

    return apiSuccess([], 200)
}
