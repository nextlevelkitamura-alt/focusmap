import { NextRequest, NextResponse } from 'next/server'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { isTursoConfigured } from '@/lib/turso/client'
import { listRunnerHeartbeats } from '@/lib/turso/codex-monitoring'
import {
  AI_HISTORY_STATUSES,
  listProjectRepoScopes,
  type TursoProjectRepoScope,
} from '@/lib/turso/ai-history'
import { createClient } from '@/utils/supabase/server'
import type { AiHistoryPlacement, AiHistoryProvider, AiHistoryScopeFilter, AiHistoryStatus } from '@/types/ai-history'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function compactString(value: unknown, max = 500) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

export function parseLimit(value: string | null, defaultValue: number, max: number) {
  const parsed = Number.parseInt(value || String(defaultValue), 10)
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : defaultValue, 1), max)
}

export function parsePlacement(value: string | null): AiHistoryPlacement | 'all' | null {
  if (!value || value === 'unplaced') return 'unplaced'
  if (value === 'mindmap' || value === 'all') return value
  return null
}

export function parseStatus(value: string | null): AiHistoryStatus | 'all' | null {
  if (!value || value === 'all') return 'all'
  return AI_HISTORY_STATUSES.has(value as AiHistoryStatus) ? value as AiHistoryStatus : null
}

export function maxIso(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}

function normalizeRepoPath(value: string | null | undefined) {
  return value?.trim().replace(/\/+$/u, '') || null
}

function repoLabel(repoPath: string) {
  return repoPath.replace(/\/+$/u, '').split('/').filter(Boolean).at(-1) || repoPath
}

async function loadProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, repo_path, codex_thread_import_enabled, codex_thread_import_enabled_since')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data as null | {
    id: string
    repo_path: string | null
    codex_thread_import_enabled?: boolean | null
    codex_thread_import_enabled_since?: string | null
  }
}

function metadataRepoPaths(metadata: Record<string, unknown>) {
  const paths = new Set<string>()
  const importMeta = isRecord(metadata.codex_thread_import) ? metadata.codex_thread_import : {}
  const scopes = Array.isArray(importMeta.scopes) ? importMeta.scopes : []
  for (const value of scopes) {
    if (!isRecord(value)) continue
    const repoPath = normalizeRepoPath(compactString(value.repo_path, 1000))
    if (repoPath) paths.add(repoPath)
    const cwdPaths = Array.isArray(value.cwd_paths) ? value.cwd_paths : []
    for (const cwd of cwdPaths) {
      const cwdPath = normalizeRepoPath(compactString(cwd, 1000))
      if (cwdPath) paths.add(cwdPath)
    }
  }
  const legacyRepoPaths = Array.isArray(metadata.codex_import_scope_repo_paths)
    ? metadata.codex_import_scope_repo_paths
    : []
  for (const value of legacyRepoPaths) {
    const repoPath = normalizeRepoPath(compactString(value, 1000))
    if (repoPath) paths.add(repoPath)
  }
  return paths
}

function heartbeatFresh(heartbeat: Record<string, unknown>, nowMs = Date.now()) {
  const seenAt = compactString(heartbeat.last_seen_at, 80) ?? compactString(heartbeat.updated_at, 80)
  const seenMs = seenAt ? Date.parse(seenAt) : Number.NaN
  const status = compactString(heartbeat.status, 40)
  return Number.isFinite(seenMs) && nowMs - seenMs <= 90_000 && status !== 'offline'
}

export async function authenticateAiHistoryRequest(request: NextRequest) {
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(request, supabase)
  if (!auth) return null
  return { supabase, user: auth.user }
}

export async function loadAiHistoryProjectContext(input: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  projectId: string
}) {
  const project = await loadProject(input.supabase, input.userId, input.projectId)
  if (!project) return null

  let scopes: TursoProjectRepoScope[] = []
  if (isTursoConfigured()) {
    try {
      scopes = await listProjectRepoScopes({ userId: input.userId, projectId: input.projectId })
    } catch (error) {
      console.error('[ai-history project scopes]', error)
    }
  }

  const scopeByRepo = new Map<string, TursoProjectRepoScope>()
  for (const scope of scopes) {
    const repoPath = normalizeRepoPath(scope.repo_path)
    if (repoPath && !scopeByRepo.has(repoPath)) scopeByRepo.set(repoPath, { ...scope, repo_path: repoPath })
  }

  const projectRepoPath = normalizeRepoPath(project.repo_path)
  if (projectRepoPath && !scopeByRepo.has(projectRepoPath)) {
    scopeByRepo.set(projectRepoPath, {
      id: `project:${project.id}:${projectRepoPath}`,
      user_id: input.userId,
      project_id: project.id,
      provider: 'codex_app',
      repo_path: projectRepoPath,
      display_name: repoLabel(projectRepoPath),
      sync_enabled: project.codex_thread_import_enabled !== false,
      last_scanned_at: null,
      last_reconciled_at: null,
      settings_json: project.codex_thread_import_enabled_since
        ? { codex_thread_import_enabled_since: project.codex_thread_import_enabled_since }
        : null,
      created_at: project.codex_thread_import_enabled_since ?? new Date().toISOString(),
      updated_at: project.codex_thread_import_enabled_since ?? new Date().toISOString(),
    })
  }

  const repoScopes = Array.from(scopeByRepo.values())
  return {
    project,
    scopes: repoScopes,
    repoPaths: repoScopes.map(scope => scope.repo_path),
    scopeLabels: new Map(repoScopes.map(scope => [scope.repo_path, scope.display_name])),
  }
}

export async function buildAiHistorySyncState(input: {
  userId: string
  selectedRepo: 'all' | string
  selectedScope: AiHistoryScopeFilter
  selectedProvider: AiHistoryProvider
  scopes: TursoProjectRepoScope[]
  lastIndexedAt: string | null
}) {
  let heartbeats: Array<Record<string, unknown>> = []
  if (isTursoConfigured()) {
    try {
      heartbeats = await listRunnerHeartbeats(input.userId, 10) as unknown as Array<Record<string, unknown>>
    } catch (error) {
      console.error('[ai-history runner heartbeats]', error)
    }
  }

  const freshHeartbeats = heartbeats.filter(heartbeat => heartbeatFresh(heartbeat))
  const agentSeenRepos = new Set<string>()
  const nextReconcileValues: Array<string | null> = []
  for (const heartbeat of freshHeartbeats) {
    const metadata = isRecord(heartbeat.metadata_json) ? heartbeat.metadata_json : {}
    for (const repoPath of metadataRepoPaths(metadata)) agentSeenRepos.add(repoPath)
    const importMeta = isRecord(metadata.codex_thread_import) ? metadata.codex_thread_import : {}
    nextReconcileValues.push(compactString(importMeta.next_reconcile_at, 80))
  }

  const repoOptions = input.scopes.map(scope => ({
    repoPath: scope.repo_path,
    label: scope.display_name || repoLabel(scope.repo_path),
    enabled: scope.sync_enabled,
    agentSeen: agentSeenRepos.has(scope.repo_path),
  }))
  const providerOptions = [
    {
      provider: 'codex_app',
      label: 'Codex',
      enabled: true,
      agentSeen: freshHeartbeats.length > 0,
    },
    {
      provider: 'claude_code',
      label: 'Claude Code',
      enabled: false,
      agentSeen: false,
    },
    {
      provider: 'antigravity',
      label: 'Antigravity',
      enabled: false,
      agentSeen: false,
    },
  ]
  const featureEnabled = repoOptions.some(option => option.enabled)
  const agentConnected = freshHeartbeats.length > 0

  return {
    featureEnabled,
    aiOnline: featureEnabled && agentConnected,
    agentConnected,
    selectedRepo: input.selectedRepo,
    selectedScope: input.selectedScope,
    selectedProvider: input.selectedProvider,
    providerOptions,
    repoOptions,
    lastIndexedAt: input.lastIndexedAt,
    lastReconciledAt: maxIso(input.scopes.map(scope => scope.last_reconciled_at)),
    nextReconcileAt: maxIso(nextReconcileValues),
  }
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
