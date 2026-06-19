import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  countAiHistoryBuckets,
  encodeAiHistoryCursor,
  latestAiHistoryIndex,
  listAiHistoryItems,
  parseAiHistoryCursor,
  toAiHistoryListItem,
} from '@/lib/turso/ai-history'
import {
  authenticateAiHistoryRequest,
  buildAiHistorySyncState,
  loadAiHistoryProjectContext,
  parseLimit,
  parsePlacement,
  parseStatus,
  unauthorized,
} from './_shared'
import type { AiHistoryListResponse } from '@/types/ai-history'

function emptyResponse(input: {
  selectedRepo: 'all' | string
  limit: number
  cursor: string | null
  sync?: AiHistoryListResponse['sync']
}): AiHistoryListResponse {
  return {
    items: [],
    counts: { unplaced: 0, mindmap: 0 },
    nextCursor: null,
    sync: input.sync ?? {
      featureEnabled: false,
      aiOnline: false,
      agentConnected: false,
      selectedRepo: input.selectedRepo,
      repoOptions: [],
      lastIndexedAt: null,
      lastReconciledAt: null,
      nextReconcileAt: null,
    },
    page: {
      limit: input.limit,
      cursor: input.cursor,
    },
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticateAiHistoryRequest(request)
  if (!auth) return unauthorized()

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get('project_id')?.trim()
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 })

  const repo = searchParams.get('repo')?.trim() || 'all'
  const selectedRepo = repo === 'all' ? 'all' : repo
  const placement = parsePlacement(searchParams.get('placement'))
  if (!placement) return NextResponse.json({ error: 'invalid placement' }, { status: 400 })
  const status = parseStatus(searchParams.get('status'))
  if (!status) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  const limit = parseLimit(searchParams.get('limit'), 50, 200)
  const cursorParam = searchParams.get('cursor')
  const cursor = parseAiHistoryCursor(cursorParam)

  const context = await loadAiHistoryProjectContext({
    supabase: auth.supabase,
    userId: auth.user.id,
    projectId,
  })
  if (!context) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!isTursoConfigured()) {
    const sync = await buildAiHistorySyncState({
      userId: auth.user.id,
      selectedRepo,
      scopes: context.scopes,
      lastIndexedAt: null,
    })
    return NextResponse.json(emptyResponse({ selectedRepo, limit, cursor: cursorParam, sync }))
  }

  try {
    const [items, counts, lastIndexedAt] = await Promise.all([
      listAiHistoryItems({
        userId: auth.user.id,
        projectId,
        repo: selectedRepo,
        repoPaths: context.repoPaths,
        placement,
        status,
        cursor,
        limit,
      }),
      countAiHistoryBuckets({
        userId: auth.user.id,
        projectId,
        repo: selectedRepo,
        repoPaths: context.repoPaths,
      }),
      latestAiHistoryIndex({
        userId: auth.user.id,
        projectId,
        repo: selectedRepo,
        repoPaths: context.repoPaths,
      }),
    ])
    const sync = await buildAiHistorySyncState({
      userId: auth.user.id,
      selectedRepo,
      scopes: context.scopes,
      lastIndexedAt,
    })
    const nextCursor = items.length >= limit ? encodeAiHistoryCursor(items[items.length - 1]!) : null
    return NextResponse.json({
      items: items.map(item => toAiHistoryListItem(item, context.scopeLabels)),
      counts,
      nextCursor,
      sync,
      page: {
        limit,
        cursor: cursorParam,
      },
    } satisfies AiHistoryListResponse)
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      const sync = await buildAiHistorySyncState({
        userId: auth.user.id,
        selectedRepo,
        scopes: context.scopes,
        lastIndexedAt: null,
      })
      return NextResponse.json(emptyResponse({ selectedRepo, limit, cursor: cursorParam, sync }))
    }
    console.error('[ai-history GET]', error)
    return NextResponse.json({ error: 'AI history fetch failed' }, { status: 500 })
  }
}
