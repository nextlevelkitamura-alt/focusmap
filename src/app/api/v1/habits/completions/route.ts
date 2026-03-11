import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'

export async function OPTIONS() {
  return handleCors()
}

// GET /api/v1/habits/completions — Get habit completions
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'habits:read')
  if (isAuthError(auth)) return auth

  const { searchParams } = new URL(request.url)
  const habit_id = searchParams.get('habit_id')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!habit_id) {
    return apiError('VALIDATION_ERROR', 'habit_id is required', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  // 習慣がユーザーのものか確認
  const { data: habit } = await serviceClient
    .from('tasks')
    .select('id')
    .eq('id', habit_id)
    .eq('user_id', auth.userId)
    .eq('is_habit', true)
    .is('deleted_at', null)
    .single()

  if (!habit) {
    return apiError('NOT_FOUND', 'Habit not found', 404)
  }

  let query = serviceClient
    .from('habit_completions')
    .select('*')
    .eq('habit_id', habit_id)
    .order('completed_date', { ascending: false })

  if (from) query = query.gte('completed_date', from)
  if (to) query = query.lte('completed_date', to)

  const { data, error } = await query

  if (error) {
    return apiError('QUERY_ERROR', error.message, 500)
  }

  return apiSuccess(data)
}

// POST /api/v1/habits/completions — Record a habit completion
export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'habits:write')
  if (isAuthError(auth)) return auth

  let body: {
    habit_id?: string
    completed_date?: string
  }
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  if (!body.habit_id) {
    return apiError('VALIDATION_ERROR', 'habit_id is required', 400)
  }
  if (!body.completed_date) {
    return apiError('VALIDATION_ERROR', 'completed_date is required (YYYY-MM-DD)', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  // 習慣がユーザーのものか確認
  const { data: habit } = await serviceClient
    .from('tasks')
    .select('id')
    .eq('id', body.habit_id)
    .eq('user_id', auth.userId)
    .eq('is_habit', true)
    .is('deleted_at', null)
    .single()

  if (!habit) {
    return apiError('NOT_FOUND', 'Habit not found', 404)
  }

  // upsert: 同じ habit_id + completed_date の重複を防ぐ
  const { data, error } = await serviceClient
    .from('habit_completions')
    .upsert(
      {
        habit_id: body.habit_id,
        completed_date: body.completed_date,
        user_id: auth.userId,
      },
      { onConflict: 'habit_id,completed_date' },
    )
    .select('*')
    .single()

  if (error) {
    return apiError('INSERT_ERROR', error.message, 500)
  }

  return apiSuccess(data, 201)
}

// DELETE /api/v1/habits/completions — Remove a habit completion
export async function DELETE(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'habits:write')
  if (isAuthError(auth)) return auth

  let body: {
    habit_id?: string
    completed_date?: string
  }
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }

  if (!body.habit_id || !body.completed_date) {
    return apiError('VALIDATION_ERROR', 'habit_id and completed_date are required', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  // 習慣がユーザーのものか確認
  const { data: habit } = await serviceClient
    .from('tasks')
    .select('id')
    .eq('id', body.habit_id)
    .eq('user_id', auth.userId)
    .eq('is_habit', true)
    .is('deleted_at', null)
    .single()

  if (!habit) {
    return apiError('NOT_FOUND', 'Habit not found', 404)
  }

  const { error } = await serviceClient
    .from('habit_completions')
    .delete()
    .eq('habit_id', body.habit_id)
    .eq('completed_date', body.completed_date)

  if (error) {
    return apiError('DELETE_ERROR', error.message, 500)
  }

  return apiSuccess({ deleted: true })
}
