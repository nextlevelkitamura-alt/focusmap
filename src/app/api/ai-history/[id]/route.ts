import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  aiHistoryDetailHydrateReason,
  getAiHistoryItemForUser,
  isAiHistoryDetailHydrateRequired,
  toAiHistoryListItem,
} from '@/lib/turso/ai-history'
import { authenticateAiHistoryRequest, unauthorized } from '../_shared'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateAiHistoryRequest(request)
  if (!auth) return unauthorized()
  if (!isTursoConfigured()) {
    return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
  }

  const { id } = await params
  try {
    const item = await getAiHistoryItemForUser(id, auth.user.id)
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const responseItem = toAiHistoryListItem(item)
    const hydrateRequired = isAiHistoryDetailHydrateRequired(item)
    return NextResponse.json({
      item: responseItem,
      detail: {
        hydrateRequired,
        hydrateReason: aiHistoryDetailHydrateReason(item),
        detailSyncedAt: item.detail_synced_at,
        messageCount: item.detail_message_count ?? 0,
        linkedAiTaskId: item.linked_ai_task_id,
        activityUrl: item.linked_ai_task_id
          ? `/api/ai-tasks/${encodeURIComponent(item.linked_ai_task_id)}/activity`
          : `/api/ai-history/${encodeURIComponent(item.id)}/activity`,
        policy: item.linked_ai_task_id
          ? 'linked_ai_task_activity'
          : hydrateRequired
            ? 'local_agent_detail_hydrate_required'
            : 'ai_history_detail_cache',
      },
    })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[ai-history detail GET]', error)
    return NextResponse.json({ error: 'AI history detail fetch failed' }, { status: 500 })
  }
}
