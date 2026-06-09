import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AgentApiClient } from './api-client.js';
import type { AgentActivityMessage, AiTask, TaskResultJson } from './types.js';
import { debug, error as logError, info } from './logger.js';

const execFileAsync = promisify(execFile);
const SQLITE_BIN = '/usr/bin/sqlite3';
const MONITOR_LIMIT = 80;
const MAX_VISIBLE_MESSAGES = 8;
const syncCache = new Map<string, string>();
const DEFAULT_TARGET_REFRESH_INTERVAL_MS = 10_000;

type CodexThreadRow = {
  id: string;
  title?: string | null;
  tokens_used?: number | null;
  has_user_event?: number | boolean | null;
  archived?: number | boolean | null;
  updated_at_ms?: number | null;
  preview?: string | null;
  rollout_path?: string | null;
  source?: string | null;
  cwd?: string | null;
  first_user_message?: string | null;
};

type VisibleMessage = {
  role: 'user' | 'codex';
  kind: AgentActivityMessage['kind'];
  body: string;
  createdAt: string | null;
  sourceEvent: string;
};

type RolloutSummary = {
  state: 'running' | 'awaiting_approval';
  reviewReason: string;
  currentStep: string;
  lastActivityAt: string | null;
  latestUserMessageAt: string | null;
  latestTaskStartedAt: string | null;
  latestTaskCompleteAt: string | null;
  latestAgentMessage: string | null;
  visibleMessages: VisibleMessage[];
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function textFingerprint(value: string): string {
  return compactText(value, 500).toLowerCase().replace(/\s+/g, ' ').slice(0, 180);
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

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function sqliteJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync(SQLITE_BIN, ['-json', dbPath, sql], { timeout: 5_000 });
  const text = stdout.trim();
  if (!text) return [];
  return JSON.parse(text) as T[];
}

async function readThread(dbPath: string, threadId: string): Promise<CodexThreadRow | null> {
  const rows = await sqliteJson<CodexThreadRow>(
    dbPath,
    [
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, preview, rollout_path, source, cwd, first_user_message',
      'FROM threads',
      `WHERE id = ${sqlString(threadId)}`,
      'LIMIT 1',
    ].join(' '),
  );
  return rows[0] ?? null;
}

function appendVisibleMessage(messages: VisibleMessage[], input: VisibleMessage): void {
  const body = compactText(input.body, 2_000);
  if (!body) return;
  const key = `${input.role}:${input.kind}:${textFingerprint(body)}`;
  if (messages.some(message => `${message.role}:${message.kind}:${textFingerprint(message.body)}` === key)) return;
  messages.push({ ...input, body });
  while (messages.length > 40) messages.shift();
}

export function parseRollout(rawJsonl: string, row: CodexThreadRow): RolloutSummary {
  const visibleMessages: VisibleMessage[] = [];
  let state: RolloutSummary['state'] = row.archived ? 'awaiting_approval' : 'running';
  let reviewReason = row.archived ? 'archived' : 'started';
  let currentStep = row.archived ? 'Codex thread は確認待ちです' : 'Codex.appで実行中';
  let lastActivityAt = timestampToIso(row.updated_at_ms ?? null);
  let latestUserMessageAt: string | null = null;
  let latestTaskStartedAt: string | null = null;
  let latestTaskCompleteAt: string | null = null;
  let latestAgentMessage: string | null = null;

  for (const line of rawJsonl.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const rowTime = timestampToIso(parsed.timestamp);
    if (rowTime) lastActivityAt = rowTime;

    const payload = isRecord(parsed.payload) ? parsed.payload : {};
    const payloadType = typeof payload.type === 'string' ? payload.type : '';
    const payloadTime = timestampToIso(payload.timestamp ?? payload.started_at ?? payload.completed_at);
    const eventTime = latestIso(rowTime, payloadTime) ?? lastActivityAt;
    if (eventTime) lastActivityAt = eventTime;

    if (payloadType === 'task_started') {
      latestTaskStartedAt = eventTime;
      state = 'running';
      reviewReason = 'started';
      currentStep = 'Codexが実行を開始しました';
      continue;
    }

    if (payloadType === 'task_complete') {
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      reviewReason = 'completed';
      currentStep = 'Codexが実行完了し確認待ちです';
      const text = safeText(payload.last_agent_message);
      if (text) {
        latestAgentMessage = compactText(text, 2_000);
        appendVisibleMessage(visibleMessages, {
          role: 'codex',
          kind: looksLikeQuestion(text) ? 'question' : 'completed',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'task_complete',
        });
      }
      continue;
    }

    if (payloadType === 'turn_aborted') {
      latestTaskCompleteAt = eventTime;
      state = 'awaiting_approval';
      reviewReason = 'aborted';
      currentStep = 'Codexのターンが停止し確認待ちです';
      continue;
    }

    if (payloadType === 'agent_message') {
      const text = safeText(payload);
      if (text) {
        latestAgentMessage = compactText(text, 2_000);
        currentStep = compactStep(text);
        appendVisibleMessage(visibleMessages, {
          role: 'codex',
          kind: looksLikeQuestion(text) ? 'question' : 'progress',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'agent_message',
        });
      }
      continue;
    }

    if (payloadType === 'user_message') {
      const text = safeText(payload);
      if (text && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime;
        appendVisibleMessage(visibleMessages, {
          role: 'user',
          kind: 'user_answer',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'user_message',
        });
      }
      continue;
    }

    if (payloadType === 'message') {
      const role = typeof payload.role === 'string' ? payload.role : '';
      const text = safeText(payload);
      if (!text) continue;
      if (role === 'assistant') {
        latestAgentMessage = compactText(text, 2_000);
        currentStep = compactStep(text);
        appendVisibleMessage(visibleMessages, {
          role: 'codex',
          kind: looksLikeQuestion(text) ? 'question' : 'progress',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'message',
        });
      } else if (role === 'user' && !isInternalUserMessage(text)) {
        latestUserMessageAt = eventTime;
        appendVisibleMessage(visibleMessages, {
          role: 'user',
          kind: 'user_answer',
          body: text,
          createdAt: eventTime,
          sourceEvent: 'message',
        });
      }
    }
  }

  if (!rawJsonl.trim() && row.preview) {
    currentStep = compactStep(row.preview);
  }

  return {
    state,
    reviewReason,
    currentStep,
    lastActivityAt,
    latestUserMessageAt,
    latestTaskStartedAt,
    latestTaskCompleteAt,
    latestAgentMessage,
    visibleMessages,
  };
}

function taskThreadId(task: AiTask): string | null {
  if (task.codex_thread_id?.trim()) return task.codex_thread_id.trim();
  const result = isRecord(task.result) ? task.result : {};
  const resultThreadId = result.codex_thread_id;
  return typeof resultThreadId === 'string' && resultThreadId.trim() ? resultThreadId.trim() : null;
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
  ].filter((value): value is number => value !== null);
  return candidates.some(value => value > checkpoint);
}

export function taskStateForSummary(task: AiTask, summary: RolloutSummary) {
  const resumed = didResumeAfterCheckpoint(task, summary);
  if (resumed) {
    const resumeMs = Math.max(
      timeMs(summary.latestUserMessageAt) ?? 0,
      timeMs(summary.latestTaskStartedAt) ?? 0,
    );
    const completedMs = timeMs(summary.latestTaskCompleteAt) ?? 0;
    if (completedMs >= resumeMs) return { status: 'awaiting_approval' as const, resumed: true };
    return { status: 'running' as const, resumed: true };
  }
  if (wasWaitingForReview(task) && summary.state === 'running') {
    return { status: 'awaiting_approval' as const, resumed: false };
  }
  return { status: summary.state === 'awaiting_approval' ? 'awaiting_approval' as const : 'running' as const, resumed: false };
}

function activityMessages(task: AiTask, threadId: string, summary: RolloutSummary, resumed: boolean): AgentActivityMessage[] {
  const checkpoint = checkpointMs(task) ?? 0;
  const messages: AgentActivityMessage[] = [];
  if (resumed) {
    messages.push({
      role: 'status',
      kind: 'resumed',
      body: '確認待ち後の追加プロンプトを検知しました。Codex実行を再開します。',
      importance: 'important',
      dedupe_key: `thread:${threadId}:resumed:${checkpoint}`,
    });
  }

  for (const message of summary.visibleMessages.slice(-MAX_VISIBLE_MESSAGES)) {
    const messageMs = timeMs(message.createdAt) ?? 0;
    if (!resumed && messageMs <= checkpoint) continue;
    messages.push({
      role: message.role,
      kind: message.kind,
      body: message.body,
      importance: message.kind === 'progress' ? 'normal' : 'important',
      created_at: message.createdAt ?? undefined,
      dedupe_key: `thread:${threadId}:${message.role}:${message.kind}:${textFingerprint(message.body)}`,
      metadata: { source: 'codex_thread_monitor', source_event: message.sourceEvent },
    });
  }

  return messages.slice(-12);
}

function resultSnapshot(
  task: AiTask,
  threadId: string,
  row: CodexThreadRow,
  summary: RolloutSummary,
  status: AiTask['status'],
  resumed: boolean,
): TaskResultJson {
  const result = taskResult(task);
  const nowIso = new Date().toISOString();
  const lastActivityAt = summary.lastActivityAt ?? timestampToIso(row.updated_at_ms) ?? nowIso;
  return {
    executor: task.executor === 'codex' ? 'codex' : 'codex_app',
    steps: Array.isArray(result.steps) ? result.steps as TaskResultJson['steps'] : [],
    output: '',
    message: status === 'running'
      ? 'Codex側の追加プロンプトを検知し、実行中です。'
      : 'Codex セッションは確認待ちです。内容を確認してください。',
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_run_state: status === 'running' ? 'running' : 'awaiting_approval',
    codex_review_reason: status === 'running' ? 'started' : summary.reviewReason,
    current_step: summary.currentStep,
    last_activity_at: lastActivityAt,
    awaiting_approval_at: status === 'awaiting_approval'
      ? (typeof result.awaiting_approval_at === 'string' ? result.awaiting_approval_at : nowIso)
      : undefined,
    codex_visible_messages: activityMessages(task, threadId, summary, resumed),
    meta: {
      monitor: 'focusmap-agent',
      thread_title: row.title ?? null,
      thread_updated_at_ms: row.updated_at_ms ?? null,
      thread_archived: Boolean(row.archived),
      preview_chars: typeof row.preview === 'string' ? row.preview.length : 0,
    },
  };
}

async function readRollout(row: CodexThreadRow): Promise<string> {
  if (!row.rollout_path || !existsSync(row.rollout_path)) return '';
  return await readFile(row.rollout_path, 'utf-8').catch(() => '');
}

type SyncOneTaskResult = 'synced' | 'unchanged' | 'remove';

async function markThreadGone(api: AgentApiClient, runnerId: string, task: AiTask, threadId: string, reason: 'thread_deleted' | 'archived'): Promise<void> {
  const nowIso = new Date().toISOString();
  const result: TaskResultJson = {
    executor: task.executor === 'codex' ? 'codex' : 'codex_app',
    steps: [],
    output: '',
    message: reason === 'archived'
      ? 'Codex thread がアーカイブされたため監視を停止しました。'
      : 'Codex thread が見つからないため監視を停止しました。',
    codex_thread_id: threadId,
    codex_thread_url: `codex://threads/${threadId}`,
    codex_run_state: 'awaiting_approval',
    codex_review_reason: reason,
    last_activity_at: nowIso,
    awaiting_approval_at: nowIso,
  };
  await api.updateTaskState(runnerId, task.id, 'completed', {
    result,
    activity_messages: [{
      role: 'status',
      kind: 'completed',
      body: result.message ?? 'Codex thread の監視を停止しました。',
      importance: 'important',
      dedupe_key: `thread:${threadId}:${reason}`,
    }],
  });
  task.status = 'completed';
  task.completed_at = nowIso;
  task.result = result as unknown as Record<string, unknown>;
}

async function syncOneTask(api: AgentApiClient, runnerId: string, dbPath: string, task: AiTask): Promise<SyncOneTaskResult> {
  const threadId = taskThreadId(task) ?? await findMatchingThread(dbPath, task);
  if (!threadId) return 'unchanged';

  const row = await readThread(dbPath, threadId);
  if (!row) {
    await markThreadGone(api, runnerId, task, threadId, 'thread_deleted');
    syncCache.delete(task.id);
    return 'remove';
  }
  if (row.archived) {
    await markThreadGone(api, runnerId, task, threadId, 'archived');
    syncCache.delete(task.id);
    return 'remove';
  }

  const rolloutRaw = await readRollout(row);
  const summary = parseRollout(rolloutRaw, row);
  const { status, resumed } = taskStateForSummary(task, summary);
  const lastActivityAt = summary.lastActivityAt ?? timestampToIso(row.updated_at_ms) ?? '';
  const cacheKey = [
    status,
    resumed ? 'resumed' : 'steady',
    lastActivityAt,
    summary.currentStep,
    summary.latestUserMessageAt ?? '',
    summary.latestTaskCompleteAt ?? '',
  ].join('\u001f');

  const previousResult = taskResult(task);
  const previousState = typeof previousResult.codex_run_state === 'string' ? previousResult.codex_run_state : '';
  const shouldSync =
    syncCache.get(task.id) !== cacheKey ||
    task.status !== status ||
    (status === 'running' && previousState !== 'running') ||
    (resumed && task.status !== 'running');

  if (!shouldSync) return 'unchanged';
  syncCache.set(task.id, cacheKey);

  const nextResult = resultSnapshot(task, threadId, row, summary, status, resumed);
  await api.updateTaskState(runnerId, task.id, status, {
    result: nextResult,
    activity_messages: activityMessages(task, threadId, summary, resumed),
  });
  task.status = status;
  task.result = nextResult as unknown as Record<string, unknown>;

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
  intervalMs = 2_000,
  targetRefreshIntervalMs = DEFAULT_TARGET_REFRESH_INTERVAL_MS,
): NodeJS.Timeout {
  let running = false;
  let targetsLoaded = false;
  let nextTargetRefreshAt = 0;
  let tasks: AiTask[] = [];
  const dbPath = join(homedir(), '.codex', 'state_5.sqlite');

  const tick = async () => {
    if (running) return;
    if (!existsSync(dbPath)) return;

    running = true;
    try {
      const now = Date.now();
      if (!targetsLoaded || now >= nextTargetRefreshAt) {
        tasks = await api.listCodexMonitorTasks(runnerId, MONITOR_LIMIT);
        targetsLoaded = true;
        nextTargetRefreshAt = Date.now() + targetRefreshIntervalMs;
      }
      for (const task of tasks) {
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
