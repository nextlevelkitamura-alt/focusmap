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
  parseLimit,
  unauthorized,
} from '../_shared'
import type {
  AiHistoryProvider,
  AiHistoryRepoFilter,
  AiHistoryScopeFilter,
  AiHistorySnapshotResponse,
} from '@/types/ai-history'

type SnapshotFilter = AiHistorySnapshotResponse['filter']
type SupabaseClient = NonNullable<Awaited<ReturnType<typeof authenticateAiHistoryRequest>>>['supabase']

const SNAPSHOT_POLICY: AiHistorySnapshotResponse['policy'] = {
  metadataOnly: true,
  countsIncluded: false,
  reconcileIncluded: false,
  detailHydrateRequestsCreated: false,
  rawBodiesIncluded: false,
  cursor: 'indexed_at|id',
}

function emptySnapshot(input: {
  cursor: string | null
  changedSince: string | null
  includeDeleted: boolean
  filter: SnapshotFilter
}): AiHistorySnapshotResponse {
  return {
    source: 'turso_not_configured',
    serverTime: new Date().toISOString(),
    cursor: input.cursor,
    changedSince: input.changedSince,
    items: [],
    hasMore: false,
    includeDeleted: input.includeDeleted,
    filter: input.filter,
    policy: SNAPSHOT_POLICY,
  }
}

function normalizeRepoPath(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/u, '') || null
}

function repoLabel(repoPath: string) {
  return repoPath.replace(/\/+$/u, '').split('/').filter(Boolean).at(-1) || repoPath
}

async function loadSnapshotProjectContext(input: {
  supabase: SupabaseClient
  userId: string
  projectId: string
}) {
  const { data, error } = await input.supabase
    .from('projects')
    .select('id, repo_path')
    .eq('id', input.projectId)
    .eq('user_id', input.userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const repoPath = normalizeRepoPath((data as { repo_path?: string | null }).repo_path)
  return {
    repoPaths: repoPath ? [repoPath] : [],
    scopeLabels: repoPath
      ? new Map<string, string | null>([[repoPath, repoLabel(repoPath)]])
      : new Map<string, string | null>(),
  }
}

export async function GET(request: NextRequest) {
  const auth = await authenticateAiHistoryRequest(request)
  if (!auth) return unauthorized()

  const { searchParams } = request.nextUrl
  const projectId = searchParams.get('project_id')?.trim()
  if (!projectId) return NextResponse.json({ error: 'project_id is required' }, { status: 400 })
  const repo = searchParams.get('repo')?.trim() || 'all'
  const selectedRepo: AiHistoryRepoFilter = repo === 'all' ? 'all' : repo
  const selectedScope: AiHistoryScopeFilter = searchParams.get('scope') === 'global' ? 'global' : 'project'
  const selectedProvider = (searchParams.get('provider')?.trim() || 'codex_app') as AiHistoryProvider
  const cursorParam = searchParams.get('cursor')
  const cursor = parseAiHistoryCursor(cursorParam)
  const changedSince = cursor?.indexedAt ?? null
  const limit = parseLimit(searchParams.get('limit'), 500, 500)
  const includeDeleted = searchParams.get('include_deleted') === 'true'
  const filter: SnapshotFilter = {
    projectId,
    repo: selectedRepo,
    scope: selectedScope,
    provider: selectedProvider,
  }

  const context = await loadSnapshotProjectContext({
    supabase: auth.supabase,
    userId: auth.user.id,
    projectId,
  })
  if (!context) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  if (!isTursoConfigured()) {
    return NextResponse.json(emptySnapshot({ cursor: cursorParam, changedSince, includeDeleted, filter }))
  }

  try {
    const items = await listAiHistorySnapshot({
      userId: auth.user.id,
      projectId,
      scope: selectedScope,
      provider: selectedProvider,
      repo: selectedRepo,
      repoPaths: selectedScope === 'global' ? [] : context.repoPaths,
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
      changedSince,
      items: items.map(item => toAiHistoryListItem(item, context.scopeLabels)),
      hasMore: items.length >= limit,
      includeDeleted,
      filter,
      policy: SNAPSHOT_POLICY,
    } satisfies AiHistorySnapshotResponse)
  } catch (error) {
    if (error instanceof TursoConfigurationError) {
      return NextResponse.json(emptySnapshot({ cursor: cursorParam, changedSince, includeDeleted, filter }))
    }
    console.error('[ai-history/snapshot GET]', error)
    return NextResponse.json({ error: 'AI history snapshot fetch failed' }, { status: 500 })
  }
}
