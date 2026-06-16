import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request)
  if (isAuthError(auth)) return auth

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const [spaces, projects, settings, calendars] = await Promise.all([
    serviceClient
      .from('spaces')
      .select('id, title, status, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(50),
    serviceClient
      .from('projects')
      .select('id, title, description, purpose, space_id, status, repo_path, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(30),
    serviceClient
      .from('user_calendar_settings')
      .select('default_calendar_id, is_sync_enabled')
      .eq('user_id', auth.userId)
      .maybeSingle(),
    serviceClient
      .from('user_calendars')
      .select('google_calendar_id, name, timezone, access_level, selected, background_color, color')
      .eq('user_id', auth.userId)
      .eq('selected', true)
      .limit(50),
  ])

  if (spaces.error) return apiError('QUERY_ERROR', spaces.error.message, 500)
  if (projects.error) return apiError('QUERY_ERROR', projects.error.message, 500)
  if (settings.error) return apiError('QUERY_ERROR', settings.error.message, 500)
  if (calendars.error) return apiError('QUERY_ERROR', calendars.error.message, 500)

  return apiSuccess({
    user_id: auth.userId,
    scopes: auth.scopes,
    timezone: calendars.data?.[0]?.timezone ?? 'Asia/Tokyo',
    calendar_sync_enabled: settings.data?.is_sync_enabled ?? false,
    default_calendar_id: settings.data?.default_calendar_id ?? null,
    spaces: spaces.data ?? [],
    recent_projects: projects.data ?? [],
    selected_calendars: calendars.data ?? [],
    prompt_hint: '大きなマインドマップ整理は /api/v1/mindmap/drafts にAI案として保存し、ユーザー確認後だけ apply してください。',
  })
}
