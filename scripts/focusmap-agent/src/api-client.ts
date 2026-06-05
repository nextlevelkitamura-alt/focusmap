import type { AgentCommand, AgentConfig, AiTask, TaskResultJson } from './types.js';
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

  async claimTask(runnerId: string): Promise<AiTask | null> {
    const data = await this.request<{ task: AiTask | null }>('/agents/claim', {
      runner_id: runnerId,
      claim_ttl_seconds: 300,
    });
    return data.task;
  }

  async updateTaskState(
    runnerId: string,
    taskId: string,
    status: AiTask['status'],
    payload: { result?: TaskResultJson; error?: string } = {},
  ): Promise<void> {
    await this.request(`/agents/tasks/${taskId}/state`, {
      runner_id: runnerId,
      status,
      ...payload,
    });
    await this.request('/task-progress', {
      task_id: taskId,
      status,
      phase: status,
      current_step: payload.result?.message || payload.result?.live_log || payload.result?.output || undefined,
      summary: payload.result?.message,
      error_message: payload.error,
      progress_json: payload.result ?? undefined,
      event_type: `status:${status}`,
      event_payload: {
        runner_id: runnerId,
        status,
        error: payload.error,
      },
    }).catch(() => undefined);
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
