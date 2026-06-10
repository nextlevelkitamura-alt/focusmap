import type { AgentConfig } from './types.js';
import type { AgentApiClient } from './api-client.js';
import { collectCapabilities } from './capabilities.js';
import { error as logError } from './logger.js';

const MAX_HEARTBEAT_BACKOFF_MS = 5 * 60_000;
const FULL_REGISTRATION_ACTIVE_INTERVAL_MS = 60_000;
const FULL_REGISTRATION_IDLE_INTERVAL_MS = 10 * 60_000;
const AGENT_VERSION = '0.2.1';
const CODEX_THREAD_IMPORT_API_PATH = '/api/agents/codex-monitor/import-thread';

export async function upsertRunner(api: AgentApiClient, config: AgentConfig): Promise<string> {
  const capabilities = await collectCapabilities(config);
  const { runner } = await api.heartbeat({
    hostname: config.hostname,
    display_name: config.display_name ?? `${config.hostname} (Focusmap Lite)`,
    executors: capabilities.executors,
    available_secret_names: capabilities.available_secret_names,
    metadata: capabilities.metadata,
  });
  return runner.id;
}

async function sendRunnerHeartbeat(
  api: AgentApiClient,
  config: AgentConfig,
  runnerId: string,
  status: 'online' | 'offline',
  currentTaskId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await api.runnerHeartbeat({
    runner_id: runnerId,
    hostname: config.hostname,
    device_id: config.hostname,
    status,
    current_task_id: currentTaskId,
    metadata: {
      app: 'focusmap-lite',
      agent: 'focusmap-agent',
      version: AGENT_VERSION,
      heartbeat_kind: 'liveness',
      agent_state: status === 'offline' ? 'offline' : currentTaskId ? 'running' : 'idle',
      codex_thread_monitor: true,
      codex_orphan_thread_import: true,
      codex_thread_import_api_path: CODEX_THREAD_IMPORT_API_PATH,
      ...metadata,
    },
  });
}

export async function sendOfflineHeartbeat(
  api: AgentApiClient,
  config: AgentConfig,
  runnerId: string,
  reason: string,
): Promise<void> {
  await sendRunnerHeartbeat(api, config, runnerId, 'offline', null, {
    heartbeat_kind: 'shutdown',
    shutdown_reason: reason,
  });
}

export function startHeartbeatLoop(
  api: AgentApiClient,
  config: AgentConfig,
  runnerId: string,
  activeIntervalMs = 10_000,
  getCurrentTaskId: () => string | null = () => null,
  idleIntervalMs = activeIntervalMs,
): NodeJS.Timeout {
  const tickIntervalMs = Math.max(1_000, Math.min(activeIntervalMs, idleIntervalMs));
  let nextAllowedAt = 0;
  let nextHeartbeatAt = 0;
  let backoffMs = activeIntervalMs;
  let lastTaskId: string | null = null;
  let lastFullRegistrationAt = Date.now();
  return setInterval(async () => {
    const now = Date.now();
    if (now < nextAllowedAt) return;
    const currentTaskId = getCurrentTaskId();
    const intervalMs = currentTaskId ? activeIntervalMs : idleIntervalMs;
    const fullRegistrationIntervalMs = currentTaskId
      ? FULL_REGISTRATION_ACTIVE_INTERVAL_MS
      : FULL_REGISTRATION_IDLE_INTERVAL_MS;
    const stateChanged = currentTaskId !== lastTaskId;
    if (!stateChanged && now < nextHeartbeatAt) return;
    try {
      await sendRunnerHeartbeat(api, config, runnerId, 'online', currentTaskId);
      if (now - lastFullRegistrationAt >= fullRegistrationIntervalMs) {
        await upsertRunner(api, config);
        lastFullRegistrationAt = now;
      }
      lastTaskId = currentTaskId;
      backoffMs = intervalMs;
      nextHeartbeatAt = Date.now() + intervalMs;
      nextAllowedAt = 0;
    } catch (error) {
      if (now - lastFullRegistrationAt >= fullRegistrationIntervalMs) {
        try {
          await upsertRunner(api, config);
          lastFullRegistrationAt = Date.now();
          backoffMs = intervalMs;
          nextHeartbeatAt = Date.now() + intervalMs;
          nextAllowedAt = 0;
          return;
        } catch {
          logError('heartbeat failed', error);
        }
      }
      nextAllowedAt = Date.now() + Math.min(backoffMs, fullRegistrationIntervalMs);
      backoffMs = Math.min(MAX_HEARTBEAT_BACKOFF_MS, backoffMs * 2);
    }
  }, tickIntervalMs);
}
