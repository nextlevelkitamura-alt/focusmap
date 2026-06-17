import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { AgentApiClient } from '../api-client.js';
import type { AgentActivityMessage, AgentConfig, AiTask, StepLog, TaskResultJson } from '../types.js';

const WS_URL = 'ws://127.0.0.1:7878';
const CONNECT_TIMEOUT_MS = 10_000;
const TURN_TIMEOUT_MS = 15 * 60 * 1000;
const LOG_FLUSH_MS = 2_000;
const CODEX_APP_BIN = '/Applications/Codex.app/Contents/Resources/codex';
const MAX_VISIBLE_ACTIVITY_MESSAGES = 8;

type RpcEnvelope = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

type RpcPending = {
  resolve: (msg: RpcEnvelope) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pathExists(path: string, mode = constants.R_OK): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function assertDirectory(path: string): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Codexの作業ディレクトリが見つかりません: ${path}`);
  }
}

function normalizePrompt(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).join('');
  if (typeof value !== 'object') return '';

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.delta === 'string') return record.delta;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) return record.content.map(extractText).join('');
  if (Array.isArray(record.parts)) return record.parts.map(extractText).join('');
  return '';
}

function normalizeActivityBody(text: string, maxChars = 2_000): string {
  return text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, maxChars);
}

function textFingerprint(text: string): string {
  return normalizeActivityBody(text, 500).toLowerCase().replace(/\s+/g, ' ').slice(0, 180);
}

function codexActivityKindForText(text: string): AgentActivityMessage['kind'] {
  return /確認|承認|許可|選んで|どうします|どうしますか|approve|confirm|permission|\?/i.test(text)
    ? 'question'
    : 'progress';
}

async function isCodexAppServerReady(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let settled = false;
    const timer = setTimeout(() => finish(false), timeoutMs);
    function finish(ready: boolean) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off('open', handleOpen);
      ws.off('error', handleError);
      ws.on('error', () => undefined);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      resolve(ready);
    }
    function handleOpen() {
      finish(true);
    }
    function handleError() {
      finish(false);
    }
    ws.once('open', handleOpen);
    ws.once('error', handleError);
  });
}

async function resolveCodexBin(): Promise<string> {
  if (process.env.FOCUSMAP_CODEX_BIN?.trim()) return process.env.FOCUSMAP_CODEX_BIN.trim();
  if (await pathExists(CODEX_APP_BIN, constants.X_OK)) return CODEX_APP_BIN;
  return 'codex';
}

async function startCodexAppServer(config: AgentConfig): Promise<void> {
  if (await isCodexAppServerReady()) return;

  const logDir = join(homedir(), '.focusmap', 'logs');
  await mkdir(logDir, { recursive: true }).catch(() => undefined);
  const codexBin = await resolveCodexBin();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: config.path || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',
    CODEX_HOME: process.env.CODEX_HOME || join(homedir(), '.codex'),
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.CLAUDECODE;

  const child = spawn(codexBin, ['app-server', '--listen', WS_URL], {
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();

  const startedAt = Date.now();
  while (Date.now() - startedAt < CONNECT_TIMEOUT_MS) {
    if (await isCodexAppServerReady()) return;
    await sleep(500);
  }

  throw new Error('Codex app-serverを起動できませんでした。Codex.appを開いてログイン後、もう一度実行してください。');
}

class RpcClient {
  private readonly ws: WebSocket;
  private nextId = 0;
  private readonly pending = new Map<number, RpcPending>();
  private readonly notificationHandlers = new Set<(msg: RpcEnvelope) => void>();

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      let msg: RpcEnvelope;
      try {
        msg = JSON.parse(data.toString()) as RpcEnvelope;
      } catch {
        return;
      }

      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        const pending = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        pending.resolve(msg);
        return;
      }

      if (msg.method) {
        for (const handler of this.notificationHandlers) handler(msg);
      }
    });
    ws.on('error', (error) => {
      for (const [id, pending] of this.pending) {
        this.pending.delete(id);
        clearTimeout(pending.timer);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  call(method: string, params?: unknown, timeoutMs = 30_000): Promise<RpcEnvelope> {
    const id = ++this.nextId;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server RPC timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  notify(method: string, params?: unknown): void {
    const payload = params === undefined
      ? { jsonrpc: '2.0', method }
      : { jsonrpc: '2.0', method, params };
    this.ws.send(JSON.stringify(payload));
  }

  onNotification(handler: (msg: RpcEnvelope) => void): void {
    this.notificationHandlers.add(handler);
  }
}

function connectRpc(): Promise<{ ws: WebSocket; rpc: RpcClient }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Codex app-serverへの接続がタイムアウトしました'));
    }, CONNECT_TIMEOUT_MS);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve({ ws, rpc: new RpcClient(ws) });
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function callOk(rpc: RpcClient, method: string, params: unknown): Promise<RpcEnvelope | null> {
  const response = await rpc.call(method, params).catch((error): RpcEnvelope => ({
    error: { message: error instanceof Error ? error.message : String(error) },
  }));
  return response.error ? null : response;
}

export async function archiveCodexThreadViaAppServer(threadId: string): Promise<boolean> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return false;

  const { ws, rpc } = await connectRpc();
  try {
    const initResp = await callOk(rpc, 'initialize', {
      clientInfo: { name: 'focusmap', title: 'Focusmap', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    if (!initResp) return false;
    rpc.notify('initialized');

    const archiveResp = await callOk(rpc, 'thread/archive', { threadId: normalizedThreadId });
    return Boolean(archiveResp);
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  }
}

function addStep(steps: StepLog[], label: string, status: StepLog['status'] = 'done', detail?: string): void {
  steps.push({ label, status, detail, at: new Date().toISOString() });
}

function openCodexThread(threadId: string): void {
  if (process.platform !== 'darwin') return;
  try {
    const child = spawn('/usr/bin/open', [`codex://threads/${threadId}`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Codex.appの表示失敗は、app-server実行自体とは分けて扱う。
  }
}

export async function runCodexAppTask(
  task: AiTask,
  config: AgentConfig,
  api: AgentApiClient,
  runnerId: string,
): Promise<TaskResultJson> {
  const cwd = task.cwd?.trim();
  if (!cwd) throw new Error('Codex.app実行には作業ディレクトリ(cwd)が必要です');
  await assertDirectory(cwd);

  const prompt = normalizePrompt(task.prompt);
  if (!prompt) throw new Error('Codexに渡すプロンプトが空です');

  const steps: StepLog[] = [];
  const logEntries: string[] = [];
  const activeAgentMessages = new Map<string, string>();
  const visibleActivityMessages: AgentActivityMessage[] = [];
  const visibleActivityKeys = new Set<string>();
  const seenNotifications = new Set<string>();
  let flushTimer: NodeJS.Timeout | null = null;
  let threadId = task.codex_resume_thread_id || task.codex_thread_id || '';
  let lastActivityAt = new Date().toISOString();

  const resultSnapshot = (extra: Record<string, unknown> = {}): TaskResultJson => ({
    executor: 'codex_app',
    steps,
    output: '',
    message: 'Codex.appが作業中です',
    codex_thread_id: threadId || undefined,
    codex_thread_url: threadId ? `codex://threads/${threadId}` : undefined,
    codex_run_state: 'running',
    codex_review_reason: 'started',
    last_activity_at: lastActivityAt,
    codex_visible_messages: visibleActivityMessages.slice(-MAX_VISIBLE_ACTIVITY_MESSAGES),
    meta: {
      cwd,
      prompt_chars: prompt.length,
      codex_seen_notifications: [...seenNotifications],
      ...extra,
    },
  });

  const flushState = async (force = false, eventType?: string) => {
    await api.sendTaskProgressSnapshot(
      runnerId,
      task.id,
      'running',
      { result: resultSnapshot() },
      { force, eventType },
    );
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushState().catch(() => undefined);
    }, LOG_FLUSH_MS);
  };

  const appendLog = (entry: string) => {
    if (!entry.trim()) return;
    lastActivityAt = new Date().toISOString();
    logEntries.push(entry.trim());
    if (logEntries.length > 200) logEntries.splice(0, logEntries.length - 200);
    scheduleFlush();
  };

  const pushVisibleActivity = (input: {
    role: AgentActivityMessage['role'];
    kind: AgentActivityMessage['kind'];
    body: string;
    importance?: AgentActivityMessage['importance'];
    createdAt?: string;
    dedupeKey?: string;
    metadata?: Record<string, unknown>;
  }) => {
    const body = normalizeActivityBody(input.body);
    if (!body) return;
    const fingerprint = `${input.role}:${input.kind}:${textFingerprint(body)}`;
    if (visibleActivityKeys.has(fingerprint)) return;
    visibleActivityKeys.add(fingerprint);
    visibleActivityMessages.push({
      role: input.role,
      kind: input.kind,
      body,
      importance: input.importance ?? (input.kind === 'progress' ? 'normal' : 'important'),
      created_at: input.createdAt ?? new Date().toISOString(),
      dedupe_key: input.dedupeKey ?? `thread:${threadId || task.id}:visible:${fingerprint}`,
      metadata: {
        source: 'codex_app_notification',
        ...(input.metadata ?? {}),
      },
    });
    if (visibleActivityMessages.length > MAX_VISIBLE_ACTIVITY_MESSAGES) {
      visibleActivityMessages.splice(0, visibleActivityMessages.length - MAX_VISIBLE_ACTIVITY_MESSAGES);
    }
  };

  const flushActiveAgentMessages = () => {
    for (const [itemId, text] of activeAgentMessages) {
      const body = normalizeActivityBody(text);
      if (!body) continue;
      pushVisibleActivity({
        role: 'codex',
        kind: codexActivityKindForText(body),
        body,
        dedupeKey: `thread:${threadId || task.id}:assistant:${itemId}:${textFingerprint(body)}`,
        metadata: { item_id: itemId, source_event: 'agent_message_delta' },
      });
    }
    activeAgentMessages.clear();
  };

  await startCodexAppServer(config);
  addStep(steps, 'Codex app-serverに接続');

  const { ws, rpc } = await connectRpc();
  const cleanup = () => {
    if (flushTimer) clearTimeout(flushTimer);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  try {
    const initResp = await callOk(rpc, 'initialize', {
      clientInfo: { name: 'focusmap', title: 'Focusmap', version: '0.2.0' },
      capabilities: { experimentalApi: true },
    });
    if (!initResp) throw new Error('Codex app-server initializeに失敗しました');
    rpc.notify('initialized');

    if (threadId) {
      const resumeResp = await callOk(rpc, 'thread/resume', {
        threadId,
        persistExtendedHistory: false,
        excludeTurns: true,
      });
      if (!resumeResp) throw new Error('Codex threadの再開に失敗しました');
      addStep(steps, 'Codex threadを再開', 'done', threadId.slice(0, 8));
    } else {
      const threadShapes: Array<Record<string, unknown>> = [
        {
          cwd,
          approvalPolicy: 'never',
          experimentalRawEvents: true,
          persistExtendedHistory: true,
          threadSource: 'user',
        },
        { cwd, approvalPolicy: 'never', threadSource: 'user' },
        { cwd },
      ];
      let threadResp: RpcEnvelope | null = null;
      for (const shape of threadShapes) {
        threadResp = await callOk(rpc, 'thread/start', shape);
        if (threadResp) break;
      }
      if (!threadResp) throw new Error('Codex threadの作成に失敗しました');
      const threadResult = threadResp.result as { thread?: { id?: string }; threadId?: string } | undefined;
      threadId = threadResult?.thread?.id ?? threadResult?.threadId ?? '';
      if (!threadId) throw new Error('Codex thread idを取得できませんでした');
      addStep(steps, 'Codex threadを作成', 'done', threadId.slice(0, 8));
    }

    openCodexThread(threadId);
    await flushState(true, 'codex_thread_ready');

    let completed = false;
    let completedStatus = 'completed';
    let completedError: unknown = null;

    rpc.onNotification((msg) => {
      const method = msg.method ?? '';
      seenNotifications.add(method);
      const params = msg.params as Record<string, unknown> | undefined;
      if (!params) return;

      if (method === 'item/agentMessage/delta') {
        const itemId = typeof params.itemId === 'string' ? params.itemId : null;
        const delta = extractText(params.delta);
        if (itemId && delta) {
          lastActivityAt = new Date().toISOString();
          activeAgentMessages.set(itemId, (activeAgentMessages.get(itemId) ?? '') + delta);
          scheduleFlush();
        }
        return;
      }

      const item = (params.item ?? params.message) as Record<string, unknown> | undefined;
      if (item) {
        const itemType = typeof item.type === 'string' ? item.type : 'item';
        if (itemType === 'agentMessage') {
          const itemId = typeof item.id === 'string' ? item.id : null;
          const text = extractText(item) || (itemId ? activeAgentMessages.get(itemId) ?? '' : '');
          if (itemId) activeAgentMessages.delete(itemId);
          if (text) {
            appendLog(`[assistant] ${text}`);
            pushVisibleActivity({
              role: 'codex',
              kind: codexActivityKindForText(text),
              body: text,
              dedupeKey: `thread:${threadId || task.id}:assistant:${itemId || textFingerprint(text)}`,
              metadata: { item_id: itemId, source_event: method },
            });
          }
        } else if (itemType === 'userMessage' && method === 'item/completed') {
          appendLog(`[user] プロンプト送信済み (${extractText(item).length}文字)`);
        } else if (itemType === 'commandExecution') {
          const command = typeof item.command === 'string' ? item.command : '(command)';
          const status = typeof item.status === 'string' ? item.status : '';
          if (method === 'item/started') appendLog(`[command:started] ${command}`);
          if (method === 'item/completed') appendLog(`[command:${status || 'completed'}] ${command}`);
        }
      }

      if (/^(turn|thread).*(complet|finish|end|done)/i.test(method)) {
        const turn = (params.turn ?? params.task) as { status?: string; error?: unknown } | undefined;
        if (turn?.status) completedStatus = turn.status;
        completedError = turn?.error ?? null;
        completed = true;
      }
      if (/^(turn|thread).*(fail|error|interrupt)/i.test(method) && method !== 'item/error') {
        completed = true;
        completedStatus = 'failed';
      }
    });

    const turnShapes: Array<Record<string, unknown>> = [
      { threadId, input: [{ type: 'text', text: prompt }], approvalPolicy: 'never' },
      { threadId, input: [{ type: 'text', text: prompt }] },
      { threadId, items: [{ type: 'text', text: prompt }] },
      { threadId, text: prompt },
    ];
    let turnResp: RpcEnvelope | null = null;
    for (const shape of turnShapes) {
      turnResp = await callOk(rpc, 'turn/start', shape);
      if (turnResp) break;
    }
    if (!turnResp) throw new Error('Codex turn/startに失敗しました');
    addStep(steps, 'プロンプト送信完了');
    await flushState(true, 'codex_prompt_sent');

    const startedAt = Date.now();
    while (!completed) {
      if (Date.now() - startedAt > TURN_TIMEOUT_MS) {
        throw new Error(`Codex実行が${TURN_TIMEOUT_MS / 60_000}分以内に完了しませんでした`);
      }
      await sleep(1000);
    }

    const statusKey = completedStatus.trim().toLowerCase();
    const hasError = Boolean(completedError) || statusKey.includes('fail') || statusKey.includes('error') || statusKey.includes('abort');
    if (hasError) {
      addStep(steps, `Codex実行失敗 (${completedStatus || 'unknown'})`, 'failed');
      throw new Error(`Codex turn ${completedStatus || 'unknown'}: ${JSON.stringify(completedError ?? {}).slice(0, 500)}`);
    }

    addStep(steps, `Codex実行完了 (${completedStatus || 'completed'})`);
    flushActiveAgentMessages();
    const awaitingApprovalAt = new Date().toISOString();
    const finalVisibleMessages = visibleActivityMessages.slice(-MAX_VISIBLE_ACTIVITY_MESSAGES);
    return {
      ...resultSnapshot({ codex_turn_status: completedStatus }),
      output: '',
      message: 'Codex実行が完了し確認待ちです。',
      codex_run_state: 'awaiting_approval',
      codex_review_reason: 'completed',
      awaiting_approval_at: awaitingApprovalAt,
      codex_visible_messages: finalVisibleMessages,
      activity_messages: finalVisibleMessages,
    };
  } finally {
    cleanup();
  }
}
