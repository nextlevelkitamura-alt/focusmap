import type { AgentCommand, AgentConfig, AiTask, TaskResultJson } from './types.js';

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
}
