#!/usr/bin/env node
/**
 * Focusmap Agent CLI (雛形)
 *
 * 起動: focusmap-agent start --config ~/.focusmap/config.json
 *
 * 本格実装は Phase 3 Month 3 で行う。現在の雛形は:
 *   1. config.json を読み込む
 *   2. Supabase に接続
 *   3. ai_runners テーブルに自身を登録 (heartbeat)
 *   4. claim_ai_task_for_runner で task を pull
 *   5. (将来) Playwright で Browser automation
 *
 * 既存の scripts/codex-rpc-bridge.ts / scripts/task-runner.ts と整合性を取りながら
 * 段階移行する。
 */

import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';

interface AgentConfig {
  agent_token: string;
  api_url: string;
  hostname?: string;
}

async function loadConfig(path: string): Promise<AgentConfig> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as AgentConfig;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const configIdx = args.indexOf('--config');
  const configPath = configIdx >= 0 ? args[configIdx + 1] : `${process.env.HOME}/.focusmap/config.json`;

  if (command !== 'start') {
    console.error('Usage: focusmap-agent start [--config <path>]');
    process.exit(1);
  }

  const config = await loadConfig(configPath);
  console.log(`[focusmap-agent] starting on ${config.hostname ?? hostname()}`);
  console.log(`[focusmap-agent] API endpoint: ${config.api_url}`);

  // TODO Phase 3 Month 3: Supabase接続 + heartbeat + claim_ai_task_for_runner + Playwright実行
  // 当面は既存の scripts/task-runner.ts / scripts/codex-rpc-bridge.ts を活用する。

  // Heartbeat ループ
  const heartbeatIntervalMs = 30_000;
  setInterval(async () => {
    try {
      await fetch(`${config.api_url}/ai-runners/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.agent_token}`,
        },
        body: JSON.stringify({
          hostname: config.hostname ?? hostname(),
          executors: ['claude', 'codex', 'playwright'],
        }),
      });
    } catch (err) {
      console.error('[focusmap-agent] heartbeat failed', err);
    }
  }, heartbeatIntervalMs);

  // 終了時クリーンアップ
  process.on('SIGINT', () => {
    console.log('[focusmap-agent] shutting down');
    process.exit(0);
  });

  console.log('[focusmap-agent] heartbeat loop started (30s interval)');
}

main().catch((err) => {
  console.error('[focusmap-agent] fatal', err);
  process.exit(1);
});
