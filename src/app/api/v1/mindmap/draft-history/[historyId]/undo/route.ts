import { NextRequest } from 'next/server'
import { authenticateApiKey, isAuthError } from '../../../../_lib/auth'
import { apiSuccess, apiError, handleCors } from '../../../../_lib/response'
import { createServiceClient } from '@/utils/supabase/service'
import { undoMindmapDraftHistory } from '@/lib/mindmap-draft-service'
import { changedMeta } from '../../../../_lib/external-ai'

export async function OPTIONS() {
  return handleCors()
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ historyId: string }> },
) {
  const auth = await authenticateApiKey(request, 'mindmap:write')
  if (isAuthError(auth)) return auth

  const { historyId } = await params
  let serviceClient
  try {
    serviceClient = createServiceClient()
  } catch {
    return apiError('SERVER_ERROR', 'Service configuration error', 500)
  }

  try {
    const result = await undoMindmapDraftHistory({ supabase: serviceClient, userId: auth.userId, historyId })
    return apiSuccess(result, 200, changedMeta(['tasks', 'mindmap_draft_history', 'memo_node_links']))
  } catch (error) {
    return apiError('UPDATE_ERROR', error instanceof Error ? error.message : String(error), 500)
  }
}
