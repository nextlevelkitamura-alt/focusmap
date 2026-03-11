import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co'

/**
 * Service role client for server-side operations that bypass RLS.
 * Used for API key hash lookup during authentication.
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
