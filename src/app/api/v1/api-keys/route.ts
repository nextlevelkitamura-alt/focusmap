import { NextRequest } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateApiKey } from '@/lib/api-key'
import { apiSuccess, apiError, handleCors } from '../_lib/response'

export async function OPTIONS() {
  return handleCors()
}

// POST /api/v1/api-keys — Generate a new API key (Cookie auth)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return apiError('UNAUTHORIZED', 'Unauthorized', 401)
  }

  try {
    const body = await request.json()
    const { name, scopes } = body as { name?: string; scopes?: string[] }

    const { rawKey, keyHash, keyPrefix } = generateApiKey()

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        user_id: user.id,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        name: name || 'Default',
        scopes: scopes || [
          'tasks:read', 'tasks:write',
          'projects:read', 'projects:write',
          'notes:read', 'notes:write',
          'spaces:read', 'habits:read',
          'ai:scheduling', 'ai:chat',
          'calendar:read',
        ],
      })
      .select('id, key_prefix, name, scopes, is_active, created_at')
      .single()

    if (error) {
      return apiError('INSERT_ERROR', error.message, 500)
    }

    // Return the raw key only on creation (never stored/returned again)
    return apiSuccess({ ...data, raw_key: rawKey }, 201)
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }
}

// GET /api/v1/api-keys — List all API keys (Cookie auth)
export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return apiError('UNAUTHORIZED', 'Unauthorized', 401)
  }

  const { data, error } = await supabase
    .from('api_keys')
    .select('id, key_prefix, name, scopes, is_active, last_used_at, expires_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return apiError('QUERY_ERROR', error.message, 500)
  }

  return apiSuccess(data)
}

// DELETE /api/v1/api-keys — Deactivate an API key (Cookie auth)
export async function DELETE(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return apiError('UNAUTHORIZED', 'Unauthorized', 401)
  }

  try {
    const body = await request.json()
    const { id } = body as { id: string }

    if (!id) {
      return apiError('VALIDATION_ERROR', 'id is required', 400)
    }

    const { error } = await supabase
      .from('api_keys')
      .update({ is_active: false })
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      return apiError('UPDATE_ERROR', error.message, 500)
    }

    return apiSuccess({ id, is_active: false })
  } catch {
    return apiError('INVALID_BODY', 'Invalid request body', 400)
  }
}
