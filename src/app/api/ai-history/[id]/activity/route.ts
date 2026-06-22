import { NextRequest, NextResponse } from 'next/server'
import { codexReportViewMessages } from '@/lib/codex-report-view'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  aiHistoryDetailHydrateReason,
  countAiHistoryDetailMessages,
  getAiHistoryItemForUser,
  isAiHistoryDetailHydrateRequired,
  listAiHistoryDetailMessages,
  toAiHistoryDetailActivityMessage,
  upsertAiHistoryDetailHydrateRequest,
} from '@/lib/turso/ai-history'
import { authenticateAiHistoryRequest, parseLimit, unauthorized } from '../../_shared'

function parseBefore(req: NextRequest) {
  const rawSequence = req.nextUrl.searchParams.get('before_sequence')?.trim()
  if (rawSequence) {
    const sequence = Number(rawSequence)
    if (Number.isInteger(sequence) && sequence >= 0) {
      return {
        sequence,
        id: req.nextUrl.searchParams.get('before_id')?.trim() || null,
      }
    }
  }

  const createdAt = req.nextUrl.searchParams.get('before_created_at')?.trim()
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null
  return {
    createdAt: new Date(createdAt).toISOString(),
    id: req.nextUrl.searchParams.get('before_id')?.trim() || null,
  }
}

async function recordHydrateRequest(input: {
  userId: string
  item: Awaited<ReturnType<typeof getAiHistoryItemForUser>>
  reason: ReturnType<typeof aiHistoryDetailHydrateReason>
}) {
  if (!input.item || !input.reason) return
  try {
    await upsertAiHistoryDetailHydrateRequest({
      userId: input.userId,
      item: input.item,
      reason: input.reason,
      requestedBy: 'web',
      ttlSeconds: 120,
    })
  } catch (error) {
    console.error('[ai-history activity hydrate request]', error)
  }
}

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

    const limit = parseLimit(request.nextUrl.searchParams.get('limit'), 100, 200)
    const before = parseBefore(request)
    const reportMode = request.nextUrl.searchParams.get('mode') === 'report'
    const [messagesPage, totalMessageCount] = await Promise.all([
      listAiHistoryDetailMessages({
        userId: auth.user.id,
        historyItemId: item.id,
        limit,
        before,
      }),
      countAiHistoryDetailMessages({
        userId: auth.user.id,
        historyItemId: item.id,
      }),
    ])
    const activityMessages = messagesPage.map(toAiHistoryDetailActivityMessage)
    const messages = reportMode ? codexReportViewMessages(activityMessages) : activityMessages
    const oldest = messagesPage[0]
    const hasMore = Boolean(oldest && messagesPage.length >= limit)
    const hydrateRequired = isAiHistoryDetailHydrateRequired(item, totalMessageCount)
    const hydrateReason = aiHistoryDetailHydrateReason(item, totalMessageCount)
    const watchRequested = request.nextUrl.searchParams.get('watch') === '1'
    if (hydrateRequired || watchRequested) {
      await recordHydrateRequest({
        userId: auth.user.id,
        item,
        reason: hydrateReason ?? 'detail_cache_stale',
      })
    }

    if (messagesPage.length > 0) {
      return NextResponse.json({
        source: 'ai_history_detail_cache',
        messages,
        has_more: hasMore,
        next_cursor: hasMore && oldest
          ? {
              created_at: oldest.created_at,
              id: oldest.id,
              sequence: oldest.sequence,
            }
          : null,
        hydrate: {
          required: hydrateRequired,
          reason: hydrateReason,
          historyItemId: item.id,
          provider: item.provider,
          externalThreadId: item.external_thread_id,
          repoPath: item.repo_path,
          detailSyncedAt: item.detail_synced_at,
          messageCount: totalMessageCount,
        },
      })
    }

    return NextResponse.json({
      source: 'hydrate_required',
      messages: [],
      has_more: false,
      next_cursor: null,
      hydrate: {
        required: true,
        reason: hydrateReason ?? 'detail_cache_empty',
        historyItemId: item.id,
        provider: item.provider,
        externalThreadId: item.external_thread_id,
        repoPath: item.repo_path,
        detailSyncedAt: item.detail_synced_at,
        messageCount: totalMessageCount,
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
