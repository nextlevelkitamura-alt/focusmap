import { NextRequest, NextResponse } from 'next/server'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import {
  encodeAiHistoryCursor,
  listAiHistorySnapshot,
  parseAiHistoryCursor,
  toAiHistoryListItem,
} from '@/lib/turso/ai-history'
import {
  authenticateAiHistoryRequest,
  loadAiHistoryProjectContext,
  parseLimit,
  unauthorized,
} from '../_shared'
import type { AiHistorySnapshotResponse } from '@/types/ai-history'

function emptySnapshot(input: { cursor: string | null; includeDeleted: boolean }): AiHistorySnapshotResponse {
  return {
    source: 'turso_not_configured',
    serverTime: new Date().toISOString(),
    cursor: input.cursor,
    items: [],
    hasMore: false,
    includeDeleted: input.includeDeleted,
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
  const cursorParam = searchParams.get('cursor')
  const cursor = parseAiHistoryCursor(cursorParam)
  const limit = parseLimit(searchParams.get('limit'), 500, 500)
  const includeDeleted = searchParams.get('include_deleted') === 'true'

  const context = await loadAiHistoryProjectContext({
    supabase: auth.supabase,
    userId: auth.user.id,
    projectId,
  })
  if (!context) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!isTursoConfigured()) {
    return NextResponse.json(emptySnapshot({ cursor: cursorParam, includeDeleted }))
  }

  try {
    const items = await listAiHistorySnapshot({
      userId: auth.user.id,
      projectId,
      repo: selectedRepo,
      repoPaths: context.repoPaths,
      cursor,
      limit,
      includeDeleted,
    })
    const nextCursor = items.length > 0
      ? encodeAiHistoryCursor(items[items.length - 1]!)
      : cursorParam
    return NextResponse.json({
      source: 'turso',
      serverTime: new Date().toISOString(),
      cursor: nextCursor,
      items: items.map(item => toAiHistoryListItem(item, context.scopeLabels)),
      hasMore: items.length >= limit,
      includeDeleted,
    } satisfies AiHistorySnapshotResponse)
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json(emptySnapshot({ cursor: cursorParam, includeDeleted }))
    }
    console.error('[ai-history/snapshot GET]', error)
    return NextResponse.json({ error: 'AI history snapshot fetch failed' }, { status: 500 })
  }
}
