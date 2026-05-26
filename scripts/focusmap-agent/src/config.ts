/**
 * config.json (~/.focusmap/config.json) を読み込み、 環境変数で上書き可能にする。
 *
 * 期待する config.json 形式:
 * {
 *   "user_id": "uuid-of-supabase-user",
 *   "hostname": "my-mac-mini",
 *   "display_name": "Office Mac mini",
 *   "supabase_url": "https://xxx.supabase.co",
 *   "supabase_service_role_key": "eyJ...",
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
    user_id: fromFile.user_id ?? process.env.FOCUSMAP_USER_ID ?? '',
    hostname: fromFile.hostname ?? process.env.FOCUSMAP_HOSTNAME ?? osHostname(),
    display_name: fromFile.display_name ?? process.env.FOCUSMAP_DISPLAY_NAME,
    supabase_url:
      fromFile.supabase_url ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.SUPABASE_URL ??
      '',
    supabase_service_role_key:
      fromFile.supabase_service_role_key ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    gemini_api_key:
      fromFile.gemini_api_key ??
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
      process.env.GEMINI_API_KEY,
    api_url: fromFile.api_url ?? process.env.FOCUSMAP_API_URL ?? 'http://localhost:3001/api',
  };

  validate(cfg);
  return cfg;
}

function validate(cfg: AgentConfig): void {
  const missing: string[] = [];
  if (!cfg.user_id) missing.push('user_id');
  if (!cfg.supabase_url) missing.push('supabase_url (NEXT_PUBLIC_SUPABASE_URL)');
  if (!cfg.supabase_service_role_key) missing.push('supabase_service_role_key (SUPABASE_SERVICE_ROLE_KEY)');
  if (missing.length > 0) {
    throw new ConfigError(`必須設定が不足: ${missing.join(', ')}`);
  }
}
