import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

// OPTIONS /api/v1/calendar/events
export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/calendar/events
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'calendar:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const calendarId = searchParams.get('calendar_id')
  const limitParam = searchParams.get('limit')
  const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 500) : 100

  // from / to のバリデーション
  if (from && Number.isNaN(new Date(from).getTime())) {
    return apiError('BAD_REQUEST', 'Invalid "from" date format. Use ISO 8601.', 400)
  }
  if (to && Number.isNaN(new Date(to).getTime())) {
    return apiError('BAD_REQUEST', 'Invalid "to" date format. Use ISO 8601.', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  let query = serviceClient
    .from('calendar_events')
    .select('id, title, start_time, end_time, calendar_id, description, location, is_all_day, status, created_at, updated_at')
    .eq('user_id', auth.userId)
    .order('start_time', { ascending: true })
    .limit(limit)

  if (from) {
    query = query.gte('start_time', from)
  }
  if (to) {
    query = query.lte('start_time', to)
  }
  if (calendarId) {
    query = query.eq('calendar_id', calendarId)
  }

  const { data: events, error } = await query

  if (error) {
    console.error('[v1/calendar/events] query error:', error.message)
    return apiError('SERVER_ERROR', 'Failed to fetch calendar events', 500)
  }

  return apiSuccess({
    events: events ?? [],
    count: (events ?? []).length,
  })
}
