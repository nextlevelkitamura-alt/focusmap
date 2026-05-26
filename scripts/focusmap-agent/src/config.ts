/**
 * config.json (~/.focusmap/config.json) を読み込み、 環境変数で上書き可能にする。
 *
 * 期待する config.json 形式:
 * {
 *   "agent_token": "fma_...",
 *   "hostname": "my-mac-mini",
 *   "display_name": "Office Mac mini",
 *   "api_url": "https://focusmap-official.com/api",
 *   "gemini_api_key": "AIza..."
 * }
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import type { AgentConfig } from './types.js';

export class ConfigError extends Error {}

export async function loadConfig(path: string): Promise<AgentConfig> {
  let fromFile: Partial<AgentConfig> = {};
  if (existsSync(path)) {
    try {
      const raw = await readFile(path, 'utf8');
      fromFile = JSON.parse(raw) as Partial<AgentConfig>;
    } catch (e) {
      throw new ConfigError(
        `config.json の読み込みに失敗: ${path} — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // 環境変数で上書き可能 (CI / コンテナ向け)
  const cfg: AgentConfig = {
    hostname: fromFile.hostname ?? process.env.FOCUSMAP_HOSTNAME ?? osHostname(),
    display_name: fromFile.display_name ?? process.env.FOCUSMAP_DISPLAY_NAME,
    agent_token: fromFile.agent_token ?? process.env.FOCUSMAP_AGENT_TOKEN ?? '',
    gemini_api_key:
      fromFile.gemini_api_key ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
      process.env.GEMINI_API_KEY,
    deepseek_api_key: fromFile.deepseek_api_key ?? process.env.DEEPSEEK_API_KEY,
    api_url: fromFile.api_url ?? process.env.FOCUSMAP_API_URL ?? 'https://focusmap-official.com/api',
    shell_enabled: fromFile.shell_enabled ?? process.env.FOCUSMAP_SHELL_ENABLED === 'true',
    path: fromFile.path ?? process.env.PATH,
  };

  validate(cfg);
  return cfg;
}

function validate(cfg: AgentConfig): void {
  const missing: string[] = [];
  if (!cfg.agent_token) missing.push('agent_token (FOCUSMAP_AGENT_TOKEN)');
  if (!cfg.api_url) missing.push('api_url (FOCUSMAP_API_URL)');
  if (missing.length > 0) {
    throw new ConfigError(`必須設定が不足: ${missing.join(', ')}`);
  }
}
