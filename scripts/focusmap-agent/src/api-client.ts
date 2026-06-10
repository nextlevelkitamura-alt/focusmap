import type { AgentActivityMessage, AgentCommand, AgentConfig, AiTask, CodexThreadImportPayload, TaskResultJson } from './types.js';
import type { ScreenshotPreviewBundle } from './screenshot-preview.js';

function normalizeApiUrl(value: string | undefined): string {
  const raw = value || 'https://focusmap-official.com/api';
  return raw.replace(/\/$/, '');
}

export function webOriginFromApiUrl(apiUrl: string | undefined): string {
  return normalizeApiUrl(apiUrl).replace(/\/api$/, '');
}

export class AgentApiClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly progressCache = new Map<string, { hash: string; sentAt: number }>();

  constructor(config: AgentConfig) {
    this.apiUrl = normalizeApiUrl(config.api_url);
    this.token = config.agent_token;
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : `Focusmap API error ${res.status}`);
    }
    return data as T;
  }

  private progressHash(body: Record<string, unknown>): string {
    const stable = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stable);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, stable(item)]),
      );
    };
    return JSON.stringify(stable(body));
  }

  private compactTaskResult(result: TaskResultJson | undefined): Record<string, unknown> | undefined {
    if (!result) return undefined;
    return {
      executor: result.executor,
      codex_run_state: result.codex_run_state,
      codex_review_reason: result.codex_review_reason,
      codex_thread_id: result.codex_thread_id,
      codex_thread_url: result.codex_thread_url,
      last_activity_at: result.last_activity_at,
      awaiting_approval_at: result.awaiting_approval_at,
      steps: result.steps?.slice(-8),
      message_chars: result.message?.length ?? 0,
      live_log_chars: result.live_log?.length ?? 0,
      output_chars: result.output?.length ?? 0,
    };
  }

  private stateResult(result: TaskResultJson | undefined): TaskResultJson | undefined {
    if (!result) return undefined;
    const persistedResult: TaskResultJson = { ...result };
    delete persistedResult.activity_messages;
    return persistedResult;
  }

  private compactText(value: string | undefined, maxChars: number, fromEnd = false): string | undefined {
    const text = value?.trim();
    if (!text) return undefined;
    if (text.length <= maxChars) return text;
    return fromEnd ? text.slice(-maxChars) : text.slice(0, maxChars);
  }

  private compactLogLine(value: string | undefined, maxChars: number): string | undefined {
    const text = value?.trim();
    if (!text) return undefined;
    const blocks = text
      .split(/\n{2,}|\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const latest = blocks.at(-1);
    return this.compactText(latest, maxChars, true);
  }

  private currentStepFromResult(result: TaskResultJson | undefined): string | undefined {
    if (!result) return undefined;
    if (result.executor === 'codex_app') {
      if (result.codex_run_state === 'awaiting_approval') return 'Codex実行が完了し確認待ちです';
      return 'Codex.appが作業中です';
    }
    const lastStep = result.steps?.slice().reverse().find((step) => step.label || step.detail);
    if (lastStep) {
      const detail = lastStep.detail ? `: ${lastStep.detail}` : '';
      return this.compactText(`${lastStep.label}${detail}`, 600, true);
    }
    return this.compactLogLine(result.live_log || result.output || result.message, 600);
  }

  private summaryFromResult(result: TaskResultJson | undefined): string | undefined {
    if (!result) return undefined;
    if (result.codex_run_state === 'awaiting_approval') {
      return 'Codex実行が完了し、Focusmapで承認待ちです。';
    }
    if (result.executor === 'codex_app') {
      return result.last_activity_at
        ? `Codex.appの稼働シグナルを確認中。最終活動 ${result.last_activity_at}`
        : 'Codex.appの稼働シグナルを確認中。';
    }
    const latestLog = this.compactLogLine(result.live_log || result.output || result.message, 1_200);
    return latestLog ?? this.compactText(result.message, 1_200, true);
  }

  private eventTypeForStatus(status: AiTask['status']): string {
    if (status === 'awaiting_approval' || status === 'completed' || status === 'failed') return status;
    return `status:${status}`;
  }

  async sendTaskProgressSnapshot(
    runnerId: string,
    taskId: string,
    status: AiTask['status'],
    payload: { result?: TaskResultJson; error?: string } = {},
    options: { force?: boolean; minIntervalMs?: number; eventType?: string } = {},
  ): Promise<boolean> {
    const result = payload.result;
    const currentStep = this.currentStepFromResult(result);
    const body: Record<string, unknown> = {
      task_id: taskId,
      status,
      phase: status,
      snapshot_only: !options.eventType,
      executor: result?.executor,
      codex_thread_id: result?.codex_thread_id,
      current_step: currentStep,
      summary: this.summaryFromResult(result),
      error_message: payload.error,
      last_activity_at: result?.last_activity_at,
      progress_json: this.compactTaskResult(result),
      event_type: options.eventType,
      event_payload: {
        runner_id: runnerId,
        status,
        error: payload.error,
        codex_thread_id: result?.codex_thread_id,
        codex_run_state: result?.codex_run_state,
      },
    };
    for (const key of Object.keys(body)) {
      if (body[key] === undefined) delete body[key];
    }

    const hash = this.progressHash(body);
    const minIntervalMs = options.minIntervalMs ?? 2_000;
    const cached = this.progressCache.get(taskId);
    const now = Date.now();
    if (!options.force && cached?.hash === hash) return false;
    if (!options.force && cached && now - cached.sentAt < minIntervalMs) return false;

    await this.request('/task-progress', body);
    this.progressCache.set(taskId, { hash, sentAt: now });
    return true;
  }

  private async multipartRequest<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : `Focusmap API error ${res.status}`);
    }
    return data as T;
  }

  async heartbeat(payload: Record<string, unknown>): Promise<{ runner: { id: string } }> {
    return this.request('/agents/heartbeat', payload);
  }

  async runnerHeartbeat(payload: Record<string, unknown>): Promise<{ heartbeat?: { last_seen_at: string } }> {
    return this.request('/task-progress/runner-heartbeats', payload);
  }

  async claimTask(runnerId: string): Promise<AiTask | null> {
    const data = await this.request<{ task: AiTask | null }>('/agents/claim', {
      runner_id: runnerId,
      claim_ttl_seconds: 300,
    });
    return data.task;
  }

  async listCodexMonitorTasks(runnerId: string, limit = 80): Promise<AiTask[]> {
    const data = await this.request<{ tasks: AiTask[] }>('/agents/codex-monitor/tasks', {
      runner_id: runnerId,
      limit,
    });
    return Array.isArray(data.tasks) ? data.tasks : [];
  }

  async importCodexThread(
    runnerId: string,
    thread: CodexThreadImportPayload,
  ): Promise<{ imported: boolean; reason?: string; ai_task_id?: string; source_task_id?: string }> {
    return this.request('/agents/codex-monitor/import-thread', {
      runner_id: runnerId,
      thread,
    });
  }

  async updateTaskState(
    runnerId: string,
    taskId: string,
    status: AiTask['status'],
    payload: { result?: TaskResultJson; error?: string; activity_messages?: AgentActivityMessage[] } = {},
  ): Promise<void> {
    const result = this.stateResult(payload.result);
    const activityMessages = payload.activity_messages ?? payload.result?.activity_messages;
    const eventType = this.eventTypeForStatus(status);
    const progress = this.sendTaskProgressSnapshot(runnerId, taskId, status, { result, error: payload.error }, {
      force: true,
      eventType,
    }).catch(() => undefined);
    await this.request(`/agents/tasks/${taskId}/state`, {
      runner_id: runnerId,
      status,
      ...(result ? { result } : {}),
      ...(payload.error ? { error: payload.error } : {}),
      ...(activityMessages?.length ? { activity_messages: activityMessages } : {}),
    });
    await progress;
  }

  async claimCommand(runnerId: string): Promise<AgentCommand | null> {
    const data = await this.request<{ command: AgentCommand | null }>('/agents/commands/claim', {
      runner_id: runnerId,
    });
    return data.command;
  }

  async completeCommand(
    runnerId: string,
    commandId: string,
    ok: boolean,
    payload: { result?: Record<string, unknown>; error?: string } = {},
  ): Promise<void> {
    await this.request(`/agents/commands/${commandId}/complete`, {
      runner_id: runnerId,
      ok,
      ...payload,
    });
  }

  async uploadScreenshotPreview(
    taskId: string,
    bundle: ScreenshotPreviewBundle,
    uploadReason: 'state_change' | 'error' | 'awaiting_approval' | 'user_requested' | 'manual' | 'interval' = 'interval',
  ): Promise<{ id: string; task_id: string; thumbnail_key: string | null; preview_key: string | null }> {
    const form = new FormData();
    form.set('task_id', taskId);
    form.set('captured_at', bundle.capturedAt);
    form.set('upload_reason', uploadReason);
    form.set('local_original_path_hash', bundle.localOriginalPathHash);
    if (bundle.width) form.set('width', String(bundle.width));
    if (bundle.height) form.set('height', String(bundle.height));
    form.set('preview', new Blob([new Uint8Array(bundle.previewWebp)], { type: 'image/webp' }), 'preview.webp');
    form.set('thumbnail', new Blob([new Uint8Array(bundle.thumbnailWebp)], { type: 'image/webp' }), 'thumbnail.webp');
    return this.multipartRequest('/screenshots', form);
  }
}
