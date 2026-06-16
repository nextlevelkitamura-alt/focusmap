import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { changedMeta, isRecord } from '../../../../_lib/external-ai'
import {
  normalizeCalendarError,
  updateCalendarEventV1,
} from '../../../../_lib/calendar-event-actions'

export async function OPTIONS() {
  return handleCors()
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const auth = await authenticateApiKey(request, 'calendar:write')
  if (isAuthError(auth)) return auth

  const { eventId } = await params
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const body = await request.json().catch(() => ({}))
    if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)
    const result = await updateCalendarEventV1(serviceClient, auth.userId, eventId, body)
    return apiSuccess(result, 200, changedMeta(['calendar_events', 'tasks', 'ideal_goals']))
  } catch (error) {
    const normalized = normalizeCalendarError(error)
    return apiError(normalized.code, normalized.message, normalized.status)
  }
}
