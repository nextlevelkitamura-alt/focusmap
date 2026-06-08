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
      'SELECT id, title, tokens_used, has_user_event, archived, updated_at_ms, preview, rollout_path, source, cwd',
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

function parseRollout(rawJsonl: string, row: CodexThreadRow): RolloutSummary {
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
    const eventTime = payloadTime ?? rowTime ?? lastActivityAt;
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

function didResumeAfterCheckpoint(task: AiTask, summary: RolloutSummary, row: CodexThreadRow): boolean {
  const checkpoint = checkpointMs(task);
  if (checkpoint === null) return false;
  const candidates = [
    timeMs(summary.latestUserMessageAt),
    timeMs(summary.latestTaskStartedAt),
    timeMs(row.updated_at_ms),
  ].filter((value): value is number => value !== null);
  return candidates.some(value => value > checkpoint);
}

function taskStateForSummary(task: AiTask, summary: RolloutSummary, row: CodexThreadRow) {
  const resumed = didResumeAfterCheckpoint(task, summary, row);
  if (resumed) {
    const resumeMs = Math.max(
      timeMs(summary.latestUserMessageAt) ?? 0,
      timeMs(summary.latestTaskStartedAt) ?? 0,
      timeMs(row.updated_at_ms) ?? 0,
    );
    const completedMs = timeMs(summary.latestTaskCompleteAt) ?? 0;
    if (completedMs > resumeMs) return { status: 'awaiting_approval' as const, resumed: true };
    return { status: 'running' as const, resumed: true };
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
}

async function syncOneTask(api: AgentApiClient, runnerId: string, dbPath: string, task: AiTask): Promise<void> {
  const threadId = taskThreadId(task);
  if (!threadId) return;

  const row = await readThread(dbPath, threadId);
  if (!row) {
    await markThreadGone(api, runnerId, task, threadId, 'thread_deleted');
    syncCache.delete(task.id);
    return;
  }
  if (row.archived) {
    await markThreadGone(api, runnerId, task, threadId, 'archived');
    syncCache.delete(task.id);
    return;
  }

  const rolloutRaw = await readRollout(row);
  const summary = parseRollout(rolloutRaw, row);
  const { status, resumed } = taskStateForSummary(task, summary, row);
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

  if (!shouldSync) return;
  syncCache.set(task.id, cacheKey);

  await api.updateTaskState(runnerId, task.id, status, {
    result: resultSnapshot(task, threadId, row, summary, status, resumed),
    activity_messages: activityMessages(task, threadId, summary, resumed),
  });

  if (resumed) {
    info(`codex thread resumed task=${task.id} thread=${threadId.slice(0, 8)}`);
  } else {
    debug(`codex thread synced task=${task.id} status=${status}`);
  }
}

export function startCodexThreadMonitorLoop(
  api: AgentApiClient,
  runnerId: string,
  intervalMs = 3_000,
): NodeJS.Timeout {
  let running = false;
  const dbPath = join(homedir(), '.codex', 'state_5.sqlite');

  const tick = async () => {
    if (running) return;
    if (!existsSync(dbPath)) return;

    running = true;
    try {
      const tasks = await api.listCodexMonitorTasks(runnerId, MONITOR_LIMIT);
      for (const task of tasks) {
        try {
          await syncOneTask(api, runnerId, dbPath, task);
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
