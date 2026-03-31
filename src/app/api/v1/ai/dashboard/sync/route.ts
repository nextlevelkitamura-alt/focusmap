import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
    return handleCors()
}

// POST /api/v1/ai/dashboard/sync — Upsert pipeline + KPI snapshot
export async function POST(request: NextRequest) {
    const auth = await authenticateApiKey(request, 'ai_todos:write')
    if (isAuthError(auth)) return auth

    let body: {
        snapshot_date?: string
        pipeline_summary?: Record<string, unknown> | null
        kpi_summary?: Record<string, unknown> | null
    }
    try {
        body = await request.json()
    } catch {
        return apiError('INVALID_BODY', 'Invalid request body', 400)
    }

    const snapshotDate = body.snapshot_date || new Date().toISOString().split('T')[0]

    let serviceClient
    try {
        serviceClient = createServiceClient()
    } catch {
        return apiError('SERVER_ERROR', 'Service configuration error', 500)
    }

    const { data, error } = await serviceClient
        .from('ai_dashboard_snapshot')
        .upsert(
            {
                user_id: auth.userId,
                snapshot_date: snapshotDate,
                pipeline_summary: body.pipeline_summary || null,
                kpi_summary: body.kpi_summary || null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,snapshot_date' }
        )
        .select('*')
        .single()

    if (error) {
        return apiError('UPSERT_ERROR', error.message, 500)
    }

    return apiSuccess(data, 200)
}
