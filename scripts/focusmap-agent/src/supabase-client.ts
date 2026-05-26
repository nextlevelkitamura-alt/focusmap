/**
 * Supabase クライアント (service role)
 *
 * RLS をバイパスするため、 service role key を使う。
 * 認証情報はローカル (config.json) でのみ管理。
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig } from './types.js';

export function createServiceClient(config: AgentConfig): SupabaseClient {
  return createClient(config.supabase_url, config.supabase_service_role_key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        'x-client-info': 'focusmap-agent/0.1.0',
      },
    },
  });
}
