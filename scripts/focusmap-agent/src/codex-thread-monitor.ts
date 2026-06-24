import { execFile, execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, statSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AgentApiError, type AgentApiClient } from './api-client.js';
import type {
  AgentActivityMessage,
  AiHistoryBatchUpsertItem,
  AiHistoryBatchUpsertResponseItem,
  AiHistoryBatchUpsertScope,
  AiHistoryDetailHydrateRequest,
  AiHistoryDetailMessage,
  AiHistoryMonitorTarget,
  AiHistoryStatus,
  AiTask,
  CodexThreadImportScope,
  StepLog,
  TaskResultJson,
} from './types.js';
import { archiveCodexThreadViaAppServer } from './executors/codex-app.js';
import { debug, error as logError, info } from './logger.js';

const execFileAsync = promisify(execFile);
const SQLITE_BIN = '/usr/bin/sqlite3';
const MONITOR_LIMIT = 200;
const MAX_ACTIVITY_MESSAGES_PER_UPDATE = 12;
const MAX_ACTIVITY_BODY_CHARS = 8_000;
const SQLITE_READ_RETRY_DELAYS_MS = [80, 220, 500] as const;
const ROLLOUT_READ_CACHE_LIMIT = 300;
const ROLLOUT_INSPECT_CACHE_LIMIT = 1_000;
const PRE_IMPORT_SYNC_LIMIT = 40;
const POST_IMPORT_SYNC_LIMIT = 20;
const PRE_IMPORT_SYNC_YIELD_EVERY = 25;
const RUNNING_HOT_ORPHAN_IMPORT_LIMIT = 3;
const syncCache = new Map<string, string>();
const rolloutReadCache = new Map<string, { mtimeMs: number; size: number; raw: string }>();
const rolloutSummaryCache = new Map<string, { rawRollout: string; summary: RolloutSummary }>();
export const DEFAULT_TARGET_REFRESH_INTERVAL_MS = 2_000;
export const DEFAULT_RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
export const RESUME_RUNNING_VISIBILITY_MS = 6_000;
export const AWAITING_APPROVAL_STABILITY_MS = 1_000;
export const TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS = 30 * 60 * 1000;
export const CODEX_THREAD_STATUS_RESOLVER_VERSION = '2026-06-25-ai-history-source-task-reconcile-v1';
export const CODEX_ARCHIVE_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const MONITOR_DB_PATH_CACHE_TTL_MS = 30_000;
const ORPHAN_IMPORT_LIMIT = 30;
const ORPHAN_IMPORT_SCAN_LIMIT = 200;
const AI_HISTORY_PROVIDER = 'codex_app';
export const AI_HISTORY_FAST_WATCH_LIMIT = 20;
const AI_HISTORY_HOT_SYNC_LIMIT = AI_HISTORY_FAST_WATCH_LIMIT;
const AI_HISTORY_HOT_SYNC_TOTAL_LIMIT = ORPHAN_IMPORT_SCAN_LIMIT;
const AI_HISTORY_RECONCILE_SCOPE_BATCH_LIMIT = 20;
const AI_HISTORY_BATCH_SIZE = 80;
const AI_HISTORY_RUNNING_DURATION_WRITE_INTERVAL_MS = 60_000;
const AI_HISTORY_RECONCILE_QUEUE_YIELD_MS = 20;
export const AI_HISTORY_SOURCE_TASK_RECONCILE_INTERVAL_MS = 10 * 60 * 1000;
export const AI_HISTORY_DETAIL_HYDRATE_POLL_MS = 5_000;
export const AI_HISTORY_DETAIL_HYDRATE_ACTIVE_POLL_MS = 1_000;
export const AI_HISTORY_DETAIL_HYDRATE_OPEN_BURST_MS = 10_000;
export const CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS = [10_000, 60_000] as const;
export const CODEX_TIMER_ALIGNMENT_RECHECK_MAX_WATCHES = 100;
const AI_HISTORY_DETAIL_HYDRATE_LIMIT = 50;
const AI_HISTORY_DETAIL_HYDRATE_PER_TICK = 5;
const AI_HISTORY_ACTIVE_MONITOR_TARGET_LIMIT = 100;
const AI_HISTORY_DETAIL_WATCH_TTL_MS = 120_000;
const AI_HISTORY_DETAIL_FAST_WATCH_RECHECK_MS = 1_000;
const AI_HISTORY_ARCHIVE_REQUEST_REASON = 'ai_history_archived';
export const AI_HISTORY_PLACEHOLDER_TITLE = '新しいチャット';
const AI_HISTORY_PLACEHOLDER_TITLE_WATCH_TTL_MS = 5 * 60 * 1000;
const MAX_AI_HISTORY_DETAIL_MESSAGES_PER_POST = 50;
export const AI_HISTORY_STALE_RUNNING_GENERAL_MS = TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS;
export const AI_HISTORY_STALE_RUNNING_AUTOMATION_MS = TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS;
const RUNNING_THREAD_ROLLOUT_RECHECK_MS = 1_000;
const ACTIVE_RUNNING_ACTIVITY_WINDOW_MS = 30_000;
const STALE_RUNNING_THREAD_ROLLOUT_RECHECK_MS = 30_000;
const STABLE_TASK_ROLLOUT_RECHECK_MS = 30_000;
const configuredOrphanImportWindowMs = Number(process.env.FOCUSMAP_CODEX_ORPHAN_IMPORT_WINDOW_MS);
const ORPHAN_IMPORT_WINDOW_MS = Number.isFinite(configuredOrphanImportWindowMs) && configuredOrphanImportWindowMs > 0
  ? configuredOrphanImportWindowMs
  : 2 * 60 * 60 * 1000;
const ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS = 5 * 60 * 1000;
const FOCUSMAP_HANDOFF_THREAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROMPT_MATCH_PREFIX_CHARS = 500;
const MIN_PROMPT_MATCH_CHARS = 120;
let orphanImportApiUnavailableUntil = 0;
let importScopesApiUnavailableUntil = 0;
let activeAiHistoryMonitorTargetsApiUnavailableUntil = 0;
let cachedMonitorDbPath: { path: string | null; expiresAt: number } | null = null;
const WORKTREE_PATH_CACHE_TTL_MS = 30_000;
const worktreePathCache = new Map<string, { expiresAt: number; paths: string[] }>();
const aiHistorySyncCache = new Map<string, { hash: string; sentAt: number; running: boolean }>();
const aiHistoryRolloutInspectCache = new Map<string, { fingerprint: string; nextInspectAt: number }>();
const taskRolloutInspectCache = new Map<string, { fingerprint: string; nextInspectAt: number }>();
const aiHistoryDetailSyncCache = new Map<string, { hash: string; sentAt: number }>();
const aiHistoryDetailWatchRequests = new Map<string, AiHistoryDetailHydrateRequest>();
const aiHistoryDetailRolloutInspectCache = new Map<string, { fingerprint: string; nextInspectAt: number }>();
const aiHistoryTimerAlignmentWatch = new Map<string, {
  projectId: string;
  repoPath: string;
  externalThreadId: string;
  runningDetectedAtMs: number;
  nextDelayIndex: number;
  nextInspectAt: number;
  expiresAt: number;
}>();
const aiHistoryPlaceholderTitleWatch = new Map<string, {
  projectId: string;
  repoPath: string;
  externalThreadId: string;
  expiresAt: number;
}>();
const codexSessionThreadNameCache = new Map<string, {
  mtimeMs: number;
  size: number;
  names: Map<string, string>;
}>();
let aiHistoryDetailHydrateApiUnavailableUntil = 0;
let aiHistoryDetailHydrateContractFailed = false;

type CodexThreadImportScopeHeartbeat = {
  project_id: string;
  repo_path: string;
  enabled_since: string | null;
  cwd_paths: string[];
};

type CodexThreadMonitorHeartbeatState = {
  state_db_found: boolean;
  state_db_path: string | null;
  last_tick_at: string | null;
  last_tick_duration_ms: number | null;
  skipped_ticks: number;
  tick_overrun_ms: number;
  phase_timings_ms: Record<string, number>;
  active_watch_count: number;
  recent_scan_count: number;
  reconcile_queue_length: number;
  last_scope_refresh_at: string | null;
  last_scope_refresh_error: string | null;
  scopes: CodexThreadImportScopeHeartbeat[];
  last_reconcile_at: string | null;
  next_reconcile_at: string | null;
  last_reconcile_imported: number | null;
  last_reconcile_upserted: number | null;
  last_source_task_reconcile_at: string | null;
  next_source_task_reconcile_at: string | null;
  last_source_task_reconcile_synced: number | null;
  last_error: string | null;
};

const codexThreadMonitorHeartbeatState: CodexThreadMonitorHeartbeatState = {
  state_db_found: false,
  state_db_path: null,
  last_tick_at: null,
  last_tick_duration_ms: null,
  skipped_ticks: 0,
  tick_overrun_ms: 0,
  phase_timings_ms: {},
  active_watch_count: 0,
  recent_scan_count: 0,
  reconcile_queue_length: 0,
  last_scope_refresh_at: null,
  last_scope_refresh_error: null,
  scopes: [],
  last_reconcile_at: null,
  next_reconcile_at: null,
  last_reconcile_imported: null,
  last_reconcile_upserted: null,
  last_source_task_reconcile_at: null,
  next_source_task_reconcile_at: null,
  last_source_task_reconcile_synced: null,
  last_error: null,
};

function updateCodexThreadMonitorHeartbeatState(patch: Partial<CodexThreadMonitorHeartbeatState>): void {
  Object.assign(codexThreadMonitorHeartbeatState, patch);
}

function codexThreadImportScopeMetadataFlat() {
  const scopes = codexThreadMonitorHeartbeatState.scopes;
  return {
    codex_status_resolver_version: CODEX_THREAD_STATUS_RESOLVER_VERSION,
    codex_monitor_db_available: codexThreadMonitorHeartbeatState.state_db_found,
    codex_monitor_db_path: codexThreadMonitorHeartbeatState.state_db_path,
    codex_import_scopes_count: scopes.length,
    codex_import_scope_repo_paths: scopes.map(scope => scope.repo_path),
    codex_import_scope_cwd_paths: Array.from(new Set(scopes.flatMap(scope => scope.cwd_paths))),
    codex_last_tick_duration_ms: codexThreadMonitorHeartbeatState.last_tick_duration_ms,
    codex_skipped_ticks: codexThreadMonitorHeartbeatState.skipped_ticks,
    codex_tick_overrun_ms: codexThreadMonitorHeartbeatState.tick_overrun_ms,
    codex_phase_timings_ms: codexThreadMonitorHeartbeatState.phase_timings_ms,
    codex_active_watch_count: codexThreadMonitorHeartbeatState.active_watch_count,
    codex_recent_scan_count: codexThreadMonitorHeartbeatState.recent_scan_count,
    codex_reconcile_queue_length: codexThreadMonitorHeartbeatState.reconcile_queue_length,
    codex_last_scope_refresh_at: codexThreadMonitorHeartbeatState.last_scope_refresh_at,
    codex_last_scope_refresh_error: codexThreadMonitorHeartbeatState.last_scope_refresh_error,
    codex_last_reconcile_at: codexThreadMonitorHeartbeatState.last_reconcile_at,
    codex_next_reconcile_at: codexThreadMonitorHeartbeatState.next_reconcile_at,
    codex_last_reconcile_imported: codexThreadMonitorHeartbeatState.last_reconcile_imported,
    codex_last_reconcile_upserted: codexThreadMonitorHeartbeatState.last_reconcile_upserted,
    codex_last_source_task_reconcile_at: codexThreadMonitorHeartbeatState.last_source_task_reconcile_at,
    codex_next_source_task_reconcile_at: codexThreadMonitorHeartbeatState.next_source_task_reconcile_at,
    codex_last_source_task_reconcile_synced: codexThreadMonitorHeartbeatState.last_source_task_reconcile_synced,
    codex_monitor_last_error: codexThreadMonitorHeartbeatState.last_error,
  };
}

export function getCodexThreadMonitorHeartbeatMetadata(): Record<string, unknown> {
  return {
    ...codexThreadImportScopeMetadataFlat(),
    codex_thread_import: { ...codexThreadMonitorHeartbeatState },
  };
}

export type CodexThreadRow = {
  id: string;
  title?: string | null;
  tokens_used?: number | null;
  has_user_event?: number | boolean | null;
  archived?: number | boolean | null;
  updated_at_ms?: number | null;
  created_at_ms?: number | null;
  preview?: string | null;
  rollout_path?: string | null;
  source?: string | null;
  thread_source?: string | null;
  cwd?: string | null;
  first_user_message?: string | null;
};

type VisibleMessage = {
  sequence: number;
  role: 'user' | 'codex';
  kind: AgentActivityMessage['kind'];
  body: string;
  createdAt: string | null;
  sourceEvent: string;
  turnStartedAt?: string | null;
  turnCompletedAt?: string | null;
};

export type CodexTimerSource = 'task_started' | 'fallback_user_message' | 'unknown';

export type RolloutSummary = {
  state: 'running' | 'awaiting_approval';
  historyStatus: AiHistoryStatus;
  reviewReason: string;
  currentStep: string;
  lastActivityAt: string | null;
  threadUpdatedAt: string | null;
  threadArchived: boolean;
  latestUserMessageAt: string | null;
  latestTaskStartedAt: string | null;
  latestTaskCompleteAt: string | null;
  latestRunningActivityAt: string | null;
  latestAgentMessage: string | null;
  runningDetectedAt: string | null;
  timerStartedAt: string | null;
  timerSource: CodexTimerSource;
  timerOffsetMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
  activeStartedAt: string | null;
  activeTimerStartedAt: string | null;
  workDurationSeconds: number | null;
  visibleMessages: VisibleMessage[];
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowIso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

function recordPhaseTiming(phase: string, startedAtMs: number): number {
  const durationMs = Math.max(0, Math.round(Date.now() - startedAtMs));
  updateCodexThreadMonitorHeartbeatState({
    phase_timings_ms: {
      ...codexThreadMonitorHeartbeatState.phase_timings_ms,
      [phase]: durationMs,
    },
  });
  return durationMs;
}

async function measurePhase<T>(phase: string, action: () => Promise<T>): Promise<T> {
  const startedAtMs = Date.now();
  try {
    return await action();
  } finally {
    recordPhaseTiming(phase, startedAtMs);
  }
}

export function codexStateDbPath(homeDir = homedir()): string | null {
  const configured = process.env.FOCUSMAP_CODEX_STATE_DB_PATH?.trim();
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    join(homeDir, '.codex', 'sqlite', 'state_5.sqlite'),
    join(homeDir, '.codex', 'state_5.sqlite'),
  ].filter((value): value is string => !!value);

  return candidates
    .filter(candidate => existsSync(candidate))
    .map(candidate => ({ candidate, score: codexStateDbFreshnessScore(candidate) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate ?? null;
}

function cachedCodexStateDbPath(nowMs = Date.now()): string | null {
  if (cachedMonitorDbPath && nowMs < cachedMonitorDbPath.expiresAt) {
    if (cachedMonitorDbPath.path && existsSync(cachedMonitorDbPath.path)) return cachedMonitorDbPath.path;
    if (!cachedMonitorDbPath.path) return null;
  }
  const path = codexStateDbPath();
  cachedMonitorDbPath = {
    path,
    expiresAt: nowMs + (path ? MONITOR_DB_PATH_CACHE_TTL_MS : 5_000),
  };
  return path;
}

function codexStateDbFreshnessScore(dbPath: string): number {
  const latestThreadUpdatedAt = latestCodexThreadUpdatedAtMs(dbPath);
  if (latestThreadUpdatedAt > 0) return latestThreadUpdatedAt;
  try {
    return statSync(dbPath).mtimeMs;
  } catch {
    return 0;
  }
}

function latestCodexThreadUpdatedAtMs(dbPath: string): number {
  try {
    const stdout = execFileSync(
      SQLITE_BIN,
      [
        dbPath,
        "SELECT COALESCE(MAX(updated_at_ms), MAX(updated_at) * 1000, 0) FROM threads;",
      ],
      { encoding: 'utf8', timeout: 2_000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const value = Number(String(stdout).trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join('');
  if (!isRecord(value)) return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.summary === 'string') return value.summary;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.content)) return value.content.map(safeText).filter(Boolean).join('');
  if (Array.isArray(value.parts)) return value.parts.map(safeText).filter(Boolean).join('');
  if (isRecord(value.message)) return safeText(value.message);
  return '';
}

function compactText(value: string, maxChars = 2_000): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, maxChars);
}

function compactStep(value: string, maxChars = 240): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function toolStepName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'ツール';
  switch (value.trim()) {
    case 'exec_command': return 'コマンド';
    case 'write_stdin': return '実行中コマンド';
    case 'apply_patch': return 'ファイル編集';
    case 'tool_search_tool': return 'ツール検索';
    default: return value.trim().replace(/_/g, ' ');
  }
}

function oneLineTitle(value: unknown, maxChars = 80): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  return text || null;
}

function comparableTitleText(value: unknown): string {
  return compactText(typeof value === 'string' ? value : '', 8_000)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCodexThreadPromptDerivedTitle(
  row: { title?: string | null; first_user_message?: string | null; preview?: string | null },
  candidateValue: unknown = row.title,
): boolean {
  const candidate = comparableTitleText(candidateValue);
  if (!candidate) return false;
  for (const sourceValue of [row.first_user_message, row.preview]) {
    const source = comparableTitleText(sourceValue);
    if (!source) continue;
    if (candidate === source) return true;
    if (candidate.length >= 24 && source.startsWith(candidate)) return true;
  }
  return false;
}

function codexThreadTitleCandidate(
  value: unknown,
  row: { first_user_message?: string | null; preview?: string | null },
): string | null {
  const title = compactText(typeof value === 'string' ? value : '', 8_000);
  if (!title || isInternalUserMessage(title)) return null;
  if (isCodexThreadPromptDerivedTitle(row, title)) return null;
  const firstLine = title.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return oneLineTitle(firstLine);
}

export function codexThreadGeneratedTitle(row: { title?: string | null; first_user_message?: string | null; preview?: string | null }): string | null {
  return codexThreadTitleCandidate(row.title, row);
}

function extractVisiblePromptText(value: unknown): string | null {
  let text = compactText(typeof value === 'string' ? value : '', 60_000);
  if (!text) return null;

  const requestMatch = text.match(/(?:^|\n)#+\s*My request for Codex:\s*/iu)
    ?? text.match(/(?:^|\n)My request for Codex:\s*/iu);
  if (requestMatch?.index !== undefined) {
    text = text.slice(requestMatch.index + requestMatch[0].length);
  } else if (isInternalUserMessage(text)) {
    return null;
  }

  text = text
    .replace(/<skill>[\s\S]*?<\/skill>/giu, '\n')
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/giu, '\n')
    .replace(/<appshot[\s\S]*?<\/appshot>/giu, '\n')
    .replace(/#\s*AGENTS\.md instructions[\s\S]*?(?=\n#+\s|\nMy request for Codex:|$)/iu, '\n');

  const firstLine = text
    .split(/\r?\n/)
    .map(line => line.replace(/^[-*]\s+/u, '').trim())
    .find(line => line && !line.startsWith('<') && !/^#+\s/.test(line));
  return oneLineTitle(firstLine, 80);
}

function codexThreadPromptFallbackTitle(row: { first_user_message?: string | null; preview?: string | null }): string | null {
  for (const value of [row.first_user_message, row.preview]) {
    const title = extractVisiblePromptText(value);
    if (title) return title;
  }
  return null;
}

export function codexSessionIndexPath(homeDir = homedir()): string {
  const configured = process.env.FOCUSMAP_CODEX_SESSION_INDEX_PATH?.trim();
  return configured || join(homeDir, '.codex', 'session_index.jsonl');
}

export function codexSessionThreadNamesFromJsonl(raw: string): Map<string, string> {
  const names = new Map<string, { name: string; updatedAtMs: number; order: number }>();
  let order = 0;
  for (const line of raw.split(/\r?\n/)) {
    order += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isRecord(parsed) || typeof parsed.id !== 'string') continue;
      const name = oneLineTitle(parsed.thread_name, 120);
      if (!name || isInternalUserMessage(name)) continue;
      const updatedAtMs = timeMs(parsed.updated_at) ?? 0;
      const previous = names.get(parsed.id);
      if (!previous || updatedAtMs > previous.updatedAtMs || (updatedAtMs === previous.updatedAtMs && order > previous.order)) {
        names.set(parsed.id, { name, updatedAtMs, order });
      }
    } catch {
      continue;
    }
  }
  return new Map([...names.entries()].map(([id, entry]) => [id, entry.name]));
}

async function readCodexSessionThreadNames(indexPath = codexSessionIndexPath()): Promise<ReadonlyMap<string, string>> {
  try {
    const fileStat = await stat(indexPath);
    const cached = codexSessionThreadNameCache.get(indexPath);
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) return cached.names;
    const names = codexSessionThreadNamesFromJsonl(await readFile(indexPath, 'utf8'));
    codexSessionThreadNameCache.set(indexPath, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, names });
    trimCacheToLimit(codexSessionThreadNameCache, 4);
    return names;
  } catch {
    return new Map<string, string>();
  }
}

function codexSessionThreadTitle(
  row: Pick<CodexThreadRow, 'id' | 'first_user_message' | 'preview'>,
  sessionThreadNames?: ReadonlyMap<string, string> | null,
): string | null {
  const threadName = sessionThreadNames?.get(row.id);
  return codexThreadTitleCandidate(threadName, row);
}

type AiHistoryTitleSource = 'session_index' | 'codex_title' | 'prompt_fallback' | 'placeholder';

function aiHistoryTitleInfo(
  row: CodexThreadRow,
  sessionThreadNames?: ReadonlyMap<string, string> | null,
): { title: string; source: AiHistoryTitleSource } {
  const sessionTitle = codexSessionThreadTitle(row, sessionThreadNames);
  if (sessionTitle) return { title: sessionTitle, source: 'session_index' };
  const generatedTitle = codexThreadGeneratedTitle(row);
  if (generatedTitle) return { title: generatedTitle, source: 'codex_title' };
  const promptFallbackTitle = codexThreadPromptFallbackTitle(row);
  if (promptFallbackTitle) return { title: promptFallbackTitle, source: 'prompt_fallback' };
  return { title: AI_HISTORY_PLACEHOLDER_TITLE, source: 'placeholder' };
}

function textFingerprint(value: string): string {
  return compactText(value, 500).toLowerCase().replace(/\s+/g, ' ').slice(0, 180);
}

function promptMatchText(value: unknown): string {
  return compactText(typeof value === 'string' ? value : '', 8_000)
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function promptsLikelyMatch(leftValue: unknown, rightValue: unknown): boolean {
  const left = promptMatchText(leftValue);
  const right = promptMatchText(rightValue);
  if (!left || !right) return false;
  if (left === right) return true;

  const prefixLength = Math.min(PROMPT_MATCH_PREFIX_CHARS, left.length, right.length);
  return prefixLength >= MIN_PROMPT_MATCH_CHARS &&
    left.slice(0, prefixLength) === right.slice(0, prefixLength);
}

function timestampToIso(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function timeMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function latestIso(...values: Array<unknown>): string | null {
  const times = values
    .map(timeMs)
    .filter((value): value is number => value !== null);
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

function isInternalUserMessage(value: string): boolean {
  const text = value.trim();
  return text.startsWith('# AGENTS.md instructions') ||
    text.startsWith('<environment_context>') ||
    text.includes('\n<environment_context>');
}

function looksLikeQuestion(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/[?？]/.test(text)) return true;
  return /(確認してください|教えてください|選んでください|必要ですか|よいですか|しますか|どちら|どれ)/u.test(text.slice(-160));
}

function failedRolloutPayload(payload: Record<string, unknown>): boolean {
  const text = [
    safeText(payload.error),
    safeText(payload.reason),
    safeText(payload.message),
    safeText(payload),
  ].join(' ').toLowerCase();
  return /\b(failed|failure|error|exception|panic)\b|失敗|エラー|例外/u.test(text);
}

function needsInputRolloutPayload(payloadType: string, payload: Record<string, unknown>): boolean {
  const type = payloadType.toLowerCase();
  void payload;
  return /(needs_input|input_required|approval_required|request_input|user_input)/.test(type);
}

function isContextMaintenanceEvent(payloadType: string, payload: Record<string, unknown>): boolean {
  const type = payloadType.toLowerCase();
  if (/(context|window).*(compact|compaction|compress|compression|summariz|summary)/.test(type)) return true;
  if (/(compact|compaction|compress|compression).*(context|window)/.test(type)) return true;
  const text = safeText(payload).toLowerCase();
  return /context (compaction|compression)|compacting context|compressing context|コンテキスト圧縮|圧縮中/.test(text);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeLocalPath(value: string | null | undefined): string {
  return value?.trim().replace(/\/+$/, '') ?? '';
}

function isUserCodexThread(row: Pick<CodexThreadRow, 'thread_source'>): boolean {
  const threadSource = typeof row.thread_source === 'string' ? row.thread_source.trim() : '';
  return !threadSource || threadSource === 'user';
}

export function shouldArchiveAiHistoryThread(row: Pick<CodexThreadRow, 'archived' | 'thread_source'>): boolean {
  return Boolean(row.archived) || !isUserCodexThread(row);
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= SQLITE_READ_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        SQLITE_BIN,
        ['-json', '-cmd', '.timeout 3000', dbPath, sql],
        { timeout: 8_000 },
      );
      const text = stdout.trim();
      if (!text) return [];
      return JSON.parse(text) as T[];
    } catch (error) {
      lastError = error;
      const delayMs = SQLITE_READ_RETRY_DELAYS_MS[attempt];
      if (delayMs === undefined) break;
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function readThread(dbPath: string, threadId: string): Promise<CodexThreadRow | null> {
  const rows = await sqliteJson<CodexThreadRow>(
    dbPath,
    [
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, created_at_ms, preview, rollout_path, source, thread_source, cwd, first_user_message',
      'FROM threads',
      `WHERE id = ${sqlString(threadId)}`,
      'LIMIT 1',
    ].join(' '),
  );
  return rows[0] ?? null;
}

async function readThreads(dbPath: string, threadIds: string[]): Promise<Map<string, CodexThreadRow | null>> {
  const uniqueIds = Array.from(new Set(threadIds.map(id => id.trim()).filter(Boolean)));
  const rowsById = new Map<string, CodexThreadRow | null>();
  for (const id of uniqueIds) rowsById.set(id, null);
  if (uniqueIds.length === 0) return rowsById;
  const rows = await sqliteJson<CodexThreadRow>(
    dbPath,
    [
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, created_at_ms, preview, rollout_path, source, thread_source, cwd, first_user_message',
      'FROM threads',
      `WHERE id IN (${uniqueIds.map(sqlString).join(', ')})`,
    ].join(' '),
  );
  for (const row of rows) rowsById.set(row.id, row);
  return rowsById;
}

type ThreadRowCache = {
  get(threadId: string): Promise<CodexThreadRow | null>;
};

async function createThreadRowCache(dbPath: string, threadIds: string[]): Promise<ThreadRowCache> {
  const rowsById = await readThreads(dbPath, threadIds);
  return {
    async get(threadId: string): Promise<CodexThreadRow | null> {
      if (rowsById.has(threadId)) return rowsById.get(threadId) ?? null;
      const row = await readThread(dbPath, threadId);
      rowsById.set(threadId, row);
      return row;
    },
  };
}

function appendVisibleMessage(messages: VisibleMessage[], input: Omit<VisibleMessage, 'body'> & { body: string }): void {
  const body = compactText(input.body, MAX_ACTIVITY_BODY_CHARS);
  if (!body) return;
  const inputTurnKey = input.role === 'codex' ? input.turnStartedAt ?? '' : input.createdAt ?? '';
  const key = `${input.role}:${inputTurnKey}:${textFingerprint(body)}`;
  const existing = messages.find(message => {
    const messageTurnKey = message.role === 'codex' ? message.turnStartedAt ?? '' : message.createdAt ?? '';
    if (`${message.role}:${messageTurnKey}:${textFingerprint(message.body)}` === key) return true;
    return input.role === 'codex' &&
      message.role === 'codex' &&
      input.turnCompletedAt &&
      !message.turnCompletedAt &&
      textFingerprint(message.body) === textFingerprint(body) &&
      (!message.turnStartedAt || !input.turnStartedAt);
  });
  if (existing) {
    existing.turnStartedAt = existing.turnStartedAt ?? input.turnStartedAt;
    existing.turnCompletedAt = existing.turnCompletedAt ?? input.turnCompletedAt;
    existing.sequence = Math.max(existing.sequence, input.sequence);
    existing.createdAt = input.createdAt ?? existing.createdAt;
    existing.sourceEvent = input.sourceEvent;
    if (input.kind === 'completed' || input.kind === 'question') existing.kind = input.kind;
    return;
  }
  messages.push({ ...input, body });
}

function completeLatestCodexVisibleMessage(
  messages: VisibleMessage[],
  turnStartedAt: string | null,
  turnCompletedAt: string | null,
  sourceEvent = 'task_complete',
): void {
  if (!turnCompletedAt) return;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'codex') continue;
    if (turnStartedAt && message.turnStartedAt && message.turnStartedAt !== turnStartedAt) continue;
    message.turnStartedAt = message.turnStartedAt ?? turnStartedAt;
    message.turnCompletedAt = message.turnCompletedAt ?? turnCompletedAt;
    message.createdAt = turnCompletedAt ?? message.createdAt;
    message.sourceEvent = sourceEvent;
    if (message.kind !== 'question') message.kind = 'completed';
    return;
  }
}

function visibleMessageTurnMetadata(message: VisibleMessage): Record<string, unknown> {
  if (message.role !== 'codex') return {};
  const startedAt = message.turnStartedAt ?? null;
  const completedAt = message.turnCompletedAt ?? null;
  const startedMs = timeMs(startedAt);
  const completedMs = timeMs(completedAt);
  const elapsedMs = startedMs !== null && completedMs !== null
    ? Math.max(0, completedMs - startedMs)
    : null;
  return {
    ...(startedAt ? { turn_started_at: startedAt } : {}),
    ...(completedAt ? { turn_completed_at: completedAt } : {}),
    ...(elapsedMs !== null ? { work_elapsed_ms: elapsedMs } : {}),
  };
}

function shouldTreatCodexActivityAsRunning(input: {
  eventTime: string | null;
  latestTaskCompleteAt: string | null;
  latestUserMessageAt: string | null;
  latestTaskStartedAt: string | null;
}): boolean {
  const completeMs = timeMs(input.latestTaskCompleteAt);
  if (completeMs === null) return true;
  const eventMs = timeMs(input.eventTime);
  if (eventMs !== null && eventMs <= completeMs) return true;
  const restartMs = Math.max(
    timeMs(input.latestUserMessageAt) ?? 0,
    timeMs(input.latestTaskStartedAt) ?? 0,
  );
  return restartMs > completeMs;
}

function isPostCompleteToolContinuation(input: {
  eventTime: string | null;
  latestTaskCompleteAt: string | null;
  pendingPostCompleteReasoningAt: string | null;
}): boolean {
  const completeMs = timeMs(input.latestTaskCompleteAt);
  const eventMs = timeMs(input.eventTime);
  const reasoningMs = timeMs(input.pendingPostCompleteReasoningAt);
  return completeMs !== null &&
    eventMs !== null &&
    reasoningMs !== null &&
    reasoningMs > completeMs &&
    eventMs > completeMs &&
    reasoningMs <= eventMs;
}

export function parseRollout(rawJsonl: string, row: CodexThreadRow): RolloutSummary {
  const visibleMessages: VisibleMessage[] = [];
  const threadArchived = Boolean(row.archived);
  const threadUpdatedAt = timestampToIso(row.updated_at_ms ?? null);
  let state: RolloutSummary['state'] = threadArchived ? 'awaiting_approval' : 'running';
  let historyStatus: AiHistoryStatus = threadArchived ? 'awaiting_approval' : 'running';
  let reviewReason = threadArchived ? 'archived' : 'started';
  let currentStep = threadArchived ? 'Codex thread は確認待ちです' : 'Codex.appで実行中';
  let lastActivityAt = threadUpdatedAt;
  let latestUserMessageAt: string | null = null;
  let latestTaskStartedAt: string | null = null;
  let latestTaskCompleteAt: string | null = null;
  let latestRunningActivityAt: string | null = null;
  let latestAgentMessage: string | null = null;
  let runningDetectedAt: string | null = null;
  let timerStartedAt: string | null = null;
  let timerSource: CodexTimerSource = 'unknown';
  let timerOffsetMs: number | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let activeStartedAt: string | null = null;
  let activeStartedMs: number | null = null;
  let activeTimerStartedAt: string | null = null;
  let activeTimerStartedMs: number | null = null;
  let workDurationMs = 0;
  let pendingPostCompleteReasoningAt: string | null = null;
  let passivePostCompleteMaintenanceSeen = false;

  const refreshTimerOffset = () => {
    if (activeStartedMs === null || activeTimerStartedMs === null) {
      timerOffsetMs = null;
      return;
    }
    timerOffsetMs = Math.round(activeTimerStartedMs - activeStartedMs);
  };
  const markRunningDetected = (iso: string | null) => {
    const ms = timeMs(iso);
    if (ms === null) return;
    if (activeStartedMs === null) {
      activeTimerStartedAt = null;
      activeTimerStartedMs = null;
      timerStartedAt = null;
      timerSource = 'unknown';
      timerOffsetMs = null;
    }
    if (activeStartedMs === null || ms < activeStartedMs) {
      activeStartedAt = new Date(ms).toISOString();
      activeStartedMs = ms;
      runningDetectedAt = activeStartedAt;
      refreshTimerOffset();
    }
  };
  const markTimerStarted = (iso: string | null, source: CodexTimerSource) => {
    const ms = timeMs(iso);
    if (ms === null) return;
    const normalized = new Date(ms).toISOString();
    startedAt = startedAt ?? normalized;
    if (activeTimerStartedMs === null || source === 'task_started') {
      activeTimerStartedAt = normalized;
      activeTimerStartedMs = ms;
      timerStartedAt = normalized;
      timerSource = source;
      refreshTimerOffset();
    }
  };
  const markUserPromptReceived = (iso: string | null) => {
    const eventMs = timeMs(iso);
    const completeMs = timeMs(latestTaskCompleteAt);
    if (completeMs !== null && (eventMs === null || eventMs <= completeMs)) return;

    pendingPostCompleteReasoningAt = null;
    passivePostCompleteMaintenanceSeen = false;
    latestRunningActivityAt = iso;
    state = 'running';
    historyStatus = 'running';
    reviewReason = 'started';
    currentStep = completeMs === null
      ? 'Codexがプロンプトを受け取りました'
      : 'Codexが追加指示を受け取りました';
    markRunningDetected(iso);
  };
  const markWorkEnded = (iso: string | null) => {
    const ms = timeMs(iso);
    if (ms === null) return;
    if (activeTimerStartedMs === null && activeStartedAt) {
      markTimerStarted(activeStartedAt, 'fallback_user_message');
    }
    endedAt = new Date(ms).toISOString();
    if (activeTimerStartedMs !== null) {
      workDurationMs += Math.max(0, ms - activeTimerStartedMs);
      activeTimerStartedMs = null;
      activeTimerStartedAt = null;
    }
    activeStartedMs = null;
    activeStartedAt = null;
  };

  let sequence = 0;
  for (const line of rawJsonl.split('\n')) {
    sequence += 1;
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const previousLastActivityAt = lastActivityAt;
    const rowTime = timestampToIso(parsed.timestamp);
    if (rowTime) lastActivityAt = rowTime;

    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    const payloadType = typeof payload.type === 'string' ? payload.type : '';
    const payloadTime = timestampToIso(payload.timestamp ?? payload.started_at ?? payload.completed_at);
    const eventTime = latestIso(rowTime, payloadTime) ?? lastActivityAt;
    if (eventTime) lastActivityAt = eventTime;

    if (payloadType === 'task_started') {
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestTaskStartedAt = eventTime;
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexが実行を開始しました';
      markRunningDetected(eventTime);
      markTimerStarted(eventTime, 'task_started');
      continue;
    }

    if (payloadType === 'task_complete') {
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      historyStatus = 'awaiting_approval';
      reviewReason = 'completed';
      currentStep = 'Codexが実行完了し確認待ちです';
      markWorkEnded(eventTime);
      const text = safeText(payload.last_agent_message);
      if (text) {
        latestAgentMessage = compactText(text, 2_000);
        appendVisibleMessage(visibleMessages, {
          sequence,
          role: 'codex',
          kind: looksLikeQuestion(text) ? 'question' : 'completed',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'task_complete',
          turnStartedAt: timerStartedAt ?? latestTaskStartedAt,
          turnCompletedAt: eventTime,
        });
      } else {
        completeLatestCodexVisibleMessage(visibleMessages, timerStartedAt ?? latestTaskStartedAt, eventTime);
      }
      continue;
    }

    if (payloadType === 'turn_aborted') {
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      historyStatus = failedRolloutPayload(payload) ? 'failed' : 'awaiting_approval';
      reviewReason = historyStatus === 'failed' ? 'failed' : 'aborted';
      currentStep = historyStatus === 'failed'
        ? 'Codexのターンが失敗しました'
        : 'Codexのターンが停止し確認待ちです';
      markWorkEnded(eventTime);
      completeLatestCodexVisibleMessage(visibleMessages, timerStartedAt ?? latestTaskStartedAt, eventTime, 'turn_aborted');
      continue;
    }

    if (payloadType === 'task_failed' || payloadType === 'error') {
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      historyStatus = 'failed';
      reviewReason = 'failed';
      currentStep = 'Codexの実行が失敗しました';
      markWorkEnded(eventTime);
      continue;
    }

    if (payloadType === 'completed' || payloadType === 'thread_completed' || payloadType === 'task_done' || payloadType === 'task_succeeded') {
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      historyStatus = 'completed';
      reviewReason = 'completed';
      currentStep = 'Codexの実行が完了しました';
      markWorkEnded(eventTime);
      continue;
    }

    if (needsInputRolloutPayload(payloadType, payload)) {
      state = 'awaiting_approval';
      historyStatus = 'needs_input';
      reviewReason = 'needs_input';
      currentStep = 'Codexが入力を待っています';
      continue;
    }

    if (payloadType === 'agent_message') {
      const text = safeText(payload);
      if (text) {
        if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
          lastActivityAt = previousLastActivityAt;
          continue;
        }
        latestRunningActivityAt = eventTime;
        state = 'running';
        historyStatus = 'running';
        reviewReason = 'started';
        latestAgentMessage = compactText(text, 2_000);
        currentStep = compactStep(text);
        appendVisibleMessage(visibleMessages, {
          sequence,
          role: 'codex',
          kind: looksLikeQuestion(text) ? 'question' : 'progress',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'agent_message',
          turnStartedAt: activeTimerStartedAt ?? latestTaskStartedAt,
        });
      }
      continue;
    }

    if (payloadType === 'user_message') {
      const text = safeText(payload);
      if (text && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime;
        markUserPromptReceived(eventTime);
        appendVisibleMessage(visibleMessages, {
          sequence,
          role: 'user',
          kind: 'user_answer',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'user_message',
        });
      }
      continue;
    }

    if (isContextMaintenanceEvent(payloadType, payload)) {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        if ((timeMs(eventTime) ?? 0) > (timeMs(latestTaskCompleteAt) ?? Number.POSITIVE_INFINITY)) {
          pendingPostCompleteReasoningAt = null;
          passivePostCompleteMaintenanceSeen = true;
        }
        lastActivityAt = previousLastActivityAt;
        continue;
      }
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexがコンテキストを整理中';
      continue;
    }

    if (payloadType === 'reasoning') {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        if (!passivePostCompleteMaintenanceSeen && (timeMs(eventTime) ?? 0) > (timeMs(latestTaskCompleteAt) ?? Number.POSITIVE_INFINITY)) {
          pendingPostCompleteReasoningAt = eventTime;
        }
        lastActivityAt = previousLastActivityAt;
        continue;
      }
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexが内容を検討中';
      continue;
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const isContinuation = isPostCompleteToolContinuation({
        eventTime,
        latestTaskCompleteAt,
        pendingPostCompleteReasoningAt,
      });
      if (!isContinuation && !shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt;
        continue;
      }
      if (isContinuation) {
        latestTaskStartedAt = eventTime;
        markRunningDetected(eventTime);
        markTimerStarted(eventTime, 'unknown');
      }
      pendingPostCompleteReasoningAt = null;
      passivePostCompleteMaintenanceSeen = false;
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = `Codexが${toolStepName(payload.name ?? payload.tool_name)}を実行中`;
      continue;
    }

    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output' || payloadType === 'patch_apply_end') {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt;
        continue;
      }
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexが実行結果を確認中';
      continue;
    }

    if (payloadType === 'message') {
      const role = typeof payload.role === 'string' ? payload.role : '';
      const text = safeText(payload);
      if (!text) continue;
      if (role === 'assistant') {
        if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
          lastActivityAt = previousLastActivityAt;
          continue;
        }
        latestRunningActivityAt = eventTime;
        state = 'running';
        historyStatus = 'running';
        reviewReason = 'started';
        latestAgentMessage = compactText(text, 2_000);
        currentStep = compactStep(text);
        appendVisibleMessage(visibleMessages, {
          sequence,
          role: 'codex',
          kind: looksLikeQuestion(text) ? 'question' : 'progress',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'message',
          turnStartedAt: activeTimerStartedAt ?? latestTaskStartedAt,
        });
      } else if (role === 'user' && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime;
        markUserPromptReceived(eventTime);
        appendVisibleMessage(visibleMessages, {
          sequence,
          role: 'user',
          kind: 'user_answer',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'message',
        });
      }
    }

    if (payloadType && !shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
      lastActivityAt = previousLastActivityAt;
    }
  }

  if (!rawJsonl.trim() && row.preview) {
    currentStep = compactStep(row.preview);
  }

  return {
    state,
    historyStatus,
    reviewReason,
    currentStep,
    lastActivityAt,
    threadUpdatedAt,
    threadArchived,
    latestUserMessageAt,
    latestTaskStartedAt,
    latestTaskCompleteAt,
    latestRunningActivityAt,
    latestAgentMessage,
    runningDetectedAt,
    timerStartedAt,
    timerSource,
    timerOffsetMs,
    startedAt,
    endedAt,
    activeStartedAt,
    activeTimerStartedAt,
    workDurationSeconds: workDurationMs > 0 ? Math.floor(workDurationMs / 1000) : null,
    visibleMessages,
  };
}

function taskThreadId(task: AiTask): string | null {
  if (task.codex_thread_id?.trim()) return task.codex_thread_id.trim();
  const result = isRecord(task.result) ? task.result : {};
  const resultThreadId = result.codex_thread_id;
  return typeof resultThreadId === 'string' && resultThreadId.trim() ? resultThreadId.trim() : null;
}

export function knownCodexThreadIds(tasks: AiTask[]): Set<string> {
  const ids = new Set<string>();
  for (const task of tasks) {
    const threadId = taskThreadId(task);
    if (threadId) ids.add(threadId);
  }
  return ids;
}

export function codexThreadIdsForTasks(tasks: AiTask[]): string[] {
  return Array.from(knownCodexThreadIds(tasks));
}

function isThreadNearManualHandoffTime(row: CodexThreadRow, task: AiTask): boolean {
  const threadMs = timeMs(row.created_at_ms) ?? timeMs(row.updated_at_ms);
  const taskMs = timeMs(task.started_at) ?? timeMs(task.created_at);
  if (threadMs === null || taskMs === null) return true;
  return threadMs >= taskMs - 5 * 60 * 1000 &&
    threadMs - taskMs <= FOCUSMAP_HANDOFF_THREAD_WINDOW_MS;
}

function cwdMatchesTask(rowCwd: string, taskCwd: string, cwdScopeMap?: Map<string, CodexThreadImportScope>): boolean {
  if (rowCwd === taskCwd) return true;
  const scope = cwdScopeMap?.get(rowCwd);
  return normalizeLocalPath(scope?.repo_path) === taskCwd;
}

export function isFocusmapManualHandoffThread(
  row: CodexThreadRow,
  tasks: AiTask[],
  cwdScopeMap?: Map<string, CodexThreadImportScope>,
): boolean {
  const firstUserMessage = compactText(row.first_user_message ?? '', 8_000);
  if (!firstUserMessage || isInternalUserMessage(firstUserMessage)) return false;
  const rowCwd = normalizeLocalPath(row.cwd);

  return tasks.some(task => {
    if (task.executor !== 'codex_app') return false;
    if (!task.source_task_id) return false;
    if (taskThreadId(task)) return false;
    const result = taskResult(task);
    if (result.codex_manual_handoff !== true) return false;
    const taskCwd = normalizeLocalPath(task.cwd);
    if (rowCwd && taskCwd && !cwdMatchesTask(rowCwd, taskCwd, cwdScopeMap)) return false;
    if (!isThreadNearManualHandoffTime(row, task)) return false;
    return promptsLikelyMatch(task.prompt, firstUserMessage);
  });
}

export function isOrphanThreadImportCandidate(
  row: CodexThreadRow,
  knownThreadIds: Set<string>,
  importScopes: CodexThreadImportScope[],
  nowMs = Date.now(),
  windowMs = ORPHAN_IMPORT_WINDOW_MS,
  focusmapTasks: AiTask[] = [],
  cwdScopeMap?: Map<string, CodexThreadImportScope>,
): boolean {
  if (!row.id || knownThreadIds.has(row.id)) return false;
  if (!isUserCodexThread(row)) return false;
  if (row.archived) return false;
  if (isFocusmapManualHandoffThread(row, focusmapTasks, cwdScopeMap)) return false;
  const updatedMs = timeMs(row.updated_at_ms) ?? timeMs(row.created_at_ms) ?? 0;
  if (updatedMs <= 0) return false;
  const matchingScope = matchingThreadImportScope(row, importScopes, updatedMs, cwdScopeMap);
  if (!matchingScope) return false;
  if (!matchingScope.enabled_since && nowMs - updatedMs > windowMs) return false;
  const firstUserMessage = compactText(row.first_user_message ?? '', 400);
  if (!firstUserMessage || isInternalUserMessage(firstUserMessage)) return false;
  return true;
}

function importScopeEnabledAt(scope: CodexThreadImportScope, updatedMs: number): boolean {
  const enabledSinceMs = timeMs(scope.enabled_since);
  return enabledSinceMs === null || updatedMs >= enabledSinceMs;
}

export function matchingThreadImportScope(
  row: Pick<CodexThreadRow, 'cwd'>,
  importScopes: CodexThreadImportScope[],
  updatedMs = Date.now(),
  cwdScopeMap?: Map<string, CodexThreadImportScope>,
  options: { ignoreEnabledSince?: boolean } = {},
): CodexThreadImportScope | null {
  const cwd = normalizeLocalPath(row.cwd);
  if (!cwd) return null;
  const aliasedScope = cwdScopeMap?.get(cwd);
  if (aliasedScope && (options.ignoreEnabledSince || importScopeEnabledAt(aliasedScope, updatedMs))) return aliasedScope;

  for (const scope of importScopes) {
    const repoPath = normalizeLocalPath(scope.repo_path);
    if (!repoPath || repoPath !== cwd) continue;
    if (!options.ignoreEnabledSince && !importScopeEnabledAt(scope, updatedMs)) continue;
    return scope;
  }
  return null;
}

export function isOrphanImportApiUnavailable(error: unknown): error is AgentApiError {
  return error instanceof AgentApiError && (error.status === 404 || error.status === 405);
}

type PreparedAiHistoryItem = {
  item: AiHistoryBatchUpsertItem;
  hash: string;
  cacheKey: string;
  rolloutInspectKey: string;
  rolloutFingerprint: string;
  rolloutRecheckMs: number;
  running: boolean;
  detailMessages: AiHistoryDetailMessage[];
  detailSyncedAt: string | null;
};

export type AiHistorySyncMode = 'hot' | 'reconcile';

type AiHistoryMetadataSyncResult = {
  scanned: number;
  prepared: number;
  upserted: number;
};

const emptyAiHistoryMetadataSyncResult: AiHistoryMetadataSyncResult = {
  scanned: 0,
  prepared: 0,
  upserted: 0,
};

function trimCacheToLimit<K, V>(cache: Map<K, V>, limit: number): void {
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function threadRolloutFingerprint(row: CodexThreadRow): string {
  return [
    row.updated_at_ms ?? '',
    row.created_at_ms ?? '',
    row.archived ? '1' : '0',
    row.title ?? '',
    row.preview ?? '',
    row.rollout_path ?? '',
    row.source ?? '',
    row.cwd ?? '',
    row.first_user_message ?? '',
    row.tokens_used ?? '',
    row.has_user_event ?? '',
    rolloutFileFingerprint(row),
  ].join('\u001f');
}

function rolloutFileFingerprint(row: Pick<CodexThreadRow, 'rollout_path'>): string {
  if (!row.rollout_path) return '';
  try {
    const fileStat = statSync(row.rollout_path);
    if (!fileStat.isFile()) return 'not_file';
    return `${Math.floor(fileStat.mtimeMs)}:${fileStat.size}`;
  } catch {
    return 'missing';
  }
}

function runningThreadRolloutRecheckMs(lastActivityMs: number | null, nowMs: number): number {
  if (lastActivityMs !== null && nowMs - lastActivityMs <= ACTIVE_RUNNING_ACTIVITY_WINDOW_MS) {
    return RUNNING_THREAD_ROLLOUT_RECHECK_MS;
  }
  return STALE_RUNNING_THREAD_ROLLOUT_RECHECK_MS;
}

function aiHistoryRolloutRecheckMs(row: CodexThreadRow, running: boolean, nowMs: number): number {
  void row;
  void running;
  void nowMs;
  return AI_HISTORY_DETAIL_FAST_WATCH_RECHECK_MS;
}

function aiHistoryRolloutInspectKey(
  row: CodexThreadRow,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
): string {
  return [
    AI_HISTORY_PROVIDER,
    scope.project_id,
    normalizeLocalPath(scope.repo_path),
    row.id,
  ].join('\u001f');
}

function aiHistoryPlaceholderTitleWatchKey(
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  externalThreadId: string,
): string {
  return [
    AI_HISTORY_PROVIDER,
    typeof scope.project_id === 'string' ? scope.project_id.trim() : '',
    normalizeLocalPath(scope.repo_path),
    externalThreadId,
  ].join('\u001f');
}

function aiHistoryTimerAlignmentWatchKey(
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  externalThreadId: string,
): string {
  return [
    AI_HISTORY_PROVIDER,
    typeof scope.project_id === 'string' ? scope.project_id.trim() : '',
    normalizeLocalPath(scope.repo_path),
    externalThreadId,
  ].join('\u001f');
}

function trimTimerAlignmentWatchToLimit(): void {
  while (aiHistoryTimerAlignmentWatch.size > CODEX_TIMER_ALIGNMENT_RECHECK_MAX_WATCHES) {
    const oldest = [...aiHistoryTimerAlignmentWatch.entries()]
      .sort((left, right) => left[1].expiresAt - right[1].expiresAt)[0];
    if (!oldest) break;
    aiHistoryTimerAlignmentWatch.delete(oldest[0]);
  }
}

function activeAiHistoryTimerAlignmentWatches(nowMs = Date.now()) {
  const entries: Array<{
    key: string;
    projectId: string;
    repoPath: string;
    externalThreadId: string;
  }> = [];
  for (const [key, watch] of aiHistoryTimerAlignmentWatch.entries()) {
    if (watch.expiresAt <= nowMs || watch.nextDelayIndex >= CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS.length) {
      aiHistoryTimerAlignmentWatch.delete(key);
      continue;
    }
    if (watch.nextInspectAt <= nowMs) {
      entries.push({ key, ...watch });
    }
  }
  return entries;
}

function updateAiHistoryTimerAlignmentWatch(
  row: Pick<CodexThreadRow, 'id'>,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  item: Pick<AiHistoryBatchUpsertItem, 'status' | 'startedAt' | 'metadata'>,
  nowMs = Date.now(),
): void {
  if (!row.id) return;
  const projectId = typeof scope.project_id === 'string' ? scope.project_id.trim() : '';
  const repoPath = normalizeLocalPath(scope.repo_path);
  if (!projectId || !repoPath) return;
  const key = aiHistoryTimerAlignmentWatchKey(scope, row.id);
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const runningDetectedAt = typeof metadata.codex_running_detected_at === 'string'
    ? metadata.codex_running_detected_at
    : null;
  const timerStartedAt = typeof item.startedAt === 'string' && item.startedAt.trim()
    ? item.startedAt
    : typeof metadata.codex_timer_started_at === 'string'
      ? metadata.codex_timer_started_at
      : null;
  const detectedMs = timeMs(runningDetectedAt);

  if (item.status !== 'running' || detectedMs === null || timerStartedAt) {
    aiHistoryTimerAlignmentWatch.delete(key);
    return;
  }

  const existing = aiHistoryTimerAlignmentWatch.get(key);
  let nextDelayIndex = existing && existing.runningDetectedAtMs === detectedMs
    ? existing.nextDelayIndex
    : 0;
  while (
    nextDelayIndex < CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS.length &&
    nowMs >= detectedMs + CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS[nextDelayIndex]!
  ) {
    nextDelayIndex += 1;
  }
  if (nextDelayIndex >= CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS.length) {
    aiHistoryTimerAlignmentWatch.delete(key);
    return;
  }

  const lastDelay = CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS[CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS.length - 1]!;
  aiHistoryTimerAlignmentWatch.set(key, {
    projectId,
    repoPath,
    externalThreadId: row.id,
    runningDetectedAtMs: detectedMs,
    nextDelayIndex,
    nextInspectAt: detectedMs + CODEX_TIMER_ALIGNMENT_RECHECK_DELAYS_MS[nextDelayIndex]!,
    expiresAt: detectedMs + lastDelay + 10_000,
  });
  trimTimerAlignmentWatchToLimit();
}

function activeAiHistoryPlaceholderTitleWatches(nowMs = Date.now()) {
  const entries: Array<{
    key: string;
    projectId: string;
    repoPath: string;
    externalThreadId: string;
  }> = [];
  for (const [key, watch] of aiHistoryPlaceholderTitleWatch.entries()) {
    if (watch.expiresAt <= nowMs) {
      aiHistoryPlaceholderTitleWatch.delete(key);
      continue;
    }
    entries.push({ key, ...watch });
  }
  return entries;
}

export function markAiHistoryPlaceholderTitleWatch(
  row: Pick<CodexThreadRow, 'id'>,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  nowMs = Date.now(),
): void {
  const projectId = typeof scope.project_id === 'string' ? scope.project_id.trim() : '';
  const repoPath = normalizeLocalPath(scope.repo_path);
  if (!row.id || !projectId || !repoPath) return;
  aiHistoryPlaceholderTitleWatch.set(aiHistoryPlaceholderTitleWatchKey(scope, row.id), {
    projectId,
    repoPath,
    externalThreadId: row.id,
    expiresAt: nowMs + AI_HISTORY_PLACEHOLDER_TITLE_WATCH_TTL_MS,
  });
}

function clearAiHistoryPlaceholderTitleWatch(
  row: Pick<CodexThreadRow, 'id'>,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
): void {
  if (!row.id) return;
  aiHistoryPlaceholderTitleWatch.delete(aiHistoryPlaceholderTitleWatchKey(scope, row.id));
}

export function shouldInspectAiHistoryPlaceholderTitle(
  row: Pick<CodexThreadRow, 'id'>,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  nowMs = Date.now(),
): boolean {
  if (!row.id) return false;
  const key = aiHistoryPlaceholderTitleWatchKey(scope, row.id);
  const watch = aiHistoryPlaceholderTitleWatch.get(key);
  if (!watch) return false;
  if (watch.expiresAt <= nowMs) {
    aiHistoryPlaceholderTitleWatch.delete(key);
    return false;
  }
  return true;
}

export function shouldInspectAiHistoryRollout(
  row: CodexThreadRow,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  mode: AiHistorySyncMode = 'hot',
  nowMs = Date.now(),
): boolean {
  if (mode === 'reconcile') return true;
  const key = aiHistoryRolloutInspectKey(row, scope);
  const fingerprint = threadRolloutFingerprint(row);
  const cached = aiHistoryRolloutInspectCache.get(key);
  if (!cached) return true;
  if (cached.fingerprint !== fingerprint) return true;
  if (nowMs >= cached.nextInspectAt) {
    return true;
  }
  return false;
}

export function markAiHistoryRolloutInspected(
  row: CodexThreadRow,
  scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>,
  running: boolean,
  nowMs = Date.now(),
): void {
  aiHistoryRolloutInspectCache.set(aiHistoryRolloutInspectKey(row, scope), {
    fingerprint: threadRolloutFingerprint(row),
    nextInspectAt: nowMs + aiHistoryRolloutRecheckMs(row, running, nowMs),
  });
  trimCacheToLimit(aiHistoryRolloutInspectCache, ROLLOUT_INSPECT_CACHE_LIMIT);
}

function markPreparedAiHistoryRolloutInspected(prepared: PreparedAiHistoryItem, nowMs = Date.now()): void {
  aiHistoryRolloutInspectCache.set(prepared.rolloutInspectKey, {
    fingerprint: prepared.rolloutFingerprint,
    nextInspectAt: nowMs + prepared.rolloutRecheckMs,
  });
  trimCacheToLimit(aiHistoryRolloutInspectCache, ROLLOUT_INSPECT_CACHE_LIMIT);
}

function taskRolloutInspectFingerprint(task: AiTask, row: CodexThreadRow, threadId: string): string {
  const result = taskResult(task);
  return [
    threadId,
    threadRolloutFingerprint(row),
    task.status,
    codexRunState(task),
    result.current_step ?? '',
    result.last_activity_at ?? '',
    result.awaiting_approval_at ?? '',
    result.codex_review_reason ?? '',
    result.codex_archive_request_state ?? '',
    result.codex_archive_requested_at ?? '',
    result.codex_activity_synced_sequence ?? '',
  ].join('\u001f');
}

function taskRolloutRecheckMs(task: AiTask, row: CodexThreadRow, running: boolean, nowMs: number): number {
  if (isFastWatchTask(task)) return RUNNING_THREAD_ROLLOUT_RECHECK_MS;
  if (!running) return STABLE_TASK_ROLLOUT_RECHECK_MS;
  const rowActivityMs = timeMs(row.updated_at_ms) ?? timeMs(row.created_at_ms) ?? 0;
  const taskActivityMs = taskMonitorActivityMs(task);
  return runningThreadRolloutRecheckMs(Math.max(rowActivityMs, taskActivityMs) || null, nowMs);
}

export function shouldInspectTaskRollout(task: AiTask, row: CodexThreadRow, threadId: string, nowMs = Date.now()): boolean {
  const cached = taskRolloutInspectCache.get(task.id);
  const fingerprint = taskRolloutInspectFingerprint(task, row, threadId);
  if (!cached) return true;
  if (cached.fingerprint !== fingerprint) return true;
  if (nowMs >= cached.nextInspectAt && isFastWatchTask(task)) {
    return true;
  }
  return nowMs >= cached.nextInspectAt;
}

export function markTaskRolloutInspected(
  task: AiTask,
  row: CodexThreadRow,
  threadId: string,
  running: boolean,
  nowMs = Date.now(),
): void {
  taskRolloutInspectCache.set(task.id, {
    fingerprint: taskRolloutInspectFingerprint(task, row, threadId),
    nextInspectAt: nowMs + taskRolloutRecheckMs(task, row, running, nowMs),
  });
  trimCacheToLimit(taskRolloutInspectCache, ROLLOUT_INSPECT_CACHE_LIMIT);
}

function scopeKey(scope: Pick<CodexThreadImportScope, 'project_id' | 'repo_path'>): string {
  return `${scope.project_id}\u001f${normalizeLocalPath(scope.repo_path)}`;
}

function prioritizeImportScopesForReconcile(scopes: CodexThreadImportScope[]): CodexThreadImportScope[] {
  return [...scopes].sort((left, right) => {
    const enabledDelta = (timeMs(right.enabled_since) ?? 0) - (timeMs(left.enabled_since) ?? 0);
    if (enabledDelta !== 0) return enabledDelta;
    return scopeKey(left).localeCompare(scopeKey(right));
  });
}

function linkedTaskForThread(
  row: CodexThreadRow,
  tasks: AiTask[],
  cwdScopeMap?: Map<string, CodexThreadImportScope>,
): AiTask | null {
  const direct = tasks.find(task => taskThreadId(task) === row.id);
  if (direct) return direct;

  const firstUserMessage = compactText(row.first_user_message ?? '', 8_000);
  if (!firstUserMessage || isInternalUserMessage(firstUserMessage)) return null;
  const rowCwd = normalizeLocalPath(row.cwd);

  return tasks.find(task => {
    if (task.executor !== 'codex_app') return false;
    if (!task.source_task_id) return false;
    if (taskThreadId(task)) return false;
    const result = taskResult(task);
    if (result.codex_manual_handoff !== true) return false;
    const taskCwd = normalizeLocalPath(task.cwd);
    if (rowCwd && taskCwd && !cwdMatchesTask(rowCwd, taskCwd, cwdScopeMap)) return false;
    if (!isThreadNearManualHandoffTime(row, task)) return false;
    return promptsLikelyMatch(task.prompt, firstUserMessage);
  }) ?? null;
}

function aiHistoryStatusForSummary(rawRollout: string, row: CodexThreadRow, summary: RolloutSummary): AiHistoryStatus {
  if (!rawRollout.trim()) return row.archived ? 'awaiting_approval' : 'idle';
  return summary.historyStatus;
}

function aiHistoryStaleRunningThresholdMs(row: CodexThreadRow): number {
  void row;
  return TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS;
}

function staleRunningAiHistoryEndedAt(input: {
  row: CodexThreadRow;
  summary: RolloutSummary;
  status: AiHistoryStatus;
  nowMs: number;
}): string | null {
  if (input.status !== 'running') return null;
  if (input.summary.threadArchived) return null;
  return staleRunningWithoutTerminalEventEndedAt(
    input.summary,
    input.nowMs,
    aiHistoryStaleRunningThresholdMs(input.row),
    timestampToIso(input.row.created_at_ms ?? null),
  );
}

function durationSecondsBetween(startedAt: string | null, endedAt: string | null): number | null {
  const startMs = timeMs(startedAt);
  const endMs = timeMs(endedAt);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return Math.floor((endMs - startMs) / 1000);
}

function aiHistoryCurrentRallyTiming(input: {
  summary: RolloutSummary;
  status: AiHistoryStatus;
  staleRunningEndedAt: string | null;
  nowMs: number;
}) {
  const activeTimerStartedAt = input.summary.activeTimerStartedAt ?? null;
  const completedTimerStartedAt = input.summary.timerStartedAt ?? input.summary.latestTaskStartedAt;
  const startedAt = input.status === 'running' || input.staleRunningEndedAt
    ? activeTimerStartedAt
    : completedTimerStartedAt;
  const endedAt = input.status === 'running'
    ? null
    : input.staleRunningEndedAt ?? input.summary.latestTaskCompleteAt;
  const elapsedEndAt = input.status === 'running'
    ? new Date(input.nowMs).toISOString()
    : endedAt;
  return {
    startedAt,
    endedAt,
    workDurationSeconds: durationSecondsBetween(startedAt, elapsedEndAt),
  };
}

export function aiHistoryPresentationForThread(input: {
  rawRollout: string;
  row: CodexThreadRow;
  summary: RolloutSummary;
  nowMs: number;
}): {
  status: AiHistoryStatus;
  runState: string;
  startedAt: string | null;
  endedAt: string | null;
  workDurationSeconds: number | null;
  runningDetectedAt: string | null;
  timerStartedAt: string | null;
  timerSource: CodexTimerSource;
  timerOffsetMs: number | null;
  staleRunning: boolean;
  staleRunningLastActivityAt: string | null;
  staleRunningThresholdMs: number | null;
} {
  const hasRollout = input.rawRollout.trim().length > 0;
  const baseStatus = aiHistoryStatusForSummary(input.rawRollout, input.row, input.summary);
  const staleRunningEndedAt = hasRollout
    ? staleRunningAiHistoryEndedAt({
      row: input.row,
      summary: input.summary,
      status: baseStatus,
      nowMs: input.nowMs,
    })
    : null;
  const status = staleRunningEndedAt ? 'awaiting_approval' : baseStatus;
  const timing = hasRollout
    ? aiHistoryCurrentRallyTiming({
      summary: input.summary,
      status,
      staleRunningEndedAt,
      nowMs: input.nowMs,
    })
    : { startedAt: null, endedAt: null, workDurationSeconds: null };
  return {
    status,
    runState: staleRunningEndedAt ? 'stale_no_terminal_event' : input.summary.reviewReason,
    startedAt: timing.startedAt,
    endedAt: timing.endedAt,
    workDurationSeconds: timing.workDurationSeconds,
    runningDetectedAt: status === 'running'
      ? input.summary.activeStartedAt ?? input.summary.runningDetectedAt
      : input.summary.runningDetectedAt,
    timerStartedAt: timing.startedAt,
    timerSource: timing.startedAt ? input.summary.timerSource : 'unknown',
    timerOffsetMs: timing.startedAt ? input.summary.timerOffsetMs : null,
    staleRunning: Boolean(staleRunningEndedAt),
    staleRunningLastActivityAt: staleRunningEndedAt,
    staleRunningThresholdMs: staleRunningEndedAt ? aiHistoryStaleRunningThresholdMs(input.row) : null,
  };
}

export function isAiHistoryPlaceholderTitle(value: string | null | undefined): boolean {
  const title = compactText(value ?? '', 300);
  return title === AI_HISTORY_PLACEHOLDER_TITLE || /^Codex thread [0-9a-z-]+$/iu.test(title);
}

export function aiHistoryTitle(
  row: CodexThreadRow,
  sessionThreadNames?: ReadonlyMap<string, string> | null,
): string {
  return aiHistoryTitleInfo(row, sessionThreadNames).title;
}

function aiHistorySnippet(row: CodexThreadRow): string | null {
  const preview = compactText(row.preview ?? '', 500);
  return preview || null;
}

function aiHistoryItemCacheKey(item: AiHistoryBatchUpsertItem): string {
  return [
    item.provider ?? AI_HISTORY_PROVIDER,
    normalizeLocalPath(item.repoPath),
    item.externalThreadId,
  ].join('\u001f');
}

function aiHistoryItemHash(item: AiHistoryBatchUpsertItem): string {
  const durationHash = item.status === 'running' && typeof item.workDurationSeconds === 'number'
    ? Math.floor(item.workDurationSeconds / 60)
    : item.workDurationSeconds ?? null;
  return JSON.stringify({
    provider: item.provider ?? AI_HISTORY_PROVIDER,
    externalThreadId: item.externalThreadId,
    repoPath: normalizeLocalPath(item.repoPath),
    worktreePath: normalizeLocalPath(item.worktreePath),
    projectId: item.projectId ?? null,
    sourceTaskId: item.sourceTaskId ?? null,
    linkedAiTaskId: item.linkedAiTaskId ?? null,
    title: item.title ?? null,
    snippet: item.snippet ?? null,
    status: item.status ?? null,
    runState: item.runState ?? null,
    lastActivityAt: item.lastActivityAt ?? null,
    startedAt: item.startedAt ?? null,
    endedAt: item.endedAt ?? null,
    durationHash,
    archived: item.archived ?? null,
    archivedAt: item.archivedAt ?? null,
    detailSyncedAt: item.detailSyncedAt ?? null,
    detailMessageCount: item.detailMessageCount ?? null,
  });
}

function withoutRunningVolatileFields(hash: string): string {
  try {
    const parsed = JSON.parse(hash) as Record<string, unknown>;
    parsed.lastActivityAt = null;
    parsed.durationHash = null;
    return JSON.stringify(parsed);
  } catch {
    return hash
      .replace(/"lastActivityAt":"[^"]*"/u, '"lastActivityAt":null')
      .replace(/"durationHash":(?:\d+|null)/u, '"durationHash":null');
  }
}

function shouldQueueAiHistoryItem(prepared: PreparedAiHistoryItem): boolean {
  const cached = aiHistorySyncCache.get(prepared.cacheKey);
  if (!cached) return true;
  if (cached.hash === prepared.hash) return false;
  if (
    prepared.running &&
    cached.running &&
    Date.now() - cached.sentAt < AI_HISTORY_RUNNING_DURATION_WRITE_INTERVAL_MS
  ) {
    if (withoutRunningVolatileFields(cached.hash) === withoutRunningVolatileFields(prepared.hash)) return false;
  }
  return true;
}

function updateAiHistoryPlaceholderTitleWatch(prepared: PreparedAiHistoryItem, nowMs = Date.now()): void {
  const externalThreadId = typeof prepared.item.externalThreadId === 'string' ? prepared.item.externalThreadId : '';
  const scope = {
    project_id: typeof prepared.item.projectId === 'string' ? prepared.item.projectId : '',
    repo_path: typeof prepared.item.repoPath === 'string' ? prepared.item.repoPath : '',
  };
  if (!externalThreadId || !scope.project_id || !scope.repo_path) return;
  const titleSource = prepared.item.metadata?.title_source;
  if (isAiHistoryPlaceholderTitle(prepared.item.title ?? null) || titleSource === 'prompt_fallback') {
    markAiHistoryPlaceholderTitleWatch({ id: externalThreadId }, scope, nowMs);
  } else {
    clearAiHistoryPlaceholderTitleWatch({ id: externalThreadId }, scope);
  }
}

function aiHistoryItemFromThread(input: {
  row: CodexThreadRow;
  scope: CodexThreadImportScope;
  summary: RolloutSummary;
  rawRollout: string;
  linkedTask: AiTask | null;
  sessionThreadNames?: ReadonlyMap<string, string> | null;
  nowMs: number;
}): PreparedAiHistoryItem {
  const repoPath = normalizeLocalPath(input.scope.repo_path);
  const cwd = normalizeLocalPath(input.row.cwd);
  const worktreePath = cwd && cwd !== repoPath ? cwd : null;
  const hasRollout = input.rawRollout.trim().length > 0;
  const presentation = aiHistoryPresentationForThread(input);
  const status = presentation.status;
  const lastActivityAt = latestIso(
    input.summary.lastActivityAt,
    input.summary.threadUpdatedAt,
    input.row.updated_at_ms,
    input.row.created_at_ms,
  ) ?? new Date(input.nowMs).toISOString();
  const startedAt = presentation.startedAt;
  const endedAt = presentation.endedAt;
  const workDurationSeconds = presentation.workDurationSeconds;
  const archived = shouldArchiveAiHistoryThread(input.row);
  const threadSource = typeof input.row.thread_source === 'string' && input.row.thread_source.trim()
    ? input.row.thread_source.trim()
    : 'user';
  const titleInfo = aiHistoryTitleInfo(input.row, input.sessionThreadNames);
  const item: AiHistoryBatchUpsertItem = {
    provider: AI_HISTORY_PROVIDER,
    externalThreadId: input.row.id,
    repoPath,
    worktreePath,
    projectId: input.scope.project_id,
    sourceTaskId: input.linkedTask?.source_task_id ?? null,
    linkedAiTaskId: input.linkedTask?.id ?? null,
    title: titleInfo.title,
    snippet: aiHistorySnippet(input.row),
    status,
    runState: presentation.runState,
    lastActivityAt,
    startedAt,
    endedAt,
    workDurationSeconds,
    archived,
    archivedAt: archived ? lastActivityAt : null,
    metadata: {
      source: 'codex_state_sqlite',
      metadata_only: true,
      rollout_state: presentation.runState,
      rollout_present: hasRollout,
      stale_running: presentation.staleRunning,
      stale_running_last_activity_at: presentation.staleRunningLastActivityAt,
      stale_running_threshold_ms: presentation.staleRunningThresholdMs,
      codex_running_detected_at: presentation.runningDetectedAt,
      codex_timer_started_at: presentation.timerStartedAt,
      codex_timer_source: presentation.timerSource,
      codex_timer_offset_ms: presentation.timerOffsetMs,
      title_source: titleInfo.source,
      thread_source: threadSource,
      duration_approximate: !hasRollout && workDurationSeconds !== null,
      thread_updated_at_ms: input.row.updated_at_ms ?? null,
      thread_created_at_ms: input.row.created_at_ms ?? null,
      scope_project_id: input.scope.project_id,
      scope_repo_path: repoPath,
      worktree_path: worktreePath,
    },
  };
  const hash = aiHistoryItemHash(item);
  return {
    item,
    hash,
    cacheKey: aiHistoryItemCacheKey(item),
    rolloutInspectKey: aiHistoryRolloutInspectKey(input.row, input.scope),
    rolloutFingerprint: threadRolloutFingerprint(input.row),
    rolloutRecheckMs: aiHistoryRolloutRecheckMs(input.row, status === 'running', input.nowMs),
    running: status === 'running',
    detailMessages: aiHistoryDetailMessages(input.row, input.summary),
    detailSyncedAt: aiHistoryDetailSyncedAt(input.row, input.summary),
  };
}

function aiHistoryScopePayload(
  scope: CodexThreadImportScope,
  scannedAt: string,
  reconciledAt: string | null,
): AiHistoryBatchUpsertScope | null {
  const projectId = typeof scope.project_id === 'string' ? scope.project_id.trim() : '';
  const repoPath = normalizeLocalPath(scope.repo_path);
  if (!projectId || !repoPath) return null;
  return {
    projectId,
    provider: AI_HISTORY_PROVIDER,
    repoPath,
    syncEnabled: true,
    lastScannedAt: scannedAt,
    lastReconciledAt: reconciledAt,
    settings: {
      source: 'codex_monitor_import_scopes',
      enabled_since: scope.enabled_since ?? null,
    },
  };
}

function taskHandoffToken(task: AiTask): string | null {
  const result = isRecord(task.result) ? task.result : {};
  const resultToken = result.codex_handoff_token;
  if (typeof resultToken === 'string' && resultToken.trim()) return resultToken.trim();
  const match = task.prompt.match(/Focusmap同期ID:\s*(FM-[A-Za-z0-9._:-]+)/);
  return match?.[1]?.trim() || null;
}

async function findMatchingThread(dbPath: string, task: AiTask): Promise<string | null> {
  const startedMs = timeMs(task.started_at) ?? timeMs(task.created_at) ?? Date.now();
  const sinceMs = Math.max(0, startedMs - 60_000);
  const token = taskHandoffToken(task);
  const cwd = task.cwd?.trim();
  const cwdCondition = cwd ? ` AND cwd = ${sqlString(cwd)}` : '';
  const candidates: string[] = [];

  if (token) {
    const tokenCondition = `first_user_message LIKE ${sqlString(`%Focusmap同期ID: ${token}%`)} AND updated_at_ms >= ${sinceMs}`;
    if (cwdCondition) candidates.push(`${tokenCondition}${cwdCondition}`);
    candidates.push(tokenCondition);
  }

  const promptPrefix = task.prompt.slice(0, 60).trim();
  if (promptPrefix) {
    const prefixCondition = `first_user_message LIKE ${sqlString(`${promptPrefix}%`)} AND updated_at_ms >= ${sinceMs}`;
    if (cwdCondition) candidates.push(`${prefixCondition}${cwdCondition}`);
    candidates.push(prefixCondition);
  }

  for (const where of candidates) {
    const rows = await sqliteJson<{ id: string }>(
      dbPath,
      `SELECT id FROM threads WHERE ${where} ORDER BY created_at_ms DESC LIMIT 1`,
    );
    if (rows[0]?.id) return rows[0].id;
  }

  return null;
}

function taskResult(task: AiTask): Record<string, unknown> {
  return isRecord(task.result) ? task.result : {};
}

function codexRunState(task: AiTask): string {
  const state = taskResult(task).codex_run_state;
  return typeof state === 'string' ? state : '';
}

function taskMonitorActivityMs(task: AiTask): number {
  const result = taskResult(task);
  return Math.max(
    timeMs(result.last_activity_at) ?? 0,
    timeMs(result.awaiting_approval_at) ?? 0,
    timeMs(task.completed_at) ?? 0,
    timeMs(task.started_at) ?? 0,
    timeMs(task.created_at) ?? 0,
  );
}

function importedThreadSourceTitleSuggestion(task: AiTask, row: CodexThreadRow): string | null {
  if (!task.source_task_id) return null;
  return codexThreadGeneratedTitle(row);
}

function shouldBackfillImportedThreadMessages(task: AiTask): boolean {
  const result = taskResult(task);
  if (result.codex_external_origin !== 'codex_app_thread_import') return false;
  return !Array.isArray(result.codex_visible_messages) || result.codex_visible_messages.length === 0;
}

export function hasPendingArchiveRequest(task: AiTask): boolean {
  const result = taskResult(task);
  const hasSourceTaskArchive = result.codex_source_task_completed === true &&
    result.codex_source_task_completion_suppressed !== true;
  const hasAiHistoryArchive = result.codex_archive_request_reason === AI_HISTORY_ARCHIVE_REQUEST_REASON &&
    (typeof result.codex_history_item_id === 'string' || typeof result.ai_history_item_id === 'string');
  const lastAttemptedMs = timeMs(result.codex_archive_last_attempted_at);
  const retryDue = lastAttemptedMs === null || Date.now() - lastAttemptedMs >= CODEX_ARCHIVE_RETRY_INTERVAL_MS;
  return task.status === 'completed' &&
    result.codex_archive_request_state === 'pending' &&
    typeof result.codex_archive_requested_at === 'string' &&
    result.codex_archive_requested_at.trim().length > 0 &&
    result.codex_archive_request_cancelled_at == null &&
    result.codex_archive_completed_at == null &&
    retryDue &&
    (hasSourceTaskArchive || hasAiHistoryArchive);
}

export function shouldCompleteSourceFromArchivedThread(task: AiTask): boolean {
  const result = taskResult(task);
  return hasPendingArchiveRequest(task) &&
    !!task.source_task_id &&
    result.codex_source_task_completion_suppressed !== true;
}

function codexMonitorTaskPriority(task: AiTask): number {
  const state = codexRunState(task);
  if (task.status === 'running' || state === 'running') return 0;
  if (task.status === 'awaiting_approval' || state === 'awaiting_approval') return 1;
  if (task.status === 'needs_input' || state === 'prompt_waiting') return 1;
  if (hasPendingArchiveRequest(task)) return 1;
  if (taskThreadId(task)) return 2;
  if (task.status === 'pending') return 3;
  return 4;
}

function isRunningCodexMonitorTask(task: AiTask): boolean {
  const state = codexRunState(task);
  return task.status === 'running' || state === 'running';
}

function isFastWatchTask(task: AiTask): boolean {
  const state = codexRunState(task);
  return task.status === 'running' ||
    task.status === 'awaiting_approval' ||
    task.status === 'needs_input' ||
    state === 'running' ||
    state === 'awaiting_approval' ||
    state === 'needs_input' ||
    state === 'prompt_waiting' ||
    hasPendingArchiveRequest(task);
}

function shouldSyncBeforeOrphanImport(task: AiTask): boolean {
  return codexMonitorTaskPriority(task) <= 1;
}

export function prioritizeCodexMonitorTasks(tasks: AiTask[]): AiTask[] {
  return [...tasks].sort((left, right) => {
    const priorityDelta = codexMonitorTaskPriority(left) - codexMonitorTaskPriority(right);
    if (priorityDelta !== 0) return priorityDelta;
    const activityDelta = taskMonitorActivityMs(right) - taskMonitorActivityMs(left);
    if (activityDelta !== 0) return activityDelta;
    return left.id.localeCompare(right.id);
  });
}

export function preImportCodexMonitorTasks(tasks: AiTask[], limit = PRE_IMPORT_SYNC_LIMIT): AiTask[] {
  return prioritizeCodexMonitorTasks(tasks)
    .filter(shouldSyncBeforeOrphanImport)
    .slice(0, Math.max(1, limit));
}

export function shouldDeferOrphanImportForTasks(tasks: AiTask[]): boolean {
  return tasks.some(isRunningCodexMonitorTask);
}

export function orphanImportLimitForPreImportTasks(tasks: AiTask[]): number {
  return shouldDeferOrphanImportForTasks(tasks) ? RUNNING_HOT_ORPHAN_IMPORT_LIMIT : ORPHAN_IMPORT_LIMIT;
}

function checkpointMs(task: AiTask): number | null {
  const result = taskResult(task);
  const candidates = task.status === 'awaiting_approval' || task.status === 'needs_input'
    ? [result.awaiting_approval_at, result.last_activity_at, task.completed_at, task.started_at, task.created_at]
    : [result.last_activity_at, task.started_at, task.created_at];
  for (const value of candidates) {
    const ms = timeMs(value);
    if (ms !== null) return ms;
  }
  return null;
}

function wasWaitingForReview(task: AiTask): boolean {
  const result = taskResult(task);
  const state = typeof result.codex_run_state === 'string' ? result.codex_run_state : '';
  return task.status === 'awaiting_approval' ||
    task.status === 'completed' ||
    state === 'awaiting_approval';
}

function didResumeAfterCheckpoint(task: AiTask, summary: RolloutSummary): boolean {
  if (!wasWaitingForReview(task)) return false;
  const checkpoint = checkpointMs(task);
  if (checkpoint === null) return false;
  const candidates = [
    timeMs(summary.latestUserMessageAt),
    timeMs(summary.latestTaskStartedAt),
    timeMs(summary.latestRunningActivityAt),
  ].filter((value): value is number => value !== null);
  return candidates.some(value => value > checkpoint);
}

function awaitingApprovalSignalStable(summary: RolloutSummary, nowMs: number): boolean {
  if (summary.state !== 'awaiting_approval') return true;
  const completeMs = timeMs(summary.latestTaskCompleteAt);
  if (completeMs === null) return true;
  const latestRunningMs = Math.max(
    timeMs(summary.latestUserMessageAt) ?? 0,
    timeMs(summary.latestTaskStartedAt) ?? 0,
    timeMs(summary.latestRunningActivityAt) ?? 0,
  );
  if (latestRunningMs > completeMs) return false;

  // Codex may update thread.updated_at_ms while building sidebar titles/summaries after a turn is done.
  // That metadata update should affect sorting/display time, not keep the run in "running".
  return nowMs - completeMs >= AWAITING_APPROVAL_STABILITY_MS;
}

function staleRunningWithoutTerminalEventEndedAt(
  summary: RolloutSummary,
  nowMs: number,
  thresholdMs = TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS,
  fallbackStartedAt: string | null = null,
): string | null {
  if (summary.state !== 'running') return null;
  if (summary.threadArchived) return null;

  const explicitRunningMs = Math.max(
    timeMs(summary.latestRunningActivityAt) ?? 0,
    timeMs(summary.latestTaskStartedAt) ?? 0,
    timeMs(summary.latestUserMessageAt) ?? 0,
    timeMs(summary.activeStartedAt) ?? 0,
    timeMs(summary.startedAt) ?? 0,
  );
  const latestRunningMs = explicitRunningMs > 0 ? explicitRunningMs : timeMs(fallbackStartedAt) ?? 0;
  if (latestRunningMs <= 0) return null;
  if (nowMs - latestRunningMs < thresholdMs) return null;
  return new Date(latestRunningMs).toISOString();
}

function taskStaleRunningFallbackAt(task: AiTask): string | null {
  return latestIso(task.started_at, task.created_at);
}

function staleRunningTaskEndedAt(task: AiTask, summary: RolloutSummary, nowMs: number): string | null {
  return staleRunningWithoutTerminalEventEndedAt(
    summary,
    nowMs,
    TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS,
    taskStaleRunningFallbackAt(task),
  );
}

function staleRunningTaskWithoutTerminalEvent(task: AiTask, summary: RolloutSummary, nowMs: number): boolean {
  return Boolean(staleRunningTaskEndedAt(task, summary, nowMs));
}

export function taskStateForSummary(task: AiTask, summary: RolloutSummary, nowMs = Date.now()) {
  const resumed = didResumeAfterCheckpoint(task, summary);
  if (resumed) {
    const resumeMs = Math.max(
      timeMs(summary.latestUserMessageAt) ?? 0,
      timeMs(summary.latestTaskStartedAt) ?? 0,
      timeMs(summary.latestRunningActivityAt) ?? 0,
    );
    const completedMs = timeMs(summary.latestTaskCompleteAt) ?? 0;
    if (completedMs >= resumeMs) {
      const recentlyResumed = resumeMs > 0 && nowMs - resumeMs <= RESUME_RUNNING_VISIBILITY_MS;
      if (recentlyResumed || !awaitingApprovalSignalStable(summary, nowMs)) {
        return { status: 'running' as const, resumed: true };
      }
      return { status: 'awaiting_approval' as const, resumed: true };
    }
    if (staleRunningTaskWithoutTerminalEvent(task, summary, nowMs)) {
      return { status: 'awaiting_approval' as const, resumed: false };
    }
    return { status: 'running' as const, resumed: true };
  }
  if (staleRunningTaskWithoutTerminalEvent(task, summary, nowMs)) {
    return { status: 'awaiting_approval' as const, resumed: false };
  }
  if (task.status === 'running' && summary.state === 'awaiting_approval' && !awaitingApprovalSignalStable(summary, nowMs)) {
    return { status: 'running' as const, resumed: false };
  }
  if (wasWaitingForReview(task) && summary.state === 'running') {
    return { status: 'awaiting_approval' as const, resumed: false };
  }
  return { status: summary.state === 'awaiting_approval' ? 'awaiting_approval' as const : 'running' as const, resumed: false };
}

export function awaitingApprovalAtForSummary(
  result: Record<string, unknown>,
  summary: RolloutSummary,
  nowIso: string,
): string {
  const previous = typeof result.awaiting_approval_at === 'string'
    ? result.awaiting_approval_at
    : null;
  const latestCompleteAt = summary.latestTaskCompleteAt;
  if (latestCompleteAt) {
    const previousMs = timeMs(previous);
    const completeMs = timeMs(latestCompleteAt);
    if (completeMs !== null && (previousMs === null || completeMs > previousMs)) {
      return latestCompleteAt;
    }
  }
  return previous ?? nowIso;
}

type ActivitySyncBatch = {
  messages: AgentActivityMessage[];
  syncedSequence: number | null;
  syncedAt: string | null;
  complete: boolean;
}

function activitySyncedSequence(task: AiTask): number | null {
  const result = taskResult(task);
  const value = result.codex_activity_synced_sequence;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function activityFallbackCheckpointMs(task: AiTask): number {
  const result = taskResult(task);
  if (activitySyncedSequence(task) !== null) return 0;
  if (result.codex_activity_backfill_complete === true) return checkpointMs(task) ?? 0;
  if (shouldBackfillImportedThreadMessages(task)) return 0;
  return 0;
}

function activitySyncBatch(task: AiTask, threadId: string, summary: RolloutSummary, resumed: boolean): ActivitySyncBatch {
  const syncedSequence = activitySyncedSequence(task);
  const fallbackCheckpoint = activityFallbackCheckpointMs(task);
  const messages: AgentActivityMessage[] = [];
  if (resumed) {
    messages.push({
      role: 'status',
      kind: 'resumed',
      body: '確認待ち後の追加プロンプトを検知しました。Codex実行を再開します。',
      importance: 'important',
      dedupe_key: `thread:${threadId}:resumed:${syncedSequence ?? fallbackCheckpoint}`,
    });
  }

  const room = Math.max(0, MAX_ACTIVITY_MESSAGES_PER_UPDATE - messages.length);
  const candidates = summary.visibleMessages.filter(message => {
    if (syncedSequence !== null) return message.sequence > syncedSequence;
    const messageMs = timeMs(message.createdAt) ?? 0;
    return messageMs > fallbackCheckpoint;
  });
  const selected = candidates.slice(0, room);

  for (const message of selected) {
    messages.push({
      role: message.role,
      kind: message.kind,
      body: message.body,
      importance: message.kind === 'progress' ? 'normal' : 'important',
      created_at: message.createdAt ?? undefined,
      dedupe_key: `thread:${threadId}:${message.sequence}:${message.role}:${message.kind}:${textFingerprint(message.body)}`,
      metadata: {
        source: 'codex_thread_monitor',
        source_event: message.sourceEvent,
        ...visibleMessageTurnMetadata(message),
      },
    });
  }

  const lastSelected = selected.at(-1);
  return {
    messages,
    syncedSequence: lastSelected?.sequence ?? syncedSequence,
    syncedAt: lastSelected?.createdAt ?? null,
    complete: selected.length >= candidates.length,
  };
}

export function activityMessages(task: AiTask, threadId: string, summary: RolloutSummary, resumed: boolean): AgentActivityMessage[] {
  return activitySyncBatch(task, threadId, summary, resumed).messages;
}

function aiHistoryDetailKindForVisibleMessage(message: VisibleMessage): AiHistoryDetailMessage['kind'] {
  if (message.role === 'user') return 'user_prompt';
  if (message.kind === 'question') return 'assistant_question';
  return 'assistant_answer';
}

function aiHistoryDetailMessageFromVisible(message: VisibleMessage): AiHistoryDetailMessage {
  return {
    sequence: message.sequence,
    role: message.role === 'user' ? 'user' : 'assistant',
    kind: aiHistoryDetailKindForVisibleMessage(message),
    body: compactText(message.body, MAX_ACTIVITY_BODY_CHARS),
    occurred_at: message.createdAt,
    metadata: {
      source: 'codex_thread_monitor',
      source_event: message.sourceEvent,
      ...visibleMessageTurnMetadata(message),
    },
  };
}

export function aiHistoryDetailMessages(row: CodexThreadRow, summary: RolloutSummary): AiHistoryDetailMessage[] {
  const messages = summary.visibleMessages
    .map(aiHistoryDetailMessageFromVisible)
    .filter(message => message.body.length > 0);
  const hasUserPrompt = messages.some(message => message.role === 'user');
  const firstUserMessage = compactText(row.first_user_message ?? '', MAX_ACTIVITY_BODY_CHARS);
  if (!hasUserPrompt && firstUserMessage && !isInternalUserMessage(firstUserMessage)) {
    messages.unshift({
      sequence: 0,
      role: 'user',
      kind: 'user_prompt',
      body: firstUserMessage,
      occurred_at: timestampToIso(row.created_at_ms ?? row.updated_at_ms),
      metadata: {
        source: 'codex_state_sqlite',
        source_event: 'first_user_message',
      },
    });
  }

  const hasAssistantAnswer = messages.some(message => message.role === 'assistant');
  if (!hasAssistantAnswer && summary.latestAgentMessage) {
    messages.push({
      sequence: Math.max(1, ...messages.map(message => message.sequence)) + 1,
      role: 'assistant',
      kind: looksLikeQuestion(summary.latestAgentMessage) ? 'assistant_question' : 'assistant_answer',
      body: compactText(summary.latestAgentMessage, MAX_ACTIVITY_BODY_CHARS),
      occurred_at: summary.latestTaskCompleteAt ?? summary.lastActivityAt,
      metadata: {
        source: 'codex_thread_monitor',
        source_event: 'latest_agent_message',
      },
    });
  }

  return messages
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, MAX_AI_HISTORY_DETAIL_MESSAGES_PER_POST);
}

function aiHistoryDetailSyncedAt(row: CodexThreadRow, summary: RolloutSummary): string | null {
  return latestIso(summary.lastActivityAt, summary.threadUpdatedAt, row.updated_at_ms, row.created_at_ms);
}

function aiHistoryDetailMessagesHash(messages: AiHistoryDetailMessage[]): string {
  return JSON.stringify(messages.map(message => ({
    sequence: message.sequence,
    role: message.role,
    kind: message.kind,
    body: message.body,
    occurred_at: message.occurred_at ?? null,
    metadata: message.metadata ?? null,
  })));
}

function resultSnapshot(
  task: AiTask,
  threadId: string,
  row: CodexThreadRow,
  summary: RolloutSummary,
  status: AiTask['status'],
  resumed: boolean,
  activityBatch: ActivitySyncBatch,
): TaskResultJson {
  const result = taskResult(task);
  const nowIso = new Date().toISOString();
  const staleRunningEndedAt = status === 'awaiting_approval'
    ? staleRunningTaskEndedAt(task, summary, Date.now())
    : null;
  const lastActivityAt = latestIso(summary.lastActivityAt, summary.threadUpdatedAt, row.updated_at_ms) ?? nowIso;
  const codexRunningDetectedAt = status === 'running'
    ? summary.activeStartedAt ?? summary.runningDetectedAt
    : summary.runningDetectedAt;
  const codexTimerStartedAt = status === 'running'
    ? summary.activeTimerStartedAt
    : summary.timerStartedAt ?? summary.latestTaskStartedAt;
  const codexTimerSource: CodexTimerSource = codexTimerStartedAt ? summary.timerSource : 'unknown';
  const codexTimerOffsetMs = codexTimerStartedAt ? summary.timerOffsetMs : null;
  const currentStep = status === 'running' && summary.state === 'awaiting_approval'
    ? 'Codexの実行状態を確認中'
    : summary.currentStep;
  const codexExternalOrigin = typeof result.codex_external_origin === 'string' ? result.codex_external_origin : undefined;
  const sourceTaskTitleSuggestion = importedThreadSourceTitleSuggestion(task, row);
  const previousSyncedSequence = typeof result.codex_activity_synced_sequence === 'number'
    ? result.codex_activity_synced_sequence
    : null;
  const previousSyncedAt = typeof result.codex_activity_synced_at === 'string'
    ? result.codex_activity_synced_at
    : null;
  return {
    executor: task.executor === 'codex' ? 'codex' : 'codex_app',
    steps: Array.isArray(result.steps) ? result.steps as TaskResultJson['steps'] : [],
    output: '',
    message: status === 'running'
      ? 'Codex側の追加プロンプトを検知し、実行中です。'
      : 'Codex セッションは確認待ちです。内容を確認してください。',
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_external_origin: codexExternalOrigin,
    codex_run_state: status === 'running'
      ? 'running'
      : staleRunningEndedAt
        ? 'stale_no_terminal_event'
        : 'awaiting_approval',
    codex_review_reason: status === 'running'
      ? 'started'
      : staleRunningEndedAt
        ? 'monitoring_lost'
        : summary.reviewReason,
    codex_thread_archived: Boolean(row.archived),
    codex_source_task_id: typeof result.codex_source_task_id === 'string'
      ? result.codex_source_task_id
      : task.source_task_id ?? null,
    current_step: currentStep,
    last_activity_at: lastActivityAt,
    codex_turn_started_at: codexTimerStartedAt ?? undefined,
    codex_turn_completed_at: summary.latestTaskCompleteAt ?? undefined,
    codex_running_detected_at: codexRunningDetectedAt ?? undefined,
    codex_timer_started_at: codexTimerStartedAt ?? undefined,
    codex_timer_source: codexTimerSource,
    codex_timer_offset_ms: codexTimerOffsetMs,
    awaiting_approval_at: status === 'awaiting_approval'
      ? staleRunningEndedAt ?? awaitingApprovalAtForSummary(result, summary, nowIso)
      : undefined,
    codex_visible_messages: activityBatch.messages.slice(-MAX_ACTIVITY_MESSAGES_PER_UPDATE),
    codex_activity_synced_sequence: activityBatch.syncedSequence ?? previousSyncedSequence,
    codex_activity_synced_at: activityBatch.syncedAt ?? previousSyncedAt,
    codex_activity_visible_count: summary.visibleMessages.length,
    codex_activity_backfill_complete: activityBatch.complete,
    meta: {
      monitor: 'focusmap-agent',
      thread_title: row.title ?? null,
      source_task_title: sourceTaskTitleSuggestion ?? undefined,
      thread_updated_at_ms: row.updated_at_ms ?? null,
      thread_archived: Boolean(row.archived),
      codex_running_detected_at: codexRunningDetectedAt,
      codex_timer_started_at: codexTimerStartedAt,
      codex_timer_source: codexTimerSource,
      codex_timer_offset_ms: codexTimerOffsetMs,
      stale_running: Boolean(staleRunningEndedAt),
      stale_running_last_activity_at: staleRunningEndedAt,
      stale_running_threshold_ms: staleRunningEndedAt ? TASK_STALE_RUNNING_NO_TERMINAL_EVENT_MS : null,
      preview_chars: typeof row.preview === 'string' ? row.preview.length : 0,
    },
  };
}

async function readRollout(row: CodexThreadRow): Promise<string> {
  if (!row.rollout_path) return '';
  const cached = rolloutReadCache.get(row.rollout_path);
  let fileStat: Stats;
  try {
    fileStat = await stat(row.rollout_path);
  } catch {
    rolloutReadCache.delete(row.rollout_path);
    return '';
  }

  if (!fileStat.isFile()) {
    rolloutReadCache.delete(row.rollout_path);
    return '';
  }

  if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.raw;
  }

  try {
    const raw = await readFile(row.rollout_path, 'utf-8');
    rolloutReadCache.set(row.rollout_path, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      raw,
    });
    if (rolloutReadCache.size > ROLLOUT_READ_CACHE_LIMIT) {
      const oldestKey = rolloutReadCache.keys().next().value;
      if (oldestKey) rolloutReadCache.delete(oldestKey);
    }
    return raw;
  } catch {
    return cached?.raw ?? '';
  }
}

function rolloutSummaryCacheKey(row: CodexThreadRow): string {
  return [
    row.id,
    threadRolloutFingerprint(row),
  ].join('\u001f');
}

export async function summarizeRollout(row: CodexThreadRow): Promise<{ rawRollout: string; summary: RolloutSummary }> {
  const cacheKey = rolloutSummaryCacheKey(row);
  const cached = rolloutSummaryCache.get(cacheKey);
  if (cached) return cached;
  const rawRollout = await readRollout(row);
  const summary = parseRollout(rawRollout, row);
  const result = { rawRollout, summary };
  rolloutSummaryCache.set(cacheKey, result);
  trimCacheToLimit(rolloutSummaryCache, ROLLOUT_INSPECT_CACHE_LIMIT);
  return result;
}

function importScopeRepoPaths(importScopes: CodexThreadImportScope[]): string[] {
  return Array.from(new Set(importScopes.map(scope => normalizeLocalPath(scope.repo_path)).filter(Boolean)));
}

function parseGitWorktreePaths(output: string): string[] {
  return output
    .split('\n')
    .map(line => line.startsWith('worktree ') ? normalizeLocalPath(line.slice('worktree '.length)) : '')
    .filter(Boolean);
}

async function gitWorktreePaths(repoPath: string): Promise<string[]> {
  const normalizedRepoPath = normalizeLocalPath(repoPath);
  if (!normalizedRepoPath) return [];
  const cached = worktreePathCache.get(normalizedRepoPath);
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.paths;

  const paths = new Set<string>([normalizedRepoPath]);
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', normalizedRepoPath, 'worktree', 'list', '--porcelain'],
      { timeout: 3_000 },
    );
    for (const path of parseGitWorktreePaths(stdout)) paths.add(path);
  } catch {
    debug(`codex import scope worktree lookup skipped repo=${normalizedRepoPath}`);
  }

  const result = [...paths];
  worktreePathCache.set(normalizedRepoPath, {
    expiresAt: now + WORKTREE_PATH_CACHE_TTL_MS,
    paths: result,
  });
  return result;
}

async function importScopeCwdMap(importScopes: CodexThreadImportScope[]): Promise<Map<string, CodexThreadImportScope>> {
  const entries = new Map<string, CodexThreadImportScope>();
  for (const scope of importScopes) {
    const repoPath = normalizeLocalPath(scope.repo_path);
    if (!repoPath) continue;
    const paths = await gitWorktreePaths(repoPath);
    for (const path of paths) {
      if (!entries.has(path)) entries.set(path, scope);
    }
  }
  return entries;
}

async function importScopeHeartbeatScopes(importScopes: CodexThreadImportScope[]): Promise<CodexThreadImportScopeHeartbeat[]> {
  const results: CodexThreadImportScopeHeartbeat[] = [];
  for (const scope of importScopes) {
    const repoPath = normalizeLocalPath(scope.repo_path);
    const projectId = typeof scope.project_id === 'string' ? scope.project_id.trim() : '';
    if (!repoPath || !projectId) continue;
    results.push({
      project_id: projectId,
      repo_path: repoPath,
      enabled_since: typeof scope.enabled_since === 'string' ? scope.enabled_since : null,
      cwd_paths: await gitWorktreePaths(repoPath),
    });
  }
  return results;
}

async function readRecentThreads(
  dbPath: string,
  sinceMs: number,
  repoPaths: string[] = [],
  limit = ORPHAN_IMPORT_SCAN_LIMIT,
): Promise<CodexThreadRow[]> {
  const cwdCondition = repoPaths.length > 0
    ? ` AND cwd IN (${repoPaths.map(sqlString).join(', ')})`
    : '';
  const safeLimit = Math.max(1, Math.min(1_000, Math.floor(limit)));
  return sqliteJson<CodexThreadRow>(
    dbPath,
    [
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, created_at_ms, preview, rollout_path, source, thread_source, cwd, first_user_message',
      'FROM threads',
      `WHERE updated_at_ms >= ${Math.max(0, Math.floor(sinceMs))}${cwdCondition}`,
      'ORDER BY updated_at_ms DESC',
      `LIMIT ${safeLimit}`,
    ].join(' '),
  );
}

function compareThreadsByRecentActivity(left: CodexThreadRow, right: CodexThreadRow): number {
  const leftMs = timeMs(left.updated_at_ms) ?? timeMs(left.created_at_ms) ?? 0;
  const rightMs = timeMs(right.updated_at_ms) ?? timeMs(right.created_at_ms) ?? 0;
  if (leftMs !== rightMs) return rightMs - leftMs;
  return right.id.localeCompare(left.id);
}

export function aiHistoryHotSyncPreparedItemLimit(input: {
  maxItems: number;
  importScopeCount: number;
  includeAllCodexCwds: boolean;
}): number {
  const maxItems = Math.max(1, Math.floor(input.maxItems));
  const importScopeCount = Math.max(0, Math.floor(input.importScopeCount));
  const scopedWatchLimit = importScopeCount > 0
    ? AI_HISTORY_FAST_WATCH_LIMIT * importScopeCount
    : 0;
  const allCwdWatchLimit = input.includeAllCodexCwds ? AI_HISTORY_FAST_WATCH_LIMIT : 0;
  return Math.min(
    AI_HISTORY_HOT_SYNC_TOTAL_LIMIT,
    Math.max(maxItems, scopedWatchLimit + allCwdWatchLimit, AI_HISTORY_FAST_WATCH_LIMIT),
  );
}

export function mergeRecentThreadsForHotSync(...groups: CodexThreadRow[][]): CodexThreadRow[] {
  const rowsById = new Map<string, CodexThreadRow>();
  for (const group of groups) {
    for (const row of group) {
      if (row.id && !rowsById.has(row.id)) rowsById.set(row.id, row);
    }
  }
  return Array.from(rowsById.values()).sort(compareThreadsByRecentActivity);
}

async function readRecentThreadsByImportScope(
  dbPath: string,
  sinceMs: number,
  importScopes: CodexThreadImportScope[],
  perScopeLimit: number,
): Promise<CodexThreadRow[]> {
  const rowsById = new Map<string, CodexThreadRow>();
  const seenPathGroups = new Set<string>();

  for (const scope of importScopes) {
    const repoPath = normalizeLocalPath(scope.repo_path);
    if (!repoPath) continue;
    const scopePaths = await gitWorktreePaths(repoPath);
    const repoPaths = (scopePaths.length > 0 ? scopePaths : [repoPath])
      .map(normalizeLocalPath)
      .filter(Boolean)
      .sort();
    const pathGroupKey = repoPaths.join('\u001f');
    if (!pathGroupKey || seenPathGroups.has(pathGroupKey)) continue;
    seenPathGroups.add(pathGroupKey);

    const rows = await readRecentThreads(dbPath, sinceMs, repoPaths, perScopeLimit);
    for (const row of rows) {
      if (row.id && !rowsById.has(row.id)) rowsById.set(row.id, row);
    }
  }

  return Array.from(rowsById.values()).sort(compareThreadsByRecentActivity);
}

function aiHistoryScopesForRows(
  importScopes: CodexThreadImportScope[],
  rows: CodexThreadRow[],
  cwdScopeMap: Map<string, CodexThreadImportScope>,
): CodexThreadImportScope[] {
  const scopes: CodexThreadImportScope[] = [...importScopes];
  const seenRepoPaths = new Set(importScopes
    .map(scope => normalizeLocalPath(scope.repo_path))
    .filter(Boolean));

  for (const row of rows) {
    const cwd = normalizeLocalPath(row.cwd);
    if (!cwd || seenRepoPaths.has(cwd) || cwdScopeMap.has(cwd)) continue;
    seenRepoPaths.add(cwd);
    scopes.push({
      project_id: '',
      repo_path: cwd,
      enabled_since: null,
    });
  }

  return scopes;
}

function importScopeSignature(importScopes: CodexThreadImportScope[]): string {
  return importScopes
    .map(scope => [
      scope.project_id,
      normalizeLocalPath(scope.repo_path),
      scope.enabled_since ?? '',
    ].join(':'))
    .sort()
    .join('|');
}

async function listThreadImportScopes(
  api: AgentApiClient,
  runnerId: string,
): Promise<CodexThreadImportScope[]> {
  const now = Date.now();
  if (now < importScopesApiUnavailableUntil) return [];
  try {
    return await api.listCodexThreadImportScopes(runnerId);
  } catch (error) {
    if (isOrphanImportApiUnavailable(error)) {
      importScopesApiUnavailableUntil = Date.now() + ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS;
      updateCodexThreadMonitorHeartbeatState({
        last_scope_refresh_at: new Date().toISOString(),
        last_scope_refresh_error: `api_unavailable:${error.status}`,
        scopes: [],
      });
      info(`codex import scopes API unavailable status=${error.status}; pausing orphan import for ${Math.round(ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS / 1000)}s`);
      return [];
    }
    updateCodexThreadMonitorHeartbeatState({
      last_scope_refresh_at: new Date().toISOString(),
      last_scope_refresh_error: error instanceof Error ? error.message : String(error),
      scopes: [],
    });
    logError('codex import scopes refresh failed', error instanceof Error ? error.message : error);
    return [];
  }
}

function isAiHistorySyncApiUnavailable(error: unknown): error is AgentApiError {
  return error instanceof AgentApiError && (error.status === 404 || error.status === 405 || error.status === 503);
}

function normalizedHydrateRequest(value: AiHistoryDetailHydrateRequest): AiHistoryDetailHydrateRequest | null {
  const historyItemId = typeof value.historyItemId === 'string' ? value.historyItemId.trim() : '';
  const externalThreadId = typeof value.externalThreadId === 'string' ? value.externalThreadId.trim() : '';
  const repoPath = normalizeLocalPath(value.repoPath);
  if (!historyItemId || !externalThreadId || !repoPath) return null;
  return {
    ...value,
    historyItemId,
    externalThreadId,
    repoPath,
    provider: typeof value.provider === 'string' && value.provider.trim() ? value.provider.trim() : AI_HISTORY_PROVIDER,
  };
}

function normalizedAiHistoryMonitorTarget(value: AiHistoryMonitorTarget): AiHistoryMonitorTarget | null {
  const historyItemId = typeof value.historyItemId === 'string' ? value.historyItemId.trim() : '';
  const externalThreadId = typeof value.externalThreadId === 'string' ? value.externalThreadId.trim() : '';
  const repoPath = normalizeLocalPath(value.repoPath);
  if (!historyItemId || !externalThreadId || !repoPath) return null;
  return {
    ...value,
    historyItemId,
    externalThreadId,
    repoPath,
    provider: typeof value.provider === 'string' && value.provider.trim() ? value.provider.trim() : AI_HISTORY_PROVIDER,
    projectId: typeof value.projectId === 'string' && value.projectId.trim() ? value.projectId.trim() : null,
    runState: typeof value.runState === 'string' && value.runState.trim() ? value.runState.trim() : null,
    lastActivityAt: typeof value.lastActivityAt === 'string' && value.lastActivityAt.trim() ? value.lastActivityAt.trim() : null,
    indexedAt: typeof value.indexedAt === 'string' && value.indexedAt.trim() ? value.indexedAt.trim() : null,
  };
}

function hydrateRequestExpiresAtMs(request: AiHistoryDetailHydrateRequest, nowMs = Date.now()): number {
  return timeMs(request.expiresAt) ?? nowMs + AI_HISTORY_DETAIL_WATCH_TTL_MS;
}

export function aiHistoryDetailHydratePollIntervalMs(input: {
  activeTaskCount: number;
  activeHydrateRequestCount: number;
  nowMs?: number;
  burstUntilMs?: number;
}): number {
  const nowMs = input.nowMs ?? Date.now();
  const burstUntilMs = input.burstUntilMs ?? 0;
  if (input.activeTaskCount > 0 || input.activeHydrateRequestCount > 0 || nowMs < burstUntilMs) {
    return AI_HISTORY_DETAIL_HYDRATE_ACTIVE_POLL_MS;
  }
  return AI_HISTORY_DETAIL_HYDRATE_POLL_MS;
}

async function postAiHistoryDetailMessages(
  api: AgentApiClient,
  runnerId: string,
  historyItemId: string,
  messages: AiHistoryDetailMessage[],
  detailSyncedAt: string | null,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (messages.length === 0) return false;
  const hash = aiHistoryDetailMessagesHash(messages);
  const cached = aiHistoryDetailSyncCache.get(historyItemId);
  if (!options.force && cached?.hash === hash) return false;
  await api.upsertAiHistoryDetailActivity(runnerId, historyItemId, messages, detailSyncedAt);
  aiHistoryDetailSyncCache.set(historyItemId, { hash, sentAt: Date.now() });
  trimCacheToLimit(aiHistoryDetailSyncCache, ROLLOUT_INSPECT_CACHE_LIMIT);
  return true;
}

function activeHydrateRequestStillPending(
  requests: AiHistoryDetailHydrateRequest[],
  historyItemId: string,
): boolean {
  return requests.some(request => request.historyItemId === historyItemId);
}

async function verifyAiHistoryDetailHydrateFulfilled(
  api: AgentApiClient,
  runnerId: string,
  historyItemId: string,
): Promise<void> {
  const requests = await api.listAiHistoryDetailHydrateRequests(runnerId, AI_HISTORY_DETAIL_HYDRATE_LIMIT);
  if (!activeHydrateRequestStillPending(requests, historyItemId)) return;
  aiHistoryDetailHydrateContractFailed = true;
  throw new Error(`Backend contract insufficient: detail hydrate request was not fulfilled historyItemId=${historyItemId}`);
}

async function postPreparedAiHistoryDetailMessages(
  api: AgentApiClient,
  runnerId: string,
  responseItem: AiHistoryBatchUpsertResponseItem,
  prepared: PreparedAiHistoryItem,
): Promise<void> {
  if (responseItem.linkedAiTaskId || prepared.item.linkedAiTaskId) return;
  if (!aiHistoryDetailWatchRequests.has(responseItem.historyItemId)) return;
  await postAiHistoryDetailMessages(
    api,
    runnerId,
    responseItem.historyItemId,
    prepared.detailMessages,
    prepared.detailSyncedAt,
  );
}

async function sendAiHistoryMetadataBatch(
  api: AgentApiClient,
  runnerId: string,
  preparedItems: PreparedAiHistoryItem[],
  scopes: AiHistoryBatchUpsertScope[],
): Promise<number> {
  if (preparedItems.length === 0 && scopes.length === 0) return 0;
  if (Date.now() < orphanImportApiUnavailableUntil) return 0;

  let upserted = 0;
  let scopesSent = false;
  const chunks = preparedItems.length > 0
    ? Array.from({ length: Math.ceil(preparedItems.length / AI_HISTORY_BATCH_SIZE) }, (_, index) => (
      preparedItems.slice(index * AI_HISTORY_BATCH_SIZE, (index + 1) * AI_HISTORY_BATCH_SIZE)
    ))
    : [[] as PreparedAiHistoryItem[]];

  for (const chunk of chunks) {
    try {
      const response = await api.batchUpsertAiHistory(runnerId, {
        provider: AI_HISTORY_PROVIDER,
        items: chunk.map(prepared => prepared.item),
        scopes: scopesSent ? [] : scopes,
      });
      scopesSent = true;
      const erroredIndexes = new Set((response.errors ?? []).map(error => error.index));
      const responseItemsByIndex = new Map((response.items ?? []).map(item => [item.index, item]));
      chunk.forEach((prepared, index) => {
        if (erroredIndexes.has(index)) return;
        const sentAt = Date.now();
        aiHistorySyncCache.set(prepared.cacheKey, {
          hash: prepared.hash,
          sentAt,
          running: prepared.running,
        });
        updateAiHistoryPlaceholderTitleWatch(prepared, sentAt);
        markPreparedAiHistoryRolloutInspected(prepared);
      });
      for (const [index, prepared] of chunk.entries()) {
        if (erroredIndexes.has(index)) continue;
        const responseItem = responseItemsByIndex.get(index);
        if (!responseItem?.historyItemId) continue;
        try {
          await postPreparedAiHistoryDetailMessages(api, runnerId, responseItem, prepared);
        } catch (error) {
          if (isAiHistorySyncApiUnavailable(error)) {
            aiHistoryDetailHydrateApiUnavailableUntil = Date.now() + ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS;
            debug(`ai history detail activity API unavailable status=${error.status}`);
          } else {
            logError('ai history detail activity upsert failed', error instanceof Error ? error.message : error);
          }
        }
      }
      upserted += response.upserted ?? 0;
    } catch (error) {
      if (isAiHistorySyncApiUnavailable(error)) {
        orphanImportApiUnavailableUntil = Date.now() + ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS;
        info(`ai history batch upsert API unavailable status=${error.status}; pausing metadata sync for ${Math.round(ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS / 1000)}s`);
        return upserted;
      }
      logError('ai history batch upsert failed', error instanceof Error ? error.message : error);
      return upserted;
    }
  }

  return upserted;
}

async function syncAiHistoryMetadata(
  api: AgentApiClient,
  runnerId: string,
  dbPath: string,
  tasks: AiTask[],
  importScopes: CodexThreadImportScope[],
  activeMonitorTargets: AiHistoryMonitorTarget[] = [],
  mode: AiHistorySyncMode = 'hot',
  maxItems = AI_HISTORY_HOT_SYNC_LIMIT,
  includeScopeUpserts = false,
  includeAllCodexCwds = false,
): Promise<AiHistoryMetadataSyncResult> {
  const now = Date.now();
  if (now < orphanImportApiUnavailableUntil) return emptyAiHistoryMetadataSyncResult;
  const cwdScopeMap = await importScopeCwdMap(importScopes);
  const repoPaths = cwdScopeMap.size > 0 ? [...cwdScopeMap.keys()] : importScopeRepoPaths(importScopes);
  if (!includeAllCodexCwds && repoPaths.length === 0) return emptyAiHistoryMetadataSyncResult;
  const sinceMs = 0;
  const preparedItemLimit = mode === 'hot'
    ? aiHistoryHotSyncPreparedItemLimit({
      maxItems,
      importScopeCount: importScopes.length,
      includeAllCodexCwds,
    })
    : maxItems;
  let recentRows: CodexThreadRow[];
  if (mode === 'hot' && includeAllCodexCwds) {
    const [allCwdRows, scopedRows] = await Promise.all([
      readRecentThreads(dbPath, sinceMs, [], AI_HISTORY_FAST_WATCH_LIMIT),
      importScopes.length > 0
        ? readRecentThreadsByImportScope(dbPath, sinceMs, importScopes, AI_HISTORY_FAST_WATCH_LIMIT)
        : Promise.resolve([] as CodexThreadRow[]),
    ]);
    recentRows = mergeRecentThreadsForHotSync(allCwdRows, scopedRows).slice(0, preparedItemLimit);
  } else if (includeAllCodexCwds) {
    recentRows = await readRecentThreads(dbPath, sinceMs, [], Math.max(preparedItemLimit, AI_HISTORY_FAST_WATCH_LIMIT));
  } else if (mode === 'hot') {
    recentRows = await readRecentThreadsByImportScope(dbPath, sinceMs, importScopes, AI_HISTORY_FAST_WATCH_LIMIT);
  } else {
    recentRows = await readRecentThreads(
      dbPath,
      sinceMs,
      repoPaths,
      ORPHAN_IMPORT_SCAN_LIMIT,
    );
  }
  const activeTargets = activeMonitorTargets
    .map(normalizedAiHistoryMonitorTarget)
    .filter((target): target is AiHistoryMonitorTarget => Boolean(target));
  const activeTargetsByThreadId = new Map(activeTargets.map(target => [target.externalThreadId, target]));
  const activeTargetRows: CodexThreadRow[] = [];
  if (mode === 'hot' && activeTargets.length > 0) {
    const recentRowIds = new Set(recentRows.map(row => row.id).filter(Boolean));
    const targetRowsById = await readThreads(
      dbPath,
      activeTargets
        .map(target => target.externalThreadId)
        .filter(threadId => !recentRowIds.has(threadId)),
    );
    for (const target of activeTargets) {
      if (recentRowIds.has(target.externalThreadId)) continue;
      const row = targetRowsById.get(target.externalThreadId);
      if (row) {
        activeTargetRows.push(row);
        recentRowIds.add(row.id);
      }
    }
  }
  const rowsForScopeResolution = mergeRecentThreadsForHotSync(recentRows, activeTargetRows);
  const baseSyncScopes = includeAllCodexCwds
    ? aiHistoryScopesForRows(importScopes, rowsForScopeResolution, cwdScopeMap)
    : importScopes;
  const syncScopes = [...baseSyncScopes];
  const seenSyncScopeKeys = new Set(syncScopes.map(scope => scopeKey(scope)));
  for (const target of activeTargets) {
    const repoPath = normalizeLocalPath(target.repoPath);
    if (!repoPath) continue;
    const scope = {
      project_id: target.projectId ?? '',
      repo_path: repoPath,
      enabled_since: null,
    };
    const key = scopeKey(scope);
    if (seenSyncScopeKeys.has(key)) continue;
    syncScopes.push(scope);
    seenSyncScopeKeys.add(key);
  }
  if (syncScopes.length === 0) return emptyAiHistoryMetadataSyncResult;
  const sessionThreadNames = await readCodexSessionThreadNames();
  const rowsById = new Map([...recentRows, ...activeTargetRows].map(row => [row.id, row]));
  const watchedRows: CodexThreadRow[] = [...activeTargetRows];
  const watchedRowIds = new Set<string>(activeTargetRows.map(row => row.id).filter(Boolean));
  if (mode === 'hot') {
    const detailWatchThreadIds: string[] = [];
    for (const [historyItemId, request] of aiHistoryDetailWatchRequests.entries()) {
      if (hydrateRequestExpiresAtMs(request, now) <= now) {
        aiHistoryDetailWatchRequests.delete(historyItemId);
        aiHistoryDetailRolloutInspectCache.delete(historyItemId);
        continue;
      }
      if (!rowsById.has(request.externalThreadId)) detailWatchThreadIds.push(request.externalThreadId);
    }
    const placeholderWatches = activeAiHistoryPlaceholderTitleWatches(now).filter(watch => {
      const scopeStillEnabled = syncScopes.some(scope => (
        typeof scope.project_id === 'string' &&
        scope.project_id.trim() === watch.projectId &&
        normalizeLocalPath(scope.repo_path) === watch.repoPath
      ));
      if (!scopeStillEnabled) {
        aiHistoryPlaceholderTitleWatch.delete(watch.key);
        return false;
      }
      if (!rowsById.has(watch.externalThreadId)) detailWatchThreadIds.push(watch.externalThreadId);
      return true;
    });
    const timerAlignmentWatches = activeAiHistoryTimerAlignmentWatches(now).filter(watch => {
      const scopeStillEnabled = syncScopes.some(scope => (
        typeof scope.project_id === 'string' &&
        scope.project_id.trim() === watch.projectId &&
        normalizeLocalPath(scope.repo_path) === watch.repoPath
      ));
      if (!scopeStillEnabled) {
        aiHistoryTimerAlignmentWatch.delete(watch.key);
        return false;
      }
      if (!rowsById.has(watch.externalThreadId)) detailWatchThreadIds.push(watch.externalThreadId);
      return true;
    });
    const watchedRowsById = await readThreads(dbPath, detailWatchThreadIds);
    for (const request of aiHistoryDetailWatchRequests.values()) {
      if (hydrateRequestExpiresAtMs(request, now) <= now) continue;
      const watchedRow = rowsById.get(request.externalThreadId) ?? watchedRowsById.get(request.externalThreadId);
      if (watchedRow) {
        rowsById.set(watchedRow.id, watchedRow);
        if (!watchedRowIds.has(watchedRow.id)) watchedRows.push(watchedRow);
        watchedRowIds.add(watchedRow.id);
      }
    }
    for (const watch of placeholderWatches) {
      const watchedRow = rowsById.get(watch.externalThreadId) ?? watchedRowsById.get(watch.externalThreadId);
      if (watchedRow) {
        rowsById.set(watchedRow.id, watchedRow);
        if (!watchedRowIds.has(watchedRow.id)) watchedRows.push(watchedRow);
        watchedRowIds.add(watchedRow.id);
      } else {
        aiHistoryPlaceholderTitleWatch.delete(watch.key);
      }
    }
    for (const watch of timerAlignmentWatches) {
      const watchedRow = rowsById.get(watch.externalThreadId) ?? watchedRowsById.get(watch.externalThreadId);
      if (watchedRow) {
        rowsById.set(watchedRow.id, watchedRow);
        if (!watchedRowIds.has(watchedRow.id)) watchedRows.push(watchedRow);
        watchedRowIds.add(watchedRow.id);
      } else {
        aiHistoryTimerAlignmentWatch.delete(watch.key);
      }
    }
  }
  const rows = [
    ...watchedRows,
    ...recentRows.filter(row => !watchedRowIds.has(row.id)),
  ];
  const preparedItems: PreparedAiHistoryItem[] = [];
  const seenItemKeys = new Set<string>();
  const scannedAt = new Date(now).toISOString();
  const scopes = includeScopeUpserts
    ? importScopes
      .map(scope => aiHistoryScopePayload(scope, scannedAt, mode === 'reconcile' ? scannedAt : null))
      .filter((scope): scope is AiHistoryBatchUpsertScope => !!scope)
    : [];

  for (const row of rows) {
    if (preparedItems.length >= preparedItemLimit) break;
    const updatedMs = timeMs(row.updated_at_ms) ?? timeMs(row.created_at_ms) ?? now;
    const activeTarget = activeTargetsByThreadId.get(row.id);
    const fallbackScope = activeTarget
      ? {
        project_id: activeTarget.projectId ?? '',
        repo_path: activeTarget.repoPath,
        enabled_since: null,
      }
      : null;
    const matchingScope = matchingThreadImportScope(row, syncScopes, updatedMs, cwdScopeMap, {
      ignoreEnabledSince: true,
    }) ?? fallbackScope;
    if (!matchingScope) continue;
    const itemKey = `${row.id}\u001f${normalizeLocalPath(matchingScope.repo_path)}`;
    if (seenItemKeys.has(itemKey)) continue;
    seenItemKeys.add(itemKey);
    const forcePlaceholderTitleRefresh = shouldInspectAiHistoryPlaceholderTitle(row, matchingScope, now);
    if (!forcePlaceholderTitleRefresh && !shouldInspectAiHistoryRollout(row, matchingScope, mode, now)) continue;

    try {
      const { rawRollout, summary } = await summarizeRollout(row);
      const linkedTask = linkedTaskForThread(row, tasks, cwdScopeMap);
      const prepared = aiHistoryItemFromThread({
        row,
        scope: matchingScope,
        summary,
        rawRollout,
        linkedTask,
        sessionThreadNames,
        nowMs: now,
      });
      updateAiHistoryTimerAlignmentWatch(row, matchingScope, prepared.item, now);
      if (shouldQueueAiHistoryItem(prepared)) {
        preparedItems.push(prepared);
      } else {
        markPreparedAiHistoryRolloutInspected(prepared, now);
      }
    } catch (error) {
      logError(`ai history metadata prepare failed thread=${row.id.slice(0, 8)}`, error instanceof Error ? error.message : error);
    }
    if (mode === 'reconcile' && preparedItems.length % 20 === 0) await sleep(0);
  }

  const upserted = await sendAiHistoryMetadataBatch(api, runnerId, preparedItems, scopes);
  if (upserted > 0) {
    debug(`ai history metadata ${mode} upserted=${upserted}`);
  }
  return {
    scanned: rows.length,
    prepared: preparedItems.length,
    upserted,
  };
}

async function reconcileAiHistorySourceTasks(
  api: AgentApiClient,
  runnerId: string,
): Promise<number> {
  try {
    const result = await api.reconcileAiHistorySourceTasks(runnerId, {
      provider: AI_HISTORY_PROVIDER,
      limit: 300,
    });
    return result.synced ?? 0;
  } catch (error) {
    if (isAiHistorySyncApiUnavailable(error)) {
      debug(`ai history source task reconcile API unavailable status=${error.status}`);
      return 0;
    }
    logError('ai history source task reconcile failed', error instanceof Error ? error.message : error);
    return 0;
  }
}

async function pollAiHistoryDetailHydrateRequests(
  api: AgentApiClient,
  runnerId: string,
): Promise<number> {
  if (aiHistoryDetailHydrateContractFailed) return 0;
  if (Date.now() < aiHistoryDetailHydrateApiUnavailableUntil) return 0;
  try {
    const requests = await api.listAiHistoryDetailHydrateRequests(runnerId, AI_HISTORY_DETAIL_HYDRATE_LIMIT);
    const now = Date.now();
    let activeRequestCount = 0;
    for (const request of requests) {
      const normalized = normalizedHydrateRequest(request);
      if (!normalized) continue;
      if (hydrateRequestExpiresAtMs(normalized, now) <= now) continue;
      aiHistoryDetailWatchRequests.set(normalized.historyItemId, normalized);
      activeRequestCount += 1;
    }
    trimCacheToLimit(aiHistoryDetailWatchRequests, ROLLOUT_INSPECT_CACHE_LIMIT);
    return activeRequestCount;
  } catch (error) {
    if (isAiHistorySyncApiUnavailable(error)) {
      aiHistoryDetailHydrateApiUnavailableUntil = Date.now() + ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS;
      info(`ai history detail hydrate API unavailable status=${error.status}; pausing detail hydrate for ${Math.round(ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS / 1000)}s`);
      return 0;
    }
    logError('ai history detail hydrate request poll failed', error instanceof Error ? error.message : error);
    return 0;
  }
}

async function listActiveAiHistoryMonitorTargets(
  api: AgentApiClient,
  runnerId: string,
): Promise<AiHistoryMonitorTarget[]> {
  const now = Date.now();
  if (now < activeAiHistoryMonitorTargetsApiUnavailableUntil) return [];
  try {
    const targets = await api.listActiveAiHistoryMonitorTargets(runnerId, AI_HISTORY_ACTIVE_MONITOR_TARGET_LIMIT);
    return targets
      .map(normalizedAiHistoryMonitorTarget)
      .filter((target): target is AiHistoryMonitorTarget => Boolean(target));
  } catch (error) {
    if (isAiHistorySyncApiUnavailable(error)) {
      activeAiHistoryMonitorTargetsApiUnavailableUntil = Date.now() + ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS;
      info(`ai history active monitor API unavailable status=${error.status}; pausing active history watch for ${Math.round(ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS / 1000)}s`);
      return [];
    }
    logError('ai history active monitor target refresh failed', error instanceof Error ? error.message : error);
    return [];
  }
}

function detailWatchFingerprint(request: AiHistoryDetailHydrateRequest, row: CodexThreadRow): string {
  return [
    request.historyItemId,
    request.requestedAt ?? '',
    request.expiresAt ?? '',
    threadRolloutFingerprint(row),
  ].join('\u001f');
}

export function shouldInspectAiHistoryDetailRollout(
  request: AiHistoryDetailHydrateRequest,
  row: CodexThreadRow,
  nowMs = Date.now(),
): boolean {
  const fingerprint = detailWatchFingerprint(request, row);
  const cached = aiHistoryDetailRolloutInspectCache.get(request.historyItemId);
  if (!cached) return true;
  if (cached.fingerprint !== fingerprint) return true;
  if (nowMs >= cached.nextInspectAt) return true;
  return false;
}

export function markAiHistoryDetailRolloutInspected(
  request: AiHistoryDetailHydrateRequest,
  row: CodexThreadRow,
  nowMs = Date.now(),
): void {
  aiHistoryDetailRolloutInspectCache.set(request.historyItemId, {
    fingerprint: detailWatchFingerprint(request, row),
    nextInspectAt: nowMs + AI_HISTORY_DETAIL_FAST_WATCH_RECHECK_MS,
  });
  trimCacheToLimit(aiHistoryDetailRolloutInspectCache, ROLLOUT_INSPECT_CACHE_LIMIT);
}

async function hydrateOneAiHistoryDetailRequest(
  api: AgentApiClient,
  runnerId: string,
  dbPath: string,
  request: AiHistoryDetailHydrateRequest,
  nowMs = Date.now(),
): Promise<boolean> {
  if (request.provider !== AI_HISTORY_PROVIDER) return false;
  const row = await readThread(dbPath, request.externalThreadId);
  if (!row) return false;
  if (!shouldInspectAiHistoryDetailRollout(request, row, nowMs)) return false;
  const { summary } = await summarizeRollout(row);
  const messages = aiHistoryDetailMessages(row, summary);
  markAiHistoryDetailRolloutInspected(request, row, nowMs);
  if (messages.length === 0) return false;
  const detailSyncedAt = aiHistoryDetailSyncedAt(row, summary) ?? new Date(nowMs).toISOString();
  await postAiHistoryDetailMessages(api, runnerId, request.historyItemId, messages, detailSyncedAt, { force: true });
  await verifyAiHistoryDetailHydrateFulfilled(api, runnerId, request.historyItemId);
  return true;
}

async function syncAiHistoryDetailHydrateRequests(
  api: AgentApiClient,
  runnerId: string,
  dbPath: string,
): Promise<number> {
  if (aiHistoryDetailHydrateContractFailed) return 0;
  const now = Date.now();
  let hydrated = 0;
  let inspected = 0;
  for (const [historyItemId, request] of aiHistoryDetailWatchRequests.entries()) {
    if (inspected >= AI_HISTORY_DETAIL_HYDRATE_PER_TICK) break;
    inspected += 1;
    if (hydrateRequestExpiresAtMs(request, now) <= now) {
      aiHistoryDetailWatchRequests.delete(historyItemId);
      aiHistoryDetailRolloutInspectCache.delete(historyItemId);
      continue;
    }
    try {
      if (await hydrateOneAiHistoryDetailRequest(api, runnerId, dbPath, request, now)) {
        hydrated += 1;
      }
    } catch (error) {
      if (isAiHistorySyncApiUnavailable(error)) {
        aiHistoryDetailHydrateApiUnavailableUntil = Date.now() + ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS;
        logError('ai history detail hydrate API unavailable', error.message);
        return hydrated;
      }
      logError('ai history detail hydrate failed', error instanceof Error ? error.message : error);
      if (aiHistoryDetailHydrateContractFailed) return hydrated;
    }
  }
  return hydrated;
}

type SyncOneTaskResult = 'synced' | 'unchanged' | 'remove';

function isThreadUnavailableMarked(task: AiTask, threadId: string): boolean {
  const current = taskResult(task);
  const currentThreadId = typeof current.codex_thread_id === 'string'
    ? current.codex_thread_id.trim()
    : task.codex_thread_id?.trim();
  return currentThreadId === threadId && current.codex_review_reason === 'thread_unavailable';
}

export async function markThreadGone(api: AgentApiClient, runnerId: string, task: AiTask, threadId: string, reason: 'thread_unavailable' | 'archived'): Promise<void> {
  const nowIso = new Date().toISOString();
  const current = taskResult(task);
  const previousLastActivityAt = typeof current.last_activity_at === 'string' && current.last_activity_at.trim()
    ? current.last_activity_at.trim()
    : null;
  const previousAwaitingApprovalAt = typeof current.awaiting_approval_at === 'string' && current.awaiting_approval_at.trim()
    ? current.awaiting_approval_at.trim()
    : null;
  const closureActivityAt = previousLastActivityAt ?? nowIso;
  const sourceCompletionSuppressed = current.codex_source_task_completion_suppressed === true;
  const sourceTaskCompleted = reason === 'archived' && shouldCompleteSourceFromArchivedThread(task);
  const archiveRequestCompleted = reason === 'archived' && hasPendingArchiveRequest(task);
  const nextStatus: AiTask['status'] = archiveRequestCompleted ? 'completed' : 'awaiting_approval';
  const result: TaskResultJson = {
    executor: task.executor === 'codex' ? 'codex' : 'codex_app',
    steps: [],
    output: '',
    message: reason === 'archived'
      ? 'Codex thread がアーカイブされたため監視を停止しました。'
      : 'Codex thread が一時的に見つからないため、監視を継続します。',
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_run_state: 'awaiting_approval',
    codex_review_reason: reason,
    codex_thread_archived: reason === 'archived',
    codex_archived_at: reason === 'archived' ? nowIso : null,
    codex_source_task_completed: sourceTaskCompleted,
    codex_source_task_id: task.source_task_id ?? null,
    codex_source_task_completion_reason: sourceTaskCompleted ? 'archived' : null,
    codex_source_task_completion_suppressed: sourceCompletionSuppressed,
    codex_archive_request_state: archiveRequestCompleted
      ? 'completed'
      : typeof current.codex_archive_request_state === 'string'
        ? current.codex_archive_request_state as TaskResultJson['codex_archive_request_state']
        : undefined,
    codex_archive_requested_at: typeof current.codex_archive_requested_at === 'string' ? current.codex_archive_requested_at : undefined,
    codex_archive_request_reason: typeof current.codex_archive_request_reason === 'string' ? current.codex_archive_request_reason : undefined,
    codex_archive_completed_at: archiveRequestCompleted
      ? nowIso
      : typeof current.codex_archive_completed_at === 'string'
        ? current.codex_archive_completed_at
        : undefined,
    codex_archive_request_cancelled_at: typeof current.codex_archive_request_cancelled_at === 'string'
      ? current.codex_archive_request_cancelled_at
      : null,
    last_activity_at: closureActivityAt,
    awaiting_approval_at: previousAwaitingApprovalAt ?? closureActivityAt,
    meta: {
      monitor: 'focusmap-agent',
      thread_archived: reason === 'archived',
    },
  };
  await api.updateTaskState(runnerId, task.id, nextStatus, {
    result,
    activity_messages: [{
      role: 'status',
      kind: nextStatus === 'completed' ? 'completed' : 'approval',
      body: result.message ?? 'Codex thread の監視を停止しました。',
      importance: 'important',
      dedupe_key: `thread:${threadId}:${reason}`,
    }],
  });
  task.status = nextStatus;
  task.completed_at = nextStatus === 'completed' ? nowIso : null;
  task.result = result as unknown as Record<string, unknown>;
}

async function markArchiveRequestFailed(
  api: AgentApiClient,
  runnerId: string,
  task: AiTask,
  threadId: string,
  errorMessage: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const current = taskResult(task);
  const compactError = compactText(errorMessage || 'Codex thread archive failed', 1_000);
  const currentStep = 'Codex threadのアーカイブに失敗しました。Mac agentが再試行します';
  const message = compactText(`Codex threadのアーカイブに失敗しました。次回巡回で再試行します: ${compactError}`, 1_500);
  const result: TaskResultJson = {
    ...(current as Partial<TaskResultJson>),
    executor: task.executor === 'codex' ? 'codex' : 'codex_app',
    steps: Array.isArray(current.steps) ? current.steps as StepLog[] : [],
    output: typeof current.output === 'string' ? current.output : '',
    message,
    current_step: currentStep,
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_run_state: 'awaiting_approval',
    codex_review_reason: typeof current.codex_review_reason === 'string' ? current.codex_review_reason : 'completed',
    codex_archive_request_state: 'pending',
    codex_archive_last_attempted_at: nowIso,
    codex_archive_last_failed_at: nowIso,
    codex_archive_next_attempt_at: new Date(Date.now() + CODEX_ARCHIVE_RETRY_INTERVAL_MS).toISOString(),
    codex_archive_last_error: compactError,
    last_activity_at: nowIso,
    awaiting_approval_at: typeof current.awaiting_approval_at === 'string' && current.awaiting_approval_at.trim()
      ? current.awaiting_approval_at.trim()
      : nowIso,
  };

  await api.updateTaskState(runnerId, task.id, 'completed', {
    result,
    activity_messages: [{
      role: 'status',
      kind: 'failed',
      body: message,
      importance: 'important',
      dedupe_key: `thread:${threadId}:archive_failed:${textFingerprint(compactError)}`,
      metadata: {
        source: 'codex_archive_request',
        retry: true,
      },
    }],
  });
  task.status = 'completed';
  task.completed_at = task.completed_at ?? nowIso;
  task.result = result as unknown as Record<string, unknown>;
}

async function syncOneTask(
  api: AgentApiClient,
  runnerId: string,
  dbPath: string,
  task: AiTask,
  rowCache?: ThreadRowCache,
): Promise<SyncOneTaskResult> {
  const threadId = taskThreadId(task) ?? await findMatchingThread(dbPath, task);
  if (!threadId) return 'unchanged';

  const row = rowCache ? await rowCache.get(threadId) : await readThread(dbPath, threadId);
  if (!row) {
    if (!isThreadUnavailableMarked(task, threadId)) {
      await markThreadGone(api, runnerId, task, threadId, 'thread_unavailable');
      syncCache.delete(task.id);
    }
    return 'unchanged';
  }
  if (row.archived) {
    await markThreadGone(api, runnerId, task, threadId, 'archived');
    syncCache.delete(task.id);
    return 'remove';
  }

  if (hasPendingArchiveRequest(task)) {
    const archiveResult = await archiveCodexThreadViaAppServer(threadId).catch((archiveError) => {
      const message = archiveError instanceof Error ? archiveError.message : String(archiveError);
      return { ok: false as const, error: message };
    });
    if (!archiveResult.ok) {
      logError(`codex archive request failed for ${task.id}`, archiveResult.error);
      await markArchiveRequestFailed(api, runnerId, task, threadId, archiveResult.error);
      syncCache.delete(task.id);
      return 'unchanged';
    }
    await markThreadGone(api, runnerId, task, threadId, 'archived');
    syncCache.delete(task.id);
    info(`codex thread archived from Focusmap node check task=${task.id} thread=${threadId.slice(0, 8)}`);
    return 'remove';
  }

  const nowMs = Date.now();
  if (!shouldInspectTaskRollout(task, row, threadId, nowMs)) return 'unchanged';

  const { summary } = await summarizeRollout(row);
  const { status, resumed } = taskStateForSummary(task, summary);
  const activityBatch = activitySyncBatch(task, threadId, summary, resumed);
  const lastActivityAt = latestIso(summary.lastActivityAt, summary.threadUpdatedAt, row.updated_at_ms) ?? '';
  const sourceTaskTitleSuggestion = importedThreadSourceTitleSuggestion(task, row);
  const cacheKey = [
    status,
    resumed ? 'resumed' : 'steady',
    lastActivityAt,
    summary.threadUpdatedAt ?? '',
    summary.currentStep,
    summary.latestUserMessageAt ?? '',
    summary.latestTaskStartedAt ?? '',
    summary.latestTaskCompleteAt ?? '',
    summary.latestRunningActivityAt ?? '',
    summary.activeTimerStartedAt ?? '',
    summary.timerStartedAt ?? '',
    summary.timerSource,
    summary.timerOffsetMs ?? '',
    activityBatch.syncedSequence ?? activitySyncedSequence(task) ?? '',
    summary.visibleMessages.length,
    sourceTaskTitleSuggestion ?? '',
  ].join('\u001f');

  const previousResult = taskResult(task);
  const previousState = typeof previousResult.codex_run_state === 'string' ? previousResult.codex_run_state : '';
  const previousActivitySyncedSequence = activitySyncedSequence(task);
  const hasNewActivityMessages = activityBatch.syncedSequence !== previousActivitySyncedSequence;
  const shouldSync =
    syncCache.get(task.id) !== cacheKey ||
    task.status !== status ||
    (status === 'running' && previousState !== 'running') ||
    (resumed && task.status !== 'running') ||
    hasNewActivityMessages;

  if (!shouldSync) {
    markTaskRolloutInspected(task, row, threadId, status === 'running', nowMs);
    return 'unchanged';
  }
  syncCache.set(task.id, cacheKey);

  const nextResult = resultSnapshot(task, threadId, row, summary, status, resumed, activityBatch);
  const stateSignalChanged =
    task.status !== status ||
    previousState !== nextResult.codex_run_state ||
    previousResult.current_step !== nextResult.current_step ||
    previousResult.last_activity_at !== nextResult.last_activity_at ||
    previousResult.awaiting_approval_at !== nextResult.awaiting_approval_at ||
    previousResult.codex_review_reason !== nextResult.codex_review_reason;
  await api.updateTaskState(runnerId, task.id, status, {
    result: nextResult,
    activity_messages: activityBatch.messages,
    source_task_title: sourceTaskTitleSuggestion,
    send_progress_snapshot: stateSignalChanged || activityBatch.messages.length === 0,
  });
  task.status = status;
  task.result = nextResult as unknown as Record<string, unknown>;
  markTaskRolloutInspected(task, row, threadId, status === 'running', nowMs);

  if (resumed) {
    info(`codex thread resumed task=${task.id} thread=${threadId.slice(0, 8)}`);
  } else {
    debug(`codex thread synced task=${task.id} status=${status}`);
  }
  return 'synced';
}

export function startCodexThreadMonitorLoop(
  api: AgentApiClient,
  runnerId: string,
  intervalMs = 1_000,
  targetRefreshIntervalMs = DEFAULT_TARGET_REFRESH_INTERVAL_MS,
  reconcileIntervalMs = DEFAULT_RECONCILE_INTERVAL_MS,
  recentScanIntervalMs = DEFAULT_TARGET_REFRESH_INTERVAL_MS,
): NodeJS.Timeout[] {
  let targetRefreshRunning = false;
  let activeWatchRunning = false;
  let recentScanRunning = false;
  let detailHydrateRunning = false;
  let reconcileRunning = false;
  let sourceTaskReconcileRunning = false;
  let targetsLoaded = false;
  let nextReconcileAt = Date.now() + reconcileIntervalMs;
  let nextSourceTaskReconcileAt = Date.now();
  let currentImportScopeSignature = '';
  let reconcileQueue: CodexThreadImportScope[] = [];
  let nextDetailHydratePollAt = 0;
  let tasks: AiTask[] = [];
  let importScopes: CodexThreadImportScope[] = [];
  let activeAiHistoryMonitorTargets: AiHistoryMonitorTarget[] = [];
  let detailHydratePollBurstUntil = 0;

  const currentDbPath = (): string | null => {
    const resolved = cachedCodexStateDbPath();
    if (!resolved || !existsSync(resolved)) {
      updateCodexThreadMonitorHeartbeatState({
        state_db_found: false,
        state_db_path: resolved,
      });
      return null;
    }
    updateCodexThreadMonitorHeartbeatState({
      state_db_found: true,
      state_db_path: resolved,
      last_error: null,
    });
    return resolved;
  };

  const refreshTargets = async () => {
    if (targetRefreshRunning) return;
    targetRefreshRunning = true;
    try {
      await measurePhase('target_refresh', async () => {
        const wasTargetsLoaded = targetsLoaded;
        const [nextTasks, nextImportScopes, nextActiveAiHistoryMonitorTargets] = await Promise.all([
          api.listCodexMonitorTasks(runnerId, MONITOR_LIMIT),
          listThreadImportScopes(api, runnerId),
          listActiveAiHistoryMonitorTargets(api, runnerId),
        ]);
        const scopeHeartbeat = await importScopeHeartbeatScopes(nextImportScopes);
        const nextImportScopeSignature = importScopeSignature(nextImportScopes);
        if (!wasTargetsLoaded || nextImportScopeSignature !== currentImportScopeSignature) {
          currentImportScopeSignature = nextImportScopeSignature;
          reconcileQueue = prioritizeImportScopesForReconcile(nextImportScopes);
          nextReconcileAt = Date.now() + reconcileIntervalMs;
        }
        tasks = nextTasks;
        importScopes = nextImportScopes;
        activeAiHistoryMonitorTargets = nextActiveAiHistoryMonitorTargets;
        targetsLoaded = true;
        updateCodexThreadMonitorHeartbeatState({
          last_scope_refresh_at: nowIso(),
          last_scope_refresh_error: null,
          scopes: scopeHeartbeat,
          next_reconcile_at: new Date(nextReconcileAt).toISOString(),
          reconcile_queue_length: reconcileQueue.length,
        });
      });
    } catch (error) {
      updateCodexThreadMonitorHeartbeatState({
        last_scope_refresh_at: nowIso(),
        last_scope_refresh_error: error instanceof Error ? error.message : String(error),
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('codex monitor target refresh failed', error instanceof Error ? error.message : error);
    } finally {
      targetRefreshRunning = false;
    }
  };

  const runActiveWatch = async () => {
    if (activeWatchRunning) {
      updateCodexThreadMonitorHeartbeatState({
        skipped_ticks: codexThreadMonitorHeartbeatState.skipped_ticks + 1,
      });
      return;
    }
    const tickStartedAt = Date.now();
    activeWatchRunning = true;
    try {
      const path = currentDbPath();
      updateCodexThreadMonitorHeartbeatState({
        last_tick_at: nowIso(tickStartedAt),
      });
      if (!path) return;
      await measurePhase('active_watch', async () => {
        const preImportTasks = preImportCodexMonitorTasks(tasks);
        updateCodexThreadMonitorHeartbeatState({
          active_watch_count: preImportTasks.length,
        });
        const rowCache = await createThreadRowCache(path, codexThreadIdsForTasks(preImportTasks));
        let preImportSynced = 0;
        for (const task of preImportTasks) {
          if (!tasks.some(item => item.id === task.id)) continue;
          try {
            const result = await syncOneTask(api, runnerId, path, task, rowCache);
            if (result === 'remove') {
              tasks = tasks.filter(item => item.id !== task.id);
            }
            preImportSynced += 1;
            if (preImportSynced % PRE_IMPORT_SYNC_YIELD_EVERY === 0) await sleep(0);
          } catch (error) {
            logError(`codex monitor failed for ${task.id}`, error instanceof Error ? error.message : error);
          }
        }
      });
    } catch (error) {
      updateCodexThreadMonitorHeartbeatState({
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('codex active watch loop error', error instanceof Error ? error.message : error);
    } finally {
      const tickDurationMs = Math.max(0, Math.round(Date.now() - tickStartedAt));
      updateCodexThreadMonitorHeartbeatState({
        last_tick_duration_ms: tickDurationMs,
        tick_overrun_ms: Math.max(0, tickDurationMs - intervalMs),
      });
      activeWatchRunning = false;
    }
  };

  const runDetailHydrate = async () => {
    if (detailHydrateRunning) return;
    detailHydrateRunning = true;
    try {
      const path = currentDbPath();
      if (!path) return;
      await measurePhase('detail_hydrate', async () => {
        const now = Date.now();
        const activeTaskCount = preImportCodexMonitorTasks(tasks).length;
        if (now >= nextDetailHydratePollAt) {
          const activeRequestCount = await pollAiHistoryDetailHydrateRequests(api, runnerId);
          if (activeRequestCount > 0) {
            extendDetailHydratePollBurst();
          }
          nextDetailHydratePollAt = Date.now() + aiHistoryDetailHydratePollIntervalMs({
            activeTaskCount,
            activeHydrateRequestCount: aiHistoryDetailWatchRequests.size,
            burstUntilMs: detailHydratePollBurstUntil,
          });
        }
        const hydratedDetails = await syncAiHistoryDetailHydrateRequests(api, runnerId, path);
        if (hydratedDetails > 0) debug(`ai history detail hydrated=${hydratedDetails}`);
      });
    } catch (error) {
      updateCodexThreadMonitorHeartbeatState({
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('ai history detail hydrate loop error', error instanceof Error ? error.message : error);
    } finally {
      detailHydrateRunning = false;
    }
  };

  const extendDetailHydratePollBurst = (nowMs = Date.now()) => {
    detailHydratePollBurstUntil = Math.max(
      detailHydratePollBurstUntil,
      nowMs + AI_HISTORY_DETAIL_HYDRATE_OPEN_BURST_MS,
    );
    nextDetailHydratePollAt = Math.min(
      nextDetailHydratePollAt || Number.POSITIVE_INFINITY,
      nowMs + AI_HISTORY_DETAIL_HYDRATE_ACTIVE_POLL_MS,
    );
  };

  const runRecentScan = async () => {
    if (recentScanRunning) return;
    recentScanRunning = true;
    try {
      const path = currentDbPath();
      if (!path || !targetsLoaded) return;
      await measurePhase('recent_scan', async () => {
        const activeTasks = preImportCodexMonitorTasks(tasks);
        const deferOrphanImport = shouldDeferOrphanImportForTasks(activeTasks);
        const hotResult = await syncAiHistoryMetadata(
          api,
          runnerId,
          path,
          tasks,
          importScopes,
          activeAiHistoryMonitorTargets,
          'hot',
          AI_HISTORY_HOT_SYNC_LIMIT,
          false,
          true,
        );
        updateCodexThreadMonitorHeartbeatState({
          recent_scan_count: hotResult.scanned,
        });
        if (hotResult.upserted > 0) extendDetailHydratePollBurst();
        const postImportTasks = deferOrphanImport
          ? []
          : prioritizeCodexMonitorTasks(tasks)
            .filter(task => !activeTasks.some(activeTask => activeTask.id === task.id))
            .slice(0, POST_IMPORT_SYNC_LIMIT);
        const rowCache = await createThreadRowCache(path, codexThreadIdsForTasks(postImportTasks));
        for (const task of postImportTasks) {
          try {
            const result = await syncOneTask(api, runnerId, path, task, rowCache);
            if (result === 'remove') {
              tasks = tasks.filter(item => item.id !== task.id);
            }
            await sleep(20);
          } catch (error) {
            logError(`codex monitor failed for ${task.id}`, error instanceof Error ? error.message : error);
          }
        }
      });
    } catch (error) {
      updateCodexThreadMonitorHeartbeatState({
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('codex recent scan loop error', error instanceof Error ? error.message : error);
    } finally {
      recentScanRunning = false;
    }
  };

  const runReconcile = async () => {
    if (reconcileRunning) return;
    if (!targetsLoaded) return;
    if (codexThreadMonitorHeartbeatState.tick_overrun_ms > 0) {
      nextReconcileAt = Date.now() + Math.min(60_000, reconcileIntervalMs);
      updateCodexThreadMonitorHeartbeatState({
        next_reconcile_at: new Date(nextReconcileAt).toISOString(),
      });
      return;
    }
    if (reconcileQueue.length === 0 && Date.now() < nextReconcileAt) return;
    reconcileRunning = true;
    try {
      const path = currentDbPath();
      if (!path) return;
      await measurePhase('reconcile', async () => {
        if (reconcileQueue.length === 0) {
          reconcileQueue = prioritizeImportScopesForReconcile(importScopes);
        }
        const scope = reconcileQueue.shift();
        let reconcileScanned = 0;
        let reconcileUpserted = 0;
        if (scope) {
          const scopeResult = await syncAiHistoryMetadata(
            api,
            runnerId,
            path,
            tasks,
            [scope],
            activeAiHistoryMonitorTargets,
            'reconcile',
            AI_HISTORY_RECONCILE_SCOPE_BATCH_LIMIT,
            true,
          );
          reconcileScanned += scopeResult.scanned;
          reconcileUpserted += scopeResult.upserted;
          await sleep(AI_HISTORY_RECONCILE_QUEUE_YIELD_MS);
        }
        if (!scope || reconcileQueue.length === 0) {
          const fullResult = await syncAiHistoryMetadata(
            api,
            runnerId,
            path,
            tasks,
            importScopes,
            activeAiHistoryMonitorTargets,
            'reconcile',
            AI_HISTORY_HOT_SYNC_TOTAL_LIMIT,
            false,
            true,
          );
          reconcileScanned += fullResult.scanned;
          reconcileUpserted += fullResult.upserted;
        }
        if (reconcileQueue.length === 0) {
          nextReconcileAt = Date.now() + reconcileIntervalMs;
        } else {
          nextReconcileAt = 0;
        }
        updateCodexThreadMonitorHeartbeatState({
          last_reconcile_at: new Date().toISOString(),
          next_reconcile_at: new Date(nextReconcileAt || Date.now()).toISOString(),
          last_reconcile_imported: reconcileScanned,
          last_reconcile_upserted: reconcileUpserted,
          reconcile_queue_length: reconcileQueue.length,
        });
        debug(`ai history metadata reconcile scope=${scope?.repo_path ?? 'all-codex-cwds'} upserted=${reconcileUpserted} queue=${reconcileQueue.length} next_in=${nextReconcileAt ? Math.round((nextReconcileAt - Date.now()) / 1000) : 0}s`);
      });
    } catch (error) {
      updateCodexThreadMonitorHeartbeatState({
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('codex reconcile loop error', error instanceof Error ? error.message : error);
    } finally {
      reconcileRunning = false;
    }
  };

  const runSourceTaskReconcile = async (force = false) => {
    if (sourceTaskReconcileRunning) return;
    const now = Date.now();
    if (!force && now < nextSourceTaskReconcileAt) return;
    sourceTaskReconcileRunning = true;
    try {
      const synced = await measurePhase('source_task_reconcile', async () => (
        reconcileAiHistorySourceTasks(api, runnerId)
      ));
      nextSourceTaskReconcileAt = Date.now() + AI_HISTORY_SOURCE_TASK_RECONCILE_INTERVAL_MS;
      updateCodexThreadMonitorHeartbeatState({
        last_source_task_reconcile_at: new Date().toISOString(),
        next_source_task_reconcile_at: new Date(nextSourceTaskReconcileAt).toISOString(),
        last_source_task_reconcile_synced: synced,
      });
      if (synced > 0) debug(`ai history source task reconcile synced=${synced}`);
    } catch (error) {
      nextSourceTaskReconcileAt = Date.now() + Math.min(60_000, AI_HISTORY_SOURCE_TASK_RECONCILE_INTERVAL_MS);
      updateCodexThreadMonitorHeartbeatState({
        next_source_task_reconcile_at: new Date(nextSourceTaskReconcileAt).toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('ai history source task reconcile loop error', error instanceof Error ? error.message : error);
    } finally {
      sourceTaskReconcileRunning = false;
    }
  };

  void refreshTargets();
  void runActiveWatch();
  void runRecentScan();
  void runDetailHydrate();
  void runSourceTaskReconcile(true);

  return [
    setInterval(() => {
      void runActiveWatch();
    }, intervalMs),
    setInterval(() => {
      void refreshTargets();
    }, targetRefreshIntervalMs),
    setInterval(() => {
      void runRecentScan();
    }, recentScanIntervalMs),
    setInterval(() => {
      void runDetailHydrate();
    }, Math.min(1_000, AI_HISTORY_DETAIL_HYDRATE_ACTIVE_POLL_MS)),
    setInterval(() => {
      void runReconcile();
    }, Math.min(60_000, Math.max(10_000, reconcileIntervalMs))),
    setInterval(() => {
      void runSourceTaskReconcile();
    }, Math.min(60_000, AI_HISTORY_SOURCE_TASK_RECONCILE_INTERVAL_MS)),
  ];
}
