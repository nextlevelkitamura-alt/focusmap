import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import {
  upsertMindmapDraftNode,
  type SaveMindmapDraftNodeInput,
} from '@/lib/mindmap-draft-service'
import { changedMeta, isRecord, jsonValue } from '../../../../_lib/external-ai'

export async function OPTIONS() {
  return handleCors()
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const auth = await authenticateApiKey(request, 'mindmap:drafts')
  if (isAuthError(auth)) return auth

  const { draftId } = await params
  const body = await request.json().catch(() => ({}))
  const node = isRecord(body) && isRecord(body.node) ? body.node : body
  if (!isRecord(node) || typeof node.title !== 'string' || !node.title.trim()) {
    return apiError('VALIDATION_ERROR', 'node.title is required', 400)
  }

  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const draft = await upsertMindmapDraftNode({
      supabase: serviceClient,
      userId: auth.userId,
      draftId,
      input: {
        draftNodeId: typeof node.draft_node_id === 'string' ? node.draft_node_id : typeof node.draftNodeId === 'string' ? node.draftNodeId : undefined,
        taskId: typeof node.task_id === 'string' ? node.task_id : typeof node.taskId === 'string' ? node.taskId : undefined,
        parentDraftNodeId: typeof node.parent_draft_node_id === 'string' ? node.parent_draft_node_id : typeof node.parentDraftNodeId === 'string' ? node.parentDraftNodeId : undefined,
        parentTaskId: typeof node.parent_task_id === 'string' ? node.parent_task_id : typeof node.parentTaskId === 'string' ? node.parentTaskId : undefined,
        title: node.title.trim(),
        originalTitle: typeof node.original_title === 'string' ? node.original_title : typeof node.originalTitle === 'string' ? node.originalTitle : undefined,
        isGroup: typeof node.is_group === 'boolean' ? node.is_group : typeof node.isGroup === 'boolean' ? node.isGroup : undefined,
        orderIndex: typeof node.order_index === 'number' ? node.order_index : typeof node.orderIndex === 'number' ? node.orderIndex : undefined,
        changeType: (typeof node.change_type === 'string' ? node.change_type : typeof node.changeType === 'string' ? node.changeType : undefined) as SaveMindmapDraftNodeInput['changeType'],
        origin: node.origin === 'user' ? 'user' : 'ai',
        sourceLinks: jsonValue(node.source_links ?? node.sourceLinks ?? []),
        metadata: jsonValue(node.metadata ?? {}),
      },
    })
    return apiSuccess({ draft }, 200, changedMeta(['mindmap_draft_nodes']))
  } catch (error) {
    return apiError('UPDATE_ERROR', error instanceof Error ? error.message : String(error), 500)
  }
}
