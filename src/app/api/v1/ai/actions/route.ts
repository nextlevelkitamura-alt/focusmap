import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { changedMeta, isRecord } from '../../_lib/external-ai'

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
const MAX_BATCH_ACTIONS = 10

function normalizePath(value: unknown) {
  if (typeof value !== 'string') return null
  const path = value.trim()
  if (!path.startsWith('/api/v1/')) return null
  if (path.startsWith('/api/v1/ai/actions')) return null
  if (path.includes('://')) return null
  return path
}

export async function OPTIONS() {
  return handleCors()
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'ai:actions')
  if (isAuthError(auth)) return auth

  const body = await request.json().catch(() => ({}))
  if (!isRecord(body) || !Array.isArray(body.actions)) {
    return apiError('VALIDATION_ERROR', 'actions array is required', 400)
  }

  const authorization = request.headers.get('authorization')
  if (!authorization) return apiError('UNAUTHORIZED', 'Missing Authorization header', 401)

  const actions = body.actions.slice(0, MAX_BATCH_ACTIONS)
  const results = []
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]
    if (!isRecord(action)) {
      results.push({ index, success: false, status: 400, error: { code: 'INVALID_ACTION', message: 'action must be an object' } })
      continue
    }

    const method = typeof action.method === 'string' ? action.method.toUpperCase() : 'POST'
    const path = normalizePath(action.path)
    if (!ALLOWED_METHODS.has(method) || !path) {
      results.push({ index, success: false, status: 400, error: { code: 'INVALID_ACTION', message: 'method/path is invalid' } })
      continue
    }

    const idempotencyKey = typeof action.idempotency_key === 'string'
      ? action.idempotency_key
      : typeof action.idempotencyKey === 'string'
        ? action.idempotencyKey
        : request.headers.get('X-Focusmap-Idempotency-Key')
    const headers = new Headers({
      authorization,
      accept: 'application/json',
    })
    if (method !== 'GET' && method !== 'DELETE') headers.set('content-type', 'application/json')
    if (idempotencyKey) headers.set('X-Focusmap-Idempotency-Key', `${idempotencyKey}:${index}`)

    try {
      const response = await fetch(new URL(path, request.nextUrl.origin), {
        method,
        headers,
        body: method === 'GET' || method === 'DELETE'
          ? undefined
          : JSON.stringify(action.body ?? action.input ?? {}),
      })
      const payload = await response.json().catch(() => null)
      results.push({
        index,
        method,
        path,
        status: response.status,
        success: response.ok,
        response: payload,
      })
      if (!response.ok && body.stop_on_error !== false && body.stopOnError !== false) break
    } catch (error) {
      results.push({
        index,
        method,
        path,
        status: 500,
        success: false,
        error: {
          code: 'ACTION_REQUEST_FAILED',
          message: error instanceof Error ? error.message : String(error),
        },
      })
      if (body.stop_on_error !== false && body.stopOnError !== false) break
    }
  }

  return apiSuccess({
    results,
    completed: results.length,
    requested: body.actions.length,
  }, 200, changedMeta(['api_v1_batch']))
}
