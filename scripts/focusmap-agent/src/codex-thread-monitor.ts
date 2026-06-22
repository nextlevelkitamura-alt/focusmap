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
  AiHistoryStatus,
  AiTask,
  CodexThreadImportScope,
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
const POST_IMPORT_SYNC_LIMIT = 80;
const PRE_IMPORT_SYNC_YIELD_EVERY = 25;
const RUNNING_HOT_ORPHAN_IMPORT_LIMIT = 3;
const syncCache = new Map<string, string>();
const orphanImportCache = new Map<string, number>();
const rolloutReadCache = new Map<string, { mtimeMs: number; size: number; raw: string }>();
export const DEFAULT_TARGET_REFRESH_INTERVAL_MS = 3_000;
export const DEFAULT_RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
export const RESUME_RUNNING_VISIBILITY_MS = 2_000;
export const AWAITING_APPROVAL_STABILITY_MS = 1_000;
const ORPHAN_IMPORT_LIMIT = 30;
const ORPHAN_IMPORT_SCAN_LIMIT = 200;
const AI_HISTORY_PROVIDER = 'codex_app';
const AI_HISTORY_FAST_WATCH_LIMIT = 20;
const AI_HISTORY_HOT_SYNC_LIMIT = AI_HISTORY_FAST_WATCH_LIMIT;
const AI_HISTORY_RECONCILE_SCOPE_BATCH_LIMIT = 80;
const AI_HISTORY_BATCH_SIZE = 80;
const AI_HISTORY_RUNNING_DURATION_WRITE_INTERVAL_MS = 60_000;
const AI_HISTORY_RECONCILE_QUEUE_YIELD_MS = 20;
const AI_HISTORY_DETAIL_HYDRATE_POLL_MS = 5_000;
const AI_HISTORY_DETAIL_HYDRATE_ACTIVE_POLL_MS = 5_000;
const AI_HISTORY_DETAIL_HYDRATE_LIMIT = 50;
const AI_HISTORY_DETAIL_WATCH_TTL_MS = 120_000;
const AI_HISTORY_DETAIL_FAST_WATCH_RECHECK_MS = 1_000;
export const AI_HISTORY_PLACEHOLDER_TITLE = '新しいチャット';
const AI_HISTORY_PLACEHOLDER_TITLE_WATCH_TTL_MS = 5 * 60 * 1000;
const MAX_AI_HISTORY_DETAIL_MESSAGES_PER_POST = 50;
export const AI_HISTORY_STALE_RUNNING_GENERAL_MS = 2 * 60 * 60 * 1000;
export const AI_HISTORY_STALE_RUNNING_AUTOMATION_MS = 30 * 60 * 1000;
const RUNNING_THREAD_ROLLOUT_RECHECK_MS = 1_000;
const ACTIVE_RUNNING_ACTIVITY_WINDOW_MS = 30_000;
const STALE_RUNNING_THREAD_ROLLOUT_RECHECK_MS = 30_000;
const STABLE_TASK_ROLLOUT_RECHECK_MS = 30_000;
const configuredOrphanImportWindowMs = Number(process.env.FOCUSMAP_CODEX_ORPHAN_IMPORT_WINDOW_MS);
const ORPHAN_IMPORT_WINDOW_MS = Number.isFinite(configuredOrphanImportWindowMs) && configuredOrphanImportWindowMs > 0
  ? configuredOrphanImportWindowMs
  : 2 * 60 * 60 * 1000;
const ORPHAN_IMPORT_RETRY_MS = 5 * 60 * 1000;
const ORPHAN_IMPORT_API_UNAVAILABLE_BACKOFF_MS = 5 * 60 * 1000;
const FOCUSMAP_HANDOFF_THREAD_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROMPT_MATCH_PREFIX_CHARS = 500;
const MIN_PROMPT_MATCH_CHARS = 120;
let orphanImportApiUnavailableUntil = 0;
let importScopesApiUnavailableUntil = 0;
const WORKTREE_PATH_CACHE_TTL_MS = 30_000;
const worktreePathCache = new Map<string, { expiresAt: number; paths: string[] }>();
const aiHistorySyncCache = new Map<string, { hash: string; sentAt: number; running: boolean }>();
const aiHistoryRolloutInspectCache = new Map<string, { fingerprint: string; nextInspectAt: number }>();
const taskRolloutInspectCache = new Map<string, { fingerprint: string; nextInspectAt: number }>();
const aiHistoryDetailSyncCache = new Map<string, { hash: string; sentAt: number }>();
const aiHistoryDetailWatchRequests = new Map<string, AiHistoryDetailHydrateRequest>();
const aiHistoryDetailRolloutInspectCache = new Map<string, { fingerprint: string; nextInspectAt: number }>();
const aiHistoryPlaceholderTitleWatch = new Map<string, {
  projectId: string;
  repoPath: string;
  externalThreadId: string;
  expiresAt: number;
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
  last_scope_refresh_at: string | null;
  last_scope_refresh_error: string | null;
  scopes: CodexThreadImportScopeHeartbeat[];
  last_reconcile_at: string | null;
  next_reconcile_at: string | null;
  last_reconcile_imported: number | null;
  last_reconcile_upserted: number | null;
  last_error: string | null;
};

const codexThreadMonitorHeartbeatState: CodexThreadMonitorHeartbeatState = {
  state_db_found: false,
  state_db_path: null,
  last_tick_at: null,
  last_scope_refresh_at: null,
  last_scope_refresh_error: null,
  scopes: [],
  last_reconcile_at: null,
  next_reconcile_at: null,
  last_reconcile_imported: null,
  last_reconcile_upserted: null,
  last_error: null,
};

function updateCodexThreadMonitorHeartbeatState(patch: Partial<CodexThreadMonitorHeartbeatState>): void {
  Object.assign(codexThreadMonitorHeartbeatState, patch);
}

function codexThreadImportScopeMetadataFlat() {
  const scopes = codexThreadMonitorHeartbeatState.scopes;
  return {
    codex_monitor_db_available: codexThreadMonitorHeartbeatState.state_db_found,
    codex_monitor_db_path: codexThreadMonitorHeartbeatState.state_db_path,
    codex_import_scopes_count: scopes.length,
    codex_import_scope_repo_paths: scopes.map(scope => scope.repo_path),
    codex_import_scope_cwd_paths: Array.from(new Set(scopes.flatMap(scope => scope.cwd_paths))),
    codex_last_scope_refresh_at: codexThreadMonitorHeartbeatState.last_scope_refresh_at,
    codex_last_scope_refresh_error: codexThreadMonitorHeartbeatState.last_scope_refresh_error,
    codex_last_reconcile_at: codexThreadMonitorHeartbeatState.last_reconcile_at,
    codex_next_reconcile_at: codexThreadMonitorHeartbeatState.next_reconcile_at,
    codex_last_reconcile_imported: codexThreadMonitorHeartbeatState.last_reconcile_imported,
    codex_last_reconcile_upserted: codexThreadMonitorHeartbeatState.last_reconcile_upserted,
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
  startedAt: string | null;
  endedAt: string | null;
  activeStartedAt: string | null;
  workDurationSeconds: number | null;
  visibleMessages: VisibleMessage[];
};

type OrphanImportMode = 'hot' | 'reconcile';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

export function codexThreadGeneratedTitle(row: { title?: string | null; first_user_message?: string | null }): string | null {
  const title = compactText(row.title ?? '', 8_000);
  if (!title || isInternalUserMessage(title)) return null;
  const firstLine = title.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return oneLineTitle(firstLine);
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
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, created_at_ms, preview, rollout_path, source, cwd, first_user_message',
      'FROM threads',
      `WHERE id = ${sqlString(threadId)}`,
      'LIMIT 1',
    ].join(' '),
  );
  return rows[0] ?? null;
}

function appendVisibleMessage(messages: VisibleMessage[], input: Omit<VisibleMessage, 'body'> & { body: string }): void {
  const body = compactText(input.body, MAX_ACTIVITY_BODY_CHARS);
  if (!body) return;
  const inputTurnKey = input.role === 'codex' ? input.turnStartedAt ?? '' : input.createdAt ?? '';
  const key = `${input.role}:${inputTurnKey}:${textFingerprint(body)}`;
  const existing = messages.find(message => {
    const messageTurnKey = message.role === 'codex' ? message.turnStartedAt ?? '' : message.createdAt ?? '';
    return `${message.role}:${messageTurnKey}:${textFingerprint(message.body)}` === key;
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
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let activeStartedAt: string | null = null;
  let activeStartedMs: number | null = null;
  let workDurationMs = 0;

  const markWorkStarted = (iso: string | null) => {
    const ms = timeMs(iso);
    if (ms === null) return;
    startedAt = startedAt ?? new Date(ms).toISOString();
    if (activeStartedMs === null || ms < activeStartedMs) {
      activeStartedAt = new Date(ms).toISOString();
      activeStartedMs = ms;
    }
  };
  const markWorkEnded = (iso: string | null) => {
    const ms = timeMs(iso);
    if (ms === null) return;
    endedAt = new Date(ms).toISOString();
    if (activeStartedMs !== null) {
      workDurationMs += Math.max(0, ms - activeStartedMs);
      activeStartedMs = null;
      activeStartedAt = null;
    }
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
      latestTaskStartedAt = eventTime;
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexが実行を開始しました';
      markWorkStarted(eventTime);
      continue;
    }

    if (payloadType === 'task_complete') {
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
          turnStartedAt: latestTaskStartedAt,
          turnCompletedAt: eventTime,
        });
      } else {
        completeLatestCodexVisibleMessage(visibleMessages, latestTaskStartedAt, eventTime);
      }
      continue;
    }

    if (payloadType === 'turn_aborted') {
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      historyStatus = failedRolloutPayload(payload) ? 'failed' : 'awaiting_approval';
      reviewReason = historyStatus === 'failed' ? 'failed' : 'aborted';
      currentStep = historyStatus === 'failed'
        ? 'Codexのターンが失敗しました'
        : 'Codexのターンが停止し確認待ちです';
      markWorkEnded(eventTime);
      completeLatestCodexVisibleMessage(visibleMessages, latestTaskStartedAt, eventTime, 'turn_aborted');
      continue;
    }

    if (payloadType === 'task_failed' || payloadType === 'error') {
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      historyStatus = 'failed';
      reviewReason = 'failed';
      currentStep = 'Codexの実行が失敗しました';
      markWorkEnded(eventTime);
      continue;
    }

    if (payloadType === 'completed' || payloadType === 'thread_completed' || payloadType === 'task_done' || payloadType === 'task_succeeded') {
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
          turnStartedAt: latestTaskStartedAt,
        });
      }
      continue;
    }

    if (payloadType === 'user_message') {
      const text = safeText(payload);
      if (text && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime;
        if ((timeMs(eventTime) ?? 0) > (timeMs(latestTaskCompleteAt) ?? Number.POSITIVE_INFINITY)) {
          latestRunningActivityAt = eventTime;
          state = 'running';
          historyStatus = 'running';
          reviewReason = 'started';
          currentStep = 'Codexが追加指示を受け取りました';
          markWorkStarted(eventTime);
        }
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
        lastActivityAt = previousLastActivityAt;
        continue;
      }
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexがコンテキストを整理中';
      continue;
    }

    if (payloadType === 'reasoning') {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt;
        continue;
      }
      latestRunningActivityAt = eventTime;
      state = 'running';
      historyStatus = 'running';
      reviewReason = 'started';
      currentStep = 'Codexが内容を検討中';
      continue;
    }

    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      if (!shouldTreatCodexActivityAsRunning({ eventTime, latestTaskCompleteAt, latestUserMessageAt, latestTaskStartedAt })) {
        lastActivityAt = previousLastActivityAt;
        continue;
      }
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
          turnStartedAt: latestTaskStartedAt,
        });
      } else if (role === 'user' && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime;
        if ((timeMs(eventTime) ?? 0) > (timeMs(latestTaskCompleteAt) ?? Number.POSITIVE_INFINITY)) {
          latestRunningActivityAt = eventTime;
          state = 'running';
          historyStatus = 'running';
          reviewReason = 'started';
          currentStep = 'Codexが追加指示を受け取りました';
          markWorkStarted(eventTime);
        }
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
    startedAt,
    endedAt,
    activeStartedAt,
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
): CodexThreadImportScope | null {
  const cwd = normalizeLocalPath(row.cwd);
  if (!cwd) return null;
  const aliasedScope = cwdScopeMap?.get(cwd);
  if (aliasedScope && importScopeEnabledAt(aliasedScope, updatedMs)) return aliasedScope;

  for (const scope of importScopes) {
    const repoPath = normalizeLocalPath(scope.repo_path);
    if (!repoPath || repoPath !== cwd) continue;
    if (!importScopeEnabledAt(scope, updatedMs)) continue;
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
  const cached = aiHistoryRolloutInspectCache.get(aiHistoryRolloutInspectKey(row, scope));
  if (!cached) return true;
  if (cached.fingerprint !== fingerprint) return true;
  if (nowMs >= cached.nextInspectAt) {
    aiHistoryRolloutInspectCache.set(key, {
      fingerprint,
      nextInspectAt: nowMs + aiHistoryRolloutRecheckMs(row, true, nowMs),
    });
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
    taskRolloutInspectCache.set(task.id, {
      fingerprint,
      nextInspectAt: nowMs + taskRolloutRecheckMs(task, row, true, nowMs),
    });
    return false;
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

function isAutomationAiHistoryThread(row: CodexThreadRow): boolean {
  const text = compactText([
    row.title ?? '',
    row.preview ?? '',
    row.first_user_message ?? '',
  ].filter(Boolean).join('\n'), 2_000);
  return /^Automation:/iu.test(text.trim()) || /\bAutomation ID:/iu.test(text);
}

function aiHistoryStaleRunningThresholdMs(row: CodexThreadRow): number {
  return isAutomationAiHistoryThread(row)
    ? AI_HISTORY_STALE_RUNNING_AUTOMATION_MS
    : AI_HISTORY_STALE_RUNNING_GENERAL_MS;
}

function staleRunningAiHistoryEndedAt(input: {
  row: CodexThreadRow;
  summary: RolloutSummary;
  status: AiHistoryStatus;
  nowMs: number;
}): string | null {
  if (input.status !== 'running') return null;
  if (input.summary.threadArchived) return null;
  const lastActivityAt = latestIso(
    input.summary.lastActivityAt,
    input.summary.threadUpdatedAt,
    input.row.updated_at_ms,
    input.row.created_at_ms,
  );
  const lastActivityMs = timeMs(lastActivityAt);
  if (lastActivityMs === null) return null;
  if (input.nowMs - lastActivityMs < aiHistoryStaleRunningThresholdMs(input.row)) return null;
  return new Date(lastActivityMs).toISOString();
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
  const startedAt = input.status === 'running' || input.staleRunningEndedAt
    ? latestIso(input.summary.activeStartedAt, input.summary.latestTaskStartedAt)
    : input.summary.latestTaskStartedAt;
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
    staleRunning: Boolean(staleRunningEndedAt),
    staleRunningLastActivityAt: staleRunningEndedAt,
    staleRunningThresholdMs: staleRunningEndedAt ? aiHistoryStaleRunningThresholdMs(input.row) : null,
  };
}

export function isAiHistoryPlaceholderTitle(value: string | null | undefined): boolean {
  const title = compactText(value ?? '', 300);
  return title === AI_HISTORY_PLACEHOLDER_TITLE || /^Codex thread [0-9a-z-]+$/iu.test(title);
}

export function aiHistoryTitle(row: CodexThreadRow): string {
  return codexThreadGeneratedTitle(row) ??
    oneLineTitle(row.preview, 80) ??
    AI_HISTORY_PLACEHOLDER_TITLE;
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
  if (isAiHistoryPlaceholderTitle(prepared.item.title ?? null)) {
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
  const archived = Boolean(input.row.archived);
  const item: AiHistoryBatchUpsertItem = {
    provider: AI_HISTORY_PROVIDER,
    externalThreadId: input.row.id,
    repoPath,
    worktreePath,
    projectId: input.scope.project_id,
    sourceTaskId: input.linkedTask?.source_task_id ?? null,
    linkedAiTaskId: input.linkedTask?.id ?? null,
    title: aiHistoryTitle(input.row),
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
  return task.status === 'completed' &&
    result.codex_archive_request_state === 'pending' &&
    typeof result.codex_archive_requested_at === 'string' &&
    result.codex_archive_requested_at.trim().length > 0 &&
    result.codex_archive_request_cancelled_at == null &&
    result.codex_archive_completed_at == null &&
    result.codex_source_task_completed === true &&
    result.codex_source_task_completion_suppressed !== true;
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
    return { status: 'running' as const, resumed: true };
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
  const lastActivityAt = latestIso(summary.lastActivityAt, summary.threadUpdatedAt, row.updated_at_ms) ?? nowIso;
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
    codex_run_state: status === 'running' ? 'running' : 'awaiting_approval',
    codex_review_reason: status === 'running' ? 'started' : summary.reviewReason,
    codex_thread_archived: Boolean(row.archived),
    codex_source_task_id: typeof result.codex_source_task_id === 'string'
      ? result.codex_source_task_id
      : task.source_task_id ?? null,
    current_step: currentStep,
    last_activity_at: lastActivityAt,
    codex_turn_started_at: summary.latestTaskStartedAt ?? undefined,
    codex_turn_completed_at: summary.latestTaskCompleteAt ?? undefined,
    awaiting_approval_at: status === 'awaiting_approval'
      ? awaitingApprovalAtForSummary(result, summary, nowIso)
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
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, created_at_ms, preview, rollout_path, source, cwd, first_user_message',
      'FROM threads',
      `WHERE updated_at_ms >= ${Math.max(0, Math.floor(sinceMs))}${cwdCondition}`,
      'ORDER BY updated_at_ms DESC',
      `LIMIT ${safeLimit}`,
    ].join(' '),
  );
}

function orphanImportSinceMs(
  importScopes: CodexThreadImportScope[],
  now = Date.now(),
  mode: OrphanImportMode = 'reconcile',
): number {
  const windowSinceMs = Math.max(0, now - ORPHAN_IMPORT_WINDOW_MS);
  if (mode === 'hot') return windowSinceMs;
  const scopeSinceMs = importScopes
    .map(scope => timeMs(scope.enabled_since))
    .filter((value): value is number => value !== null && value > 0);
  if (scopeSinceMs.length === 0) return windowSinceMs;
  return Math.max(0, Math.min(windowSinceMs, ...scopeSinceMs));
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

function hydrateRequestExpiresAtMs(request: AiHistoryDetailHydrateRequest, nowMs = Date.now()): number {
  return timeMs(request.expiresAt) ?? nowMs + AI_HISTORY_DETAIL_WATCH_TTL_MS;
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
  mode: AiHistorySyncMode = 'hot',
  maxItems = AI_HISTORY_HOT_SYNC_LIMIT,
  includeScopeUpserts = false,
): Promise<number> {
  const now = Date.now();
  if (now < orphanImportApiUnavailableUntil) return 0;
  if (importScopes.length === 0) return 0;
  const cwdScopeMap = await importScopeCwdMap(importScopes);
  const repoPaths = cwdScopeMap.size > 0 ? [...cwdScopeMap.keys()] : importScopeRepoPaths(importScopes);
  if (repoPaths.length === 0) return 0;
  const sinceMs = mode === 'reconcile' ? 0 : orphanImportSinceMs(importScopes, now, 'hot');
  const recentRows = await readRecentThreads(
    dbPath,
    sinceMs,
    repoPaths,
    mode === 'reconcile' ? ORPHAN_IMPORT_SCAN_LIMIT : AI_HISTORY_FAST_WATCH_LIMIT,
  );
  const rowsById = new Map(recentRows.map(row => [row.id, row]));
  const watchedRows: CodexThreadRow[] = [];
  const watchedRowIds = new Set<string>();
  if (mode === 'hot') {
    for (const [historyItemId, request] of aiHistoryDetailWatchRequests.entries()) {
      if (hydrateRequestExpiresAtMs(request, now) <= now) {
        aiHistoryDetailWatchRequests.delete(historyItemId);
        aiHistoryDetailRolloutInspectCache.delete(historyItemId);
        continue;
      }
      try {
        const watchedRow = rowsById.get(request.externalThreadId) ?? await readThread(dbPath, request.externalThreadId);
        if (watchedRow) {
          rowsById.set(watchedRow.id, watchedRow);
          watchedRows.push(watchedRow);
          watchedRowIds.add(watchedRow.id);
        }
      } catch (error) {
        logError(`ai history detail watch failed thread=${request.externalThreadId.slice(0, 8)}`, error instanceof Error ? error.message : error);
      }
    }
    for (const watch of activeAiHistoryPlaceholderTitleWatches(now)) {
      const scopeStillEnabled = importScopes.some(scope => (
        typeof scope.project_id === 'string' &&
        scope.project_id.trim() === watch.projectId &&
        normalizeLocalPath(scope.repo_path) === watch.repoPath
      ));
      if (!scopeStillEnabled) {
        aiHistoryPlaceholderTitleWatch.delete(watch.key);
        continue;
      }
      try {
        const watchedRow = rowsById.get(watch.externalThreadId) ?? await readThread(dbPath, watch.externalThreadId);
        if (watchedRow) {
          rowsById.set(watchedRow.id, watchedRow);
          watchedRows.push(watchedRow);
          watchedRowIds.add(watchedRow.id);
        }
        else aiHistoryPlaceholderTitleWatch.delete(watch.key);
      } catch (error) {
        logError(`ai history placeholder title watch failed thread=${watch.externalThreadId.slice(0, 8)}`, error instanceof Error ? error.message : error);
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
    if (preparedItems.length >= maxItems) break;
    const updatedMs = timeMs(row.updated_at_ms) ?? timeMs(row.created_at_ms) ?? now;
    const matchingScope = matchingThreadImportScope(row, importScopes, updatedMs, cwdScopeMap);
    if (!matchingScope) continue;
    const itemKey = `${row.id}\u001f${normalizeLocalPath(matchingScope.repo_path)}`;
    if (seenItemKeys.has(itemKey)) continue;
    seenItemKeys.add(itemKey);
    const forcePlaceholderTitleRefresh = shouldInspectAiHistoryPlaceholderTitle(row, matchingScope, now);
    if (!forcePlaceholderTitleRefresh && !shouldInspectAiHistoryRollout(row, matchingScope, mode, now)) continue;

    try {
      const rawRollout = await readRollout(row);
      const summary = parseRollout(rawRollout, row);
      const linkedTask = linkedTaskForThread(row, tasks, cwdScopeMap);
      const prepared = aiHistoryItemFromThread({
        row,
        scope: matchingScope,
        summary,
        rawRollout,
        linkedTask,
        nowMs: now,
      });
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
  return upserted;
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
    for (const request of requests) {
      const normalized = normalizedHydrateRequest(request);
      if (!normalized) continue;
      if (hydrateRequestExpiresAtMs(normalized, now) <= now) continue;
      aiHistoryDetailWatchRequests.set(normalized.historyItemId, normalized);
    }
    trimCacheToLimit(aiHistoryDetailWatchRequests, ROLLOUT_INSPECT_CACHE_LIMIT);
    return requests.length;
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

function detailWatchFingerprint(request: AiHistoryDetailHydrateRequest, row: CodexThreadRow): string {
  return [
    request.historyItemId,
    request.requestedAt ?? '',
    request.expiresAt ?? '',
    threadRolloutFingerprint(row),
  ].join('\u001f');
}

function shouldInspectAiHistoryDetailRollout(
  request: AiHistoryDetailHydrateRequest,
  row: CodexThreadRow,
  nowMs = Date.now(),
): boolean {
  const fingerprint = detailWatchFingerprint(request, row);
  const cached = aiHistoryDetailRolloutInspectCache.get(request.historyItemId);
  if (!cached) return true;
  if (cached.fingerprint !== fingerprint) return true;
  if (nowMs >= cached.nextInspectAt) {
    aiHistoryDetailRolloutInspectCache.set(request.historyItemId, {
      fingerprint,
      nextInspectAt: nowMs + AI_HISTORY_DETAIL_FAST_WATCH_RECHECK_MS,
    });
  }
  return false;
}

function markAiHistoryDetailRolloutInspected(
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
  const rawRollout = await readRollout(row);
  const summary = parseRollout(rawRollout, row);
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
  for (const [historyItemId, request] of aiHistoryDetailWatchRequests.entries()) {
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
  const pendingArchiveRequest = sourceTaskCompleted;
  const nextStatus: AiTask['status'] = sourceTaskCompleted ? 'completed' : 'awaiting_approval';
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
    codex_archive_request_state: pendingArchiveRequest
      ? 'completed'
      : typeof current.codex_archive_request_state === 'string'
        ? current.codex_archive_request_state as TaskResultJson['codex_archive_request_state']
        : undefined,
    codex_archive_requested_at: typeof current.codex_archive_requested_at === 'string' ? current.codex_archive_requested_at : undefined,
    codex_archive_request_reason: typeof current.codex_archive_request_reason === 'string' ? current.codex_archive_request_reason : undefined,
    codex_archive_completed_at: pendingArchiveRequest
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

async function syncOneTask(api: AgentApiClient, runnerId: string, dbPath: string, task: AiTask): Promise<SyncOneTaskResult> {
  const threadId = taskThreadId(task) ?? await findMatchingThread(dbPath, task);
  if (!threadId) return 'unchanged';

  const row = await readThread(dbPath, threadId);
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
    const archived = await archiveCodexThreadViaAppServer(threadId).catch((archiveError) => {
      logError(`codex archive request failed for ${task.id}`, archiveError instanceof Error ? archiveError.message : archiveError);
      return false;
    });
    if (!archived) return 'unchanged';
    await markThreadGone(api, runnerId, task, threadId, 'archived');
    syncCache.delete(task.id);
    info(`codex thread archived from Focusmap node check task=${task.id} thread=${threadId.slice(0, 8)}`);
    return 'remove';
  }

  const nowMs = Date.now();
  if (!shouldInspectTaskRollout(task, row, threadId, nowMs)) return 'unchanged';

  const rolloutRaw = await readRollout(row);
  const summary = parseRollout(rolloutRaw, row);
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
    summary.latestTaskCompleteAt ?? '',
    summary.latestRunningActivityAt ?? '',
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
): NodeJS.Timeout {
  let running = false;
  let targetsLoaded = false;
  let nextTargetRefreshAt = 0;
  let nextReconcileAt = 0;
  let currentImportScopeSignature = '';
  let reconcileQueue: CodexThreadImportScope[] = [];
  let nextDetailHydratePollAt = 0;
  let tasks: AiTask[] = [];
  let importScopes: CodexThreadImportScope[] = [];
  let dbPath: string | null = null;

  const tick = async () => {
    if (running) return;
    dbPath = codexStateDbPath();
    if (!dbPath || !existsSync(dbPath)) {
      updateCodexThreadMonitorHeartbeatState({
        state_db_found: false,
        state_db_path: dbPath,
        last_tick_at: new Date().toISOString(),
      });
      return;
    }

    running = true;
    try {
      const now = Date.now();
      updateCodexThreadMonitorHeartbeatState({
        state_db_found: true,
        state_db_path: dbPath,
        last_tick_at: new Date(now).toISOString(),
        last_error: null,
      });
      if (!targetsLoaded || now >= nextTargetRefreshAt) {
        const wasTargetsLoaded = targetsLoaded;
        const [nextTasks, nextImportScopes] = await Promise.all([
          api.listCodexMonitorTasks(runnerId, MONITOR_LIMIT),
          listThreadImportScopes(api, runnerId),
        ]);
        const scopeHeartbeat = await importScopeHeartbeatScopes(nextImportScopes);
        const nextImportScopeSignature = importScopeSignature(nextImportScopes);
        if (!wasTargetsLoaded || nextImportScopeSignature !== currentImportScopeSignature) {
          currentImportScopeSignature = nextImportScopeSignature;
          reconcileQueue = prioritizeImportScopesForReconcile(nextImportScopes);
          nextReconcileAt = 0;
        }
        tasks = nextTasks;
        importScopes = nextImportScopes;
        targetsLoaded = true;
        nextTargetRefreshAt = Date.now() + targetRefreshIntervalMs;
        updateCodexThreadMonitorHeartbeatState({
          last_scope_refresh_at: new Date().toISOString(),
          last_scope_refresh_error: null,
          scopes: scopeHeartbeat,
        });
      }
      const preImportTasks = preImportCodexMonitorTasks(tasks);
      const preImportTaskIds = new Set(preImportTasks.map(task => task.id));
      let preImportSynced = 0;
      for (const task of preImportTasks) {
        if (!tasks.some(item => item.id === task.id)) continue;
        try {
          const result = await syncOneTask(api, runnerId, dbPath, task);
          if (result === 'remove') {
            tasks = tasks.filter(item => item.id !== task.id);
          }
          preImportSynced += 1;
          if (preImportSynced % PRE_IMPORT_SYNC_YIELD_EVERY === 0) await sleep(0);
        } catch (error) {
          logError(`codex monitor failed for ${task.id}`, error instanceof Error ? error.message : error);
        }
      }

      const detailPollIntervalMs = preImportTasks.length > 0 || aiHistoryDetailWatchRequests.size > 0
        ? AI_HISTORY_DETAIL_HYDRATE_ACTIVE_POLL_MS
        : AI_HISTORY_DETAIL_HYDRATE_POLL_MS;
      if (Date.now() >= nextDetailHydratePollAt) {
        await pollAiHistoryDetailHydrateRequests(api, runnerId);
        nextDetailHydratePollAt = Date.now() + detailPollIntervalMs;
      }
      const hydratedDetails = await syncAiHistoryDetailHydrateRequests(api, runnerId, dbPath);
      if (hydratedDetails > 0) debug(`ai history detail hydrated=${hydratedDetails}`);

      const deferOrphanImport = shouldDeferOrphanImportForTasks(preImportTasks);
      const hotUpserted = importScopes.length === 0
        ? 0
        : await syncAiHistoryMetadata(
          api,
          runnerId,
          dbPath,
          tasks,
          importScopes,
          'hot',
          AI_HISTORY_HOT_SYNC_LIMIT,
          false,
        );

      const shouldReconcile = importScopes.length > 0 &&
        (reconcileQueue.length > 0 || nextReconcileAt === 0 || Date.now() >= nextReconcileAt);
      if (shouldReconcile) {
        if (reconcileQueue.length === 0) {
          reconcileQueue = prioritizeImportScopesForReconcile(importScopes);
        }
        const scope = reconcileQueue.shift();
        if (scope) {
          const reconcileUpserted = await syncAiHistoryMetadata(
            api,
            runnerId,
            dbPath,
            tasks,
            [scope],
            'reconcile',
            AI_HISTORY_RECONCILE_SCOPE_BATCH_LIMIT,
            true,
          );
          await sleep(AI_HISTORY_RECONCILE_QUEUE_YIELD_MS);
          if (reconcileQueue.length === 0) {
            nextReconcileAt = Date.now() + reconcileIntervalMs;
          } else {
            nextReconcileAt = 0;
          }
          updateCodexThreadMonitorHeartbeatState({
            last_reconcile_at: new Date().toISOString(),
            next_reconcile_at: new Date(nextReconcileAt || Date.now()).toISOString(),
            last_reconcile_imported: hotUpserted + reconcileUpserted,
            last_reconcile_upserted: hotUpserted + reconcileUpserted,
          });
          debug(`ai history metadata reconcile scope=${scope.repo_path} upserted=${reconcileUpserted} queue=${reconcileQueue.length} next_in=${nextReconcileAt ? Math.round((nextReconcileAt - Date.now()) / 1000) : 0}s`);
        }
      }
      const postImportTasks = deferOrphanImport
        ? []
        : prioritizeCodexMonitorTasks(tasks)
          .filter(task => !preImportTaskIds.has(task.id))
          .slice(0, POST_IMPORT_SYNC_LIMIT);
      for (const task of postImportTasks) {
        try {
          const result = await syncOneTask(api, runnerId, dbPath, task);
          if (result === 'remove') {
            tasks = tasks.filter(item => item.id !== task.id);
          }
          await sleep(20);
        } catch (error) {
          logError(`codex monitor failed for ${task.id}`, error instanceof Error ? error.message : error);
        }
      }
    } catch (error) {
      updateCodexThreadMonitorHeartbeatState({
        last_error: error instanceof Error ? error.message : String(error),
      });
      logError('codex monitor loop error', error instanceof Error ? error.message : error);
    } finally {
      running = false;
    }
  };

  void tick();
  return setInterval(() => {
    void tick();
  }, intervalMs);
}
