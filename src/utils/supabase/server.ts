import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { getLocalDevAuthForHost } from '@/lib/auth/local-dev-auth'
import { createLocalDevSupabaseJwt } from '@/lib/auth/local-dev-jwt'

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MzgzNTcsImV4cCI6MjA4NDMxNDM1N30.qMVqh1DPzYFhJx29NtWghqfLGM68JHd3O51nxxWsWPA'

export async function createClient() {
    const cookieStore = await cookies()
    const headerStore = await headers()

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY
    const localDevAuth = getLocalDevAuthForHost(headerStore.get('host'))
    const localDevJwt = localDevAuth ? createLocalDevSupabaseJwt(localDevAuth.user) : null

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            global: localDevJwt?.accessToken
                ? {
                    headers: {
                        Authorization: `Bearer ${localDevJwt.accessToken}`,
                    },
                }
                : undefined,
            cookies: {
                getAll() {
                    return cookieStore.getAll()
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            cookieStore.set(name, value, options)
                        })
                    } catch {
                        // Called from a Server Component — middleware will refresh the session.
                    }
                },
            },
        }
    )

    if (localDevAuth) {
        const auth = supabase.auth as unknown as {
            getUser: (...args: unknown[]) => Promise<unknown>
            getSession: (...args: unknown[]) => Promise<unknown>
        }
        const originalGetUser = auth.getUser.bind(supabase.auth)
        const originalGetSession = auth.getSession.bind(supabase.auth)
        auth.getUser = async (...args: unknown[]) => {
            if (args.length > 0) return originalGetUser(...args)
            return {
                data: {
                    user: {
                        id: localDevAuth.user.id,
                        email: localDevAuth.user.email,
                    },
                },
                error: null,
            }
        }
        auth.getSession = async (...args: unknown[]) => {
            if (!localDevJwt?.accessToken) return originalGetSession(...args)
            return {
                data: {
                    session: {
                        access_token: localDevJwt.accessToken,
                        refresh_token: 'local-dev-refresh-token',
                        token_type: 'bearer',
                        expires_at: localDevJwt.expiresAt,
                        expires_in: Math.max(0, localDevJwt.expiresAt - Math.floor(Date.now() / 1000)),
                        user: {
                            id: localDevAuth.user.id,
                            email: localDevAuth.user.email,
                        },
                    },
                },
                error: null,
            }
        }
    }

    return supabase
}
