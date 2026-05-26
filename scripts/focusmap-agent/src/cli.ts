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
 *   5. 30秒ごとに heartbeat ループ
 *   6. 10秒ごとに claim_ai_task_for_runner で task pull
 *   7. claim したタスクを executor で実行
 *   8. SIGINT/SIGTERM でグレースフルシャットダウン
 */

import { assertNoAnthropicKey } from './safety.js';
import { loadConfig, ConfigError } from './config.js';
import { upsertRunner, startHeartbeatLoop } from './heartbeat.js';
import { startClaimLoop } from './claim.js';
import { startCommandLoop } from './command-loop.js';
import { executeTask } from './executor.js';
import { AgentApiClient } from './api-client.js';
import { info, error as logError } from './logger.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const CLAIM_INTERVAL_MS = 10_000;
const CLAIM_TTL_SEC = 300;

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

  // 5. Heartbeat ループ (30s)
  const heartbeatTimer = startHeartbeatLoop(api, config, HEARTBEAT_INTERVAL_MS);

  // 6. Claim ループ (10s)
  const claimTimer = startClaimLoop(
    api,
    runnerId,
    async (task) => {
      await executeTask(task, api, config, runnerId);
    },
    CLAIM_INTERVAL_MS,
  );
  const commandTimer = startCommandLoop(api, runnerId, config);

  info(
    `agent ready — heartbeat ${HEARTBEAT_INTERVAL_MS / 1000}s / claim poll ${CLAIM_INTERVAL_MS / 1000}s`,
  );

  // 7. Shutdown
  const shutdown = (signal: string): void => {
    info(`received ${signal}, shutting down...`);
    clearInterval(heartbeatTimer);
    clearInterval(claimTimer);
    clearInterval(commandTimer);
    process.exit(0);
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
