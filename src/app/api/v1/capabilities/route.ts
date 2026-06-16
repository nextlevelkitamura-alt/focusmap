import { apiSuccess, handleCors } from '../_lib/response'
import { API_SCOPE_PRESETS, API_SCOPES } from '@/lib/api-scopes'
import { API_KEY_PREFIX, LEGACY_API_KEY_PREFIX } from '@/lib/api-key'

export async function OPTIONS() {
  return handleCors()
}

export async function GET() {
  return apiSuccess({
    product: 'Focusmap',
    api_version: 'v1',
    auth: {
      type: 'bearer_api_key',
      new_key_prefix: API_KEY_PREFIX,
      legacy_key_prefix: LEGACY_API_KEY_PREFIX,
    },
    scopes: API_SCOPES,
    presets: API_SCOPE_PRESETS,
    recommended_flow: [
      'GET /api/v1/bootstrap',
      'GET /api/v1/projects?limit=20',
      'GET /api/v1/projects/{projectId}/context',
      'GET /api/v1/mindmap/overview?project_id={projectId}',
      'POST /api/v1/mindmap/drafts',
      'ユーザー確認後に POST /api/v1/mindmap/drafts/{draftId}/apply',
      '予定変更が必要な時だけ PATCH /api/v1/calendar/events/{googleEventId}',
    ],
    endpoints: [
      { method: 'GET', path: '/api/v1/bootstrap', scopes: [] },
      { method: 'GET', path: '/api/v1/projects', scopes: ['projects:read'] },
      { method: 'GET', path: '/api/v1/projects/{id}', scopes: ['projects:read'] },
      { method: 'PATCH', path: '/api/v1/projects/{id}', scopes: ['projects:write'] },
      { method: 'GET', path: '/api/v1/projects/{id}/context', scopes: ['project:context:read'] },
      { method: 'PUT', path: '/api/v1/projects/{id}/context', scopes: ['project:context:write'] },
      { method: 'GET', path: '/api/v1/memos', scopes: ['memos:read'] },
      { method: 'POST', path: '/api/v1/memos', scopes: ['memos:write'] },
      { method: 'PATCH', path: '/api/v1/memos/{id}', scopes: ['memos:write'] },
      { method: 'DELETE', path: '/api/v1/memos/{id}', scopes: ['memos:write'] },
      { method: 'GET', path: '/api/v1/mindmap/overview', scopes: ['mindmap:read'] },
      { method: 'GET', path: '/api/v1/mindmap/drafts', scopes: ['mindmap:read'] },
      { method: 'POST', path: '/api/v1/mindmap/drafts', scopes: ['mindmap:drafts'] },
      { method: 'POST', path: '/api/v1/mindmap/drafts/{draftId}/nodes', scopes: ['mindmap:drafts'] },
      { method: 'POST', path: '/api/v1/mindmap/drafts/{draftId}/apply', scopes: ['mindmap:write'] },
      { method: 'POST', path: '/api/v1/mindmap/draft-history/{historyId}/undo', scopes: ['mindmap:write'] },
      { method: 'POST', path: '/api/v1/mindmap/draft-history/{historyId}/redo', scopes: ['mindmap:write'] },
      { method: 'POST', path: '/api/v1/mindmap/nodes', scopes: ['mindmap:write'] },
      { method: 'PATCH', path: '/api/v1/mindmap/nodes/{id}', scopes: ['mindmap:write'] },
      { method: 'DELETE', path: '/api/v1/mindmap/nodes/{id}', scopes: ['mindmap:write'] },
      { method: 'GET', path: '/api/v1/calendar/events', scopes: ['calendar:read'] },
      { method: 'POST', path: '/api/v1/calendar/events', scopes: ['calendar:write'] },
      { method: 'PATCH', path: '/api/v1/calendar/events/{eventId}', scopes: ['calendar:write'] },
      { method: 'DELETE', path: '/api/v1/calendar/events/{eventId}', scopes: ['calendar:write'] },
      { method: 'POST', path: '/api/v1/calendar/events/{eventId}/move', scopes: ['calendar:write'] },
      { method: 'POST', path: '/api/v1/ai/actions', scopes: ['ai:actions'] },
    ],
    draft_first_policy: {
      default: true,
      reason: '大きなマップ整理は本番tasksへ直書きせず、まずAI案として保存してFocusmap上で確認するため。',
    },
  })
}
