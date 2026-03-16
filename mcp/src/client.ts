import { createClient, SupabaseClient } from "@supabase/supabase-js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySupabaseClient = SupabaseClient<any, any, any>

export interface ShikumikaClient {
  supabase: AnySupabaseClient
  userId: string
}

export function createShikumikaClient(): ShikumikaClient {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const userId = process.env.SHIKUMIKA_USER_ID

  if (!supabaseUrl || !serviceRoleKey || !userId) {
    throw new Error(
      "Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHIKUMIKA_USER_ID"
    )
  }

  const supabase: AnySupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  return { supabase, userId }
}
