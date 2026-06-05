'use client'

import { createClient } from '@/utils/supabase/client'

let supabaseClient: ReturnType<typeof createClient> | null = null

function client() {
  supabaseClient ??= createClient()
  return supabaseClient
}

export async function getSupabaseAccessToken() {
  const { data } = await client().auth.getSession()
  return data.session?.access_token ?? null
}

export async function fetchWithSupabaseAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  const token = await getSupabaseAccessToken()
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers })
}
