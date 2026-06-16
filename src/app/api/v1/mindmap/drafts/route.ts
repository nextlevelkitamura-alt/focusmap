import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import {
  fetchActiveMindmapDraft,
  replaceActiveMindmapDraft,
  type SaveMindmapDraftNodeInput,
} from '@/lib/mindmap-draft-service'
import {
  arrayField,
  changedMeta,
  idempotencyKey,
  isRecord,
  jsonValue,
  numberField,
  stringField,
} from '../../_lib/external-ai'

function normalizeDraftNode(value: unknown): SaveMindmapDraftNodeInput | null {
  if (!isRecord(value)) return null
  const title = stringField(value, 'title')
  if (!title) return null
  return {
    draftNodeId: stringField(value, 'draftNodeId', 'draft_node_id'),
    taskId: stringField(value, 'taskId', 'task_id'),
    parentDraftNodeId: stringField(value, 'parentDraftNodeId', 'parent_draft_node_id'),
    parentTaskId: stringField(value, 'parentTaskId', 'parent_task_id'),
    title,
    originalTitle: stringField(value, 'originalTitle', 'original_title'),
    isGroup: typeof value.isGroup === 'boolean'
      ? value.isGroup
      : typeof value.is_group === 'boolean'
        ? value.is_group
        : undefined,
    orderIndex: numberField(value, 'orderIndex', 'order_index') ?? null,
    changeType: stringField(value, 'changeType', 'change_type') as SaveMindmapDraftNodeInput['changeType'],
    origin: value.origin === 'user' ? 'user' : 'ai',
    sourceLinks: jsonValue(value.sourceLinks ?? value.source_links ?? []),
    metadata: jsonValue(value.metadata ?? {}),
  }
}

export async function OPTIONS() {
  return handleCors()
}

export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request, ['mindmap:read', 'mindmap:drafts'])
  if (isAuthError(auth)) return auth

  const projectId = request.nextUrl.searchParams.get('project_id')
  if (!projectId) return apiError('VALIDATION_ERROR', 'project_id is required', 400)

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const draft = await fetchActiveMindmapDraft(serviceClient, auth.userId, projectId)
    return apiSuccess({ draft })
  } catch (error) {
    return apiError('QUERY_ERROR', error instanceof Error ? error.message : String(error), 500)
  }
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiKey(request, 'mindmap:drafts')
  if (isAuthError(auth)) return auth

  const body = await request.json().catch(() => ({}))
  if (!isRecord(body)) return apiError('INVALID_BODY', 'Invalid request body', 400)
  const projectId = stringField(body, 'project_id', 'projectId')
  if (!projectId) return apiError('VALIDATION_ERROR', 'project_id is required', 400)

  const nodes = arrayField(body, 'nodes')
    .map(normalizeDraftNode)
    .filter((node): node is SaveMindmapDraftNodeInput => !!node)
  if (nodes.length === 0) {
    return apiError('VALIDATION_ERROR', 'nodes must include at least one node with title', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const draft = await replaceActiveMindmapDraft({
      supabase: serviceClient,
      userId: auth.userId,
      projectId,
      chatSessionId: stringField(body, 'chat_session_id', 'chatSessionId'),
      scope: jsonValue({
        ...(isRecord(body.scope) ? body.scope : {}),
        external_api: {
          source: 'api_v1',
          idempotency_key: idempotencyKey(request.headers),
        },
      }),
      summary: body.summary === undefined ? undefined : jsonValue(body.summary),
      nodes,
      createdBy: body.created_by === 'user' || body.createdBy === 'user' ? 'user' : 'ai',
    })
    return apiSuccess({
      draft_id: draft.draft.id,
      draft,
      preview: {
        status: 'active',
        message: 'Focusmapのマインドマップ上にAI案として表示されます。確定前にユーザーが確認できます。',
      },
    }, 201, changedMeta(['mindmap_drafts', 'mindmap_draft_nodes']))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return apiError(message === 'project not found' ? 'NOT_FOUND' : 'INSERT_ERROR', message, message === 'project not found' ? 404 : 500)
  }
}
