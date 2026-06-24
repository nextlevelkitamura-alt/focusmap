#!/usr/bin/env node
/**
 * focusmap-agent CLI
 *
 * 起動: focusmap-agent start [--config <path>]
 *      デフォルト config path: ~/.focusmap/config.json
 *
 * 処理フロー:
 *   1. ANTHROPIC_API_KEY check (起動時拒否)
 *   2. Config 読み込み + 検証
 *   3. Focusmap API client 作成 (agent_token認証)
 *   4. ai_runners に登録 → runner_id 取得
 *   5. 実行中は5秒、アイドル時は30秒基準で lightweight heartbeat ループ
 *   6. 3秒ごとに claim_ai_task_for_runner で task pull
 *   7. claim したタスクを executor で実行
 *   8. SIGINT/SIGTERM でグレースフルシャットダウン
 */

import { assertNoAnthropicKey } from './safety.js';
import { loadConfig, ConfigError } from './config.js';
import { sendOfflineHeartbeat, upsertRunner, startHeartbeatLoop } from './heartbeat.js';
import { startClaimLoop } from './claim.js';
import { startCommandLoop } from './command-loop.js';
import {
  DEFAULT_RECONCILE_INTERVAL_MS,
  DEFAULT_TARGET_REFRESH_INTERVAL_MS,
  getCodexThreadMonitorHeartbeatMetadata,
  startCodexThreadMonitorLoop,
} from './codex-thread-monitor.js';
import { executeTask } from './executor.js';
import { AgentApiClient } from './api-client.js';
import { info, error as logError } from './logger.js';

function intervalFromEnv(name: string, fallbackMs: number, minMs: number, maxMs: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallbackMs;
  return Math.max(minMs, Math.min(maxMs, raw));
}

const HEARTBEAT_INTERVAL_MS = intervalFromEnv('FOCUSMAP_AGENT_HEARTBEAT_INTERVAL_MS', 5_000, 5_000, 60_000);
const IDLE_HEARTBEAT_INTERVAL_MS = intervalFromEnv('FOCUSMAP_AGENT_IDLE_HEARTBEAT_INTERVAL_MS', 30_000, 5_000, 5 * 60_000);
const CLAIM_INTERVAL_MS = intervalFromEnv('FOCUSMAP_AGENT_CLAIM_INTERVAL_MS', 3_000, 3_000, 60_000);
const COMMAND_INTERVAL_MS = intervalFromEnv('FOCUSMAP_AGENT_COMMAND_INTERVAL_MS', 15_000, 5_000, 60_000);
const CODEX_THREAD_MONITOR_INTERVAL_MS = intervalFromEnv('FOCUSMAP_AGENT_CODEX_THREAD_MONITOR_INTERVAL_MS', 1_000, 1_000, 60_000);
const CODEX_THREAD_MONITOR_TARGET_REFRESH_MS = intervalFromEnv('FOCUSMAP_AGENT_CODEX_THREAD_MONITOR_TARGET_REFRESH_MS', DEFAULT_TARGET_REFRESH_INTERVAL_MS, 1_000, 60_000);
const CODEX_THREAD_MONITOR_RECENT_SCAN_MS = intervalFromEnv('FOCUSMAP_AGENT_CODEX_THREAD_MONITOR_RECENT_SCAN_MS', DEFAULT_TARGET_REFRESH_INTERVAL_MS, 1_000, 60_000);
const CODEX_THREAD_MONITOR_RECONCILE_MS = intervalFromEnv('FOCUSMAP_AGENT_CODEX_THREAD_MONITOR_RECONCILE_MS', DEFAULT_RECONCILE_INTERVAL_MS, 60_000, 6 * 60 * 60_000);

async function main(): Promise<void> {
  // 1. Safety check
  assertNoAnthropicKey();

  const args = process.argv.slice(2);
  const command = args[0];
  if (command !== 'start') {
    console.error('Usage: focusmap-agent start [--config <path>]');
    process.exit(1);
  }

  const configIdx = args.indexOf('--config');
  const configPath =
    configIdx >= 0 ? args[configIdx + 1] : `${process.env.HOME}/.focusmap/config.json`;

  // 2. Config
  let config;
  try {
    config = await loadConfig(configPath);
  } catch (e) {
    if (e instanceof ConfigError) {
      logError(e.message);
      process.exit(1);
    }
    throw e;
  }
  info(`config loaded — hostname=${config.hostname}, api=${config.api_url}`);

  // 3. Focusmap API
  const api = new AgentApiClient(config);
  info('focusmap api client ready');

  // 4. Runner 登録
  let runnerId: string;
  try {
    runnerId = await upsertRunner(api, config);
  } catch (e) {
    logError('runner登録失敗:', e instanceof Error ? e.message : e);
    process.exit(1);
  }
  info(`runner registered id=${runnerId}`);

  let currentTaskId: string | null = null;

  // 5. Heartbeat ループ (runningは2s、idleは30sのlightweight Turso upsert by default)
  const heartbeatTimer = startHeartbeatLoop(
    api,
    config,
    runnerId,
    HEARTBEAT_INTERVAL_MS,
    () => currentTaskId,
    IDLE_HEARTBEAT_INTERVAL_MS,
    getCodexThreadMonitorHeartbeatMetadata,
  );

  // 6. Claim ループ (15s by default)
  const claimTimer = startClaimLoop(
    api,
    runnerId,
    async (task) => {
      currentTaskId = task.id;
      try {
        await executeTask(task, api, config, runnerId);
      } finally {
        currentTaskId = null;
      }
    },
    CLAIM_INTERVAL_MS,
  );
  const commandTimer = startCommandLoop(api, runnerId, config, COMMAND_INTERVAL_MS);
  const codexThreadMonitorTimer = startCodexThreadMonitorLoop(
    api,
    runnerId,
    CODEX_THREAD_MONITOR_INTERVAL_MS,
    CODEX_THREAD_MONITOR_TARGET_REFRESH_MS,
    CODEX_THREAD_MONITOR_RECONCILE_MS,
    CODEX_THREAD_MONITOR_RECENT_SCAN_MS,
  );

  info(
    `agent ready — heartbeat ${HEARTBEAT_INTERVAL_MS / 1000}s active / ${IDLE_HEARTBEAT_INTERVAL_MS / 1000}s idle / claim poll ${CLAIM_INTERVAL_MS / 1000}s / command poll ${COMMAND_INTERVAL_MS / 1000}s / codex thread monitor ${CODEX_THREAD_MONITOR_INTERVAL_MS / 1000}s / target refresh ${CODEX_THREAD_MONITOR_TARGET_REFRESH_MS / 1000}s / recent scan ${CODEX_THREAD_MONITOR_RECENT_SCAN_MS / 1000}s / reconcile ${CODEX_THREAD_MONITOR_RECONCILE_MS / 1000}s`,
  );

  // 7. Shutdown
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    info(`received ${signal}, shutting down...`);
    clearInterval(heartbeatTimer);
    clearInterval(claimTimer);
    clearInterval(commandTimer);
    for (const timer of codexThreadMonitorTimer) clearInterval(timer);
    const exitTimer = setTimeout(() => process.exit(0), 1_500);
    exitTimer.unref();
    sendOfflineHeartbeat(api, config, runnerId, signal)
      .catch((e) => logError('offline heartbeat failed:', e instanceof Error ? e.message : e))
      .finally(() => {
        clearTimeout(exitTimer);
        process.exit(0);
      });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 8. Keep alive
  process.stdin.resume();
}

main().catch((e) => {
  logError('fatal', e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
