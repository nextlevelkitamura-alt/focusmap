import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { getAiHistoryItemForUser } from '@/lib/turso/ai-history'
import { authenticateAiHistoryRequest, unauthorized } from '../../_shared'

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

    if (item.linked_ai_task_id) {
      const target = new URL(`/api/ai-tasks/${encodeURIComponent(item.linked_ai_task_id)}/activity`, request.url)
      for (const [key, value] of request.nextUrl.searchParams.entries()) {
        target.searchParams.set(key, value)
      }
      return NextResponse.redirect(target, 307)
    }

    return NextResponse.json({
      source: 'hydrate_required',
      messages: [],
      has_more: false,
      next_cursor: null,
      hydrate: {
        required: true,
        reason: 'linked_ai_task_missing',
        historyItemId: item.id,
        provider: item.provider,
        externalThreadId: item.external_thread_id,
        repoPath: item.repo_path,
      },
    }, { status: 202 })
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json({ error: 'Turso is not configured', code: 'turso_not_configured' }, { status: 503 })
    }
    console.error('[ai-history activity GET]', error)
    return NextResponse.json({ error: 'AI history activity fetch failed' }, { status: 500 })
  }
}
