export type AiHistoryProvider = 'codex_app' | string

export type AiHistoryScopeFilter = 'project' | 'global'

export type AiHistoryStatus =
  | 'running'
  | 'awaiting_approval'
  | 'needs_input'
  | 'completed'
  | 'failed'
  | 'idle'

export type AiHistoryPlacement = 'unplaced' | 'mindmap'

export type AiHistoryRepoFilter = 'all' | string

export type AiHistoryDetailMessageRole = 'user' | 'assistant' | 'system'

export type AiHistoryDetailMessageKind =
  | 'user_prompt'
  | 'assistant_answer'
  | 'assistant_question'
  | 'status'
  | 'summary'

export type AiHistoryListItem = {
  id: string
  provider: AiHistoryProvider
  externalThreadId: string
  title: string
  snippet: string | null
  repoPath: string
  repoLabel: string
  worktreePath: string | null
  placement: AiHistoryPlacement
  sourceTaskId: string | null
  linkedAiTaskId: string | null
  status: AiHistoryStatus
  runState: string | null
  lastActivityAt: string
  indexedAt: string
  startedAt: string | null
  endedAt: string | null
  workDurationSeconds: number | null
  archived: boolean
  detailHydrated: boolean
  detailSyncedAt: string | null
  codexOpenUrl: string | null
}

export type AiHistoryListResponse = {
  items: AiHistoryListItem[]
  counts: {
    unplaced: number
    mindmap: number
  }
  nextCursor: string | null
  sync: {
    featureEnabled: boolean
    aiOnline: boolean
    agentConnected: boolean
    selectedRepo: AiHistoryRepoFilter
    selectedScope: AiHistoryScopeFilter
    selectedProvider: AiHistoryProvider
    providerOptions: Array<{
      provider: AiHistoryProvider
      label: string
      enabled: boolean
      agentSeen: boolean
    }>
    repoOptions: Array<{
      repoPath: string
      label: string
      enabled: boolean
      agentSeen: boolean
    }>
    lastIndexedAt: string | null
    lastReconciledAt: string | null
    nextReconcileAt: string | null
  }
  page: {
    limit: number
    cursor: string | null
  }
}

export type AiHistorySnapshotResponse = {
  source: string
  serverTime: string
  cursor: string | null
  items: AiHistoryListItem[]
  hasMore: boolean
  includeDeleted: boolean
}

export type AiHistoryBatchUpsertItem = {
  provider?: AiHistoryProvider | null
  externalThreadId?: string | null
  external_thread_id?: string | null
  repoPath?: string | null
  repo_path?: string | null
  worktreePath?: string | null
  worktree_path?: string | null
  projectId?: string | null
  project_id?: string | null
  sourceTaskId?: string | null
  source_task_id?: string | null
  linkedAiTaskId?: string | null
  linked_ai_task_id?: string | null
  title?: string | null
  snippet?: string | null
  status?: AiHistoryStatus | null
  runState?: string | null
  run_state?: string | null
  lastActivityAt?: string | null
  last_activity_at?: string | null
  startedAt?: string | null
  started_at?: string | null
  endedAt?: string | null
  ended_at?: string | null
  workDurationSeconds?: number | null
  work_duration_seconds?: number | null
  archived?: boolean | null
  archivedAt?: string | null
  archived_at?: string | null
  deletedAt?: string | null
  deleted_at?: string | null
  detailSyncedAt?: string | null
  detail_synced_at?: string | null
  detailMessageCount?: number | null
  detail_message_count?: number | null
  metadata?: Record<string, unknown> | null
  metadataJson?: Record<string, unknown> | null
  metadata_json?: Record<string, unknown> | null
}

export type AiHistoryBatchUpsertScope = {
  projectId?: string | null
  project_id?: string | null
  provider?: AiHistoryProvider | null
  repoPath?: string | null
  repo_path?: string | null
  displayName?: string | null
  display_name?: string | null
  syncEnabled?: boolean | null
  sync_enabled?: boolean | null
  lastScannedAt?: string | null
  last_scanned_at?: string | null
  lastReconciledAt?: string | null
  last_reconciled_at?: string | null
  settings?: Record<string, unknown> | null
  settingsJson?: Record<string, unknown> | null
  settings_json?: Record<string, unknown> | null
}

export type AiHistoryBatchUpsertRequest = {
  runner_id?: string | null
  provider?: AiHistoryProvider | null
  project_id?: string | null
  repo_path?: string | null
  items?: AiHistoryBatchUpsertItem[]
  scopes?: AiHistoryBatchUpsertScope[]
}

export type AiHistoryBatchUpsertResponseItem = {
  index: number
  historyItemId: string
  id: string
  provider: AiHistoryProvider
  externalThreadId: string
  repoPath: string
  projectId: string | null
  sourceTaskId: string | null
  linkedAiTaskId: string | null
}

export type AiHistoryDetailUpsertMessage = {
  sequence?: number | string | null
  role?: AiHistoryDetailMessageRole | null
  kind?: AiHistoryDetailMessageKind | null
  body?: string | null
  bodyHash?: string | null
  body_hash?: string | null
  occurredAt?: string | null
  occurred_at?: string | null
  metadata?: Record<string, unknown> | null
  metadataJson?: Record<string, unknown> | null
  metadata_json?: Record<string, unknown> | null
}

export type AiHistoryDetailActivityMessage = {
  id: string
  history_item_id: string
  task_id: string
  user_id: string
  provider: AiHistoryProvider
  external_thread_id: string
  repo_path: string
  sequence: number
  role: 'user' | 'codex' | 'status'
  detail_role: AiHistoryDetailMessageRole
  kind: 'sent' | 'progress' | 'question' | 'approval' | 'completed'
  detail_kind: AiHistoryDetailMessageKind
  body: string
  body_hash: string
  importance: 'normal' | 'important'
  metadata: Record<string, unknown>
  occurred_at: string | null
  created_at: string
}

export type AiHistoryDetailUpsertRequest = {
  runner_id?: string | null
  detail_synced_at?: string | null
  messages?: AiHistoryDetailUpsertMessage[]
}

export type AiHistoryDetailHydrateRequestReason =
  | 'detail_cache_empty'
  | 'detail_cache_unsynced'
  | 'detail_cache_stale'

export type AiHistoryDetailHydrateRequestItem = {
  id: string
  historyItemId: string
  provider: AiHistoryProvider
  externalThreadId: string
  repoPath: string
  reason: AiHistoryDetailHydrateRequestReason
  requestedAt: string
  expiresAt: string
  detailSyncedAt: string | null
  detailMessageCount: number | null
  lastActivityAt: string
}
