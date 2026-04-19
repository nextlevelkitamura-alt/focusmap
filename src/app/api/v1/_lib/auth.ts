import { NextRequest } from 'next/server'
import { hashApiKey } from '@/lib/api-key'
import { createServiceClient } from '@/utils/supabase/service'
import { checkRateLimit } from './rate-limit'
import { apiError } from './response'

export interface ApiAuthResult {
  userId: string
  keyHash: string
  scopes: string[]
}

/**
 * Authenticate a request using Bearer token (API key).
 * Returns the user_id and scopes, or an error response.
 *
 * requiredScope: 1つの scope 文字列、または「any-of」判定用の配列を渡せる。
 *   配列の場合、1つでも含まれていれば OK（後方互換用途に便利）。
 */
export async function authenticateApiKey(
  request: NextRequest,
  requiredScope?: string | string[],
): Promise<ApiAuthResult | Response> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return apiError('UNAUTHORIZED', 'Missing or invalid Authorization header', 401)
  }

  const rawKey = authHeader.slice(7)
  if (!rawKey.startsWith('sk_shikumika_')) {
    return apiError('UNAUTHORIZED', 'Invalid API key format', 401)
  }

  const keyHash = hashApiKey(rawKey)

  // Rate limit check
  const rateLimit = checkRateLimit(keyHash)
  if (!rateLimit.allowed) {
    return apiError('RATE_LIMITED', 'Too many requests. Please wait and try again.', 429)
  }

  // Lookup key in database using service role (bypasses RLS)
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  const { data: apiKey, error } = await serviceClient
    .from('api_keys')
    .select('user_id, scopes, is_active, expires_at')
    .eq('key_hash', keyHash)
    .single()

  if (error || !apiKey) {
    return apiError('UNAUTHORIZED', 'Invalid API key', 401)
  }

  if (!apiKey.is_active) {
    return apiError('UNAUTHORIZED', 'API key has been deactivated', 401)
  }

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return apiError('UNAUTHORIZED', 'API key has expired', 401)
  }

  // Scope check (単一 or any-of 配列)
  if (requiredScope) {
    const required = Array.isArray(requiredScope) ? requiredScope : [requiredScope]
    const hasAny = required.some(s => apiKey.scopes.includes(s))
    if (!hasAny) {
      return apiError('FORBIDDEN', `Missing required scope: ${required.join(' or ')}`, 403)
    }
  }

  // Update last_used_at (fire-and-forget)
  serviceClient
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key_hash', keyHash)
    .then()

  return {
    userId: apiKey.user_id,
    keyHash,
    scopes: apiKey.scopes,
  }
}

/**
 * Type guard to check if auth result is an error response.
 */
export function isAuthError(result: ApiAuthResult | Response): result is Response {
  return result instanceof Response
}
