import { createBrowserClient } from '@supabase/ssr'

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MzgzNTcsImV4cCI6MjA4NDMxNDM1N30.qMVqh1DPzYFhJx29NtWghqfLGM68JHd3O51nxxWsWPA'

type LocalDevSession = {
    access_token: string | null
    expires_at: number | null
    user: {
        id: string
        email: string
    }
}

let localDevSessionPromise: Promise<LocalDevSession | null> | null = null

function isLocalDevBrowserHost() {
    if (typeof window === 'undefined') return false
    return window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '::1' ||
        window.location.hostname.endsWith('.localhost')
}

async function getLocalDevSession() {
    if (!isLocalDevBrowserHost()) return null
    localDevSessionPromise ??= fetch('/api/dev-auth/local-token', { cache: 'no-store' })
        .then(async response => {
            if (!response.ok) return null
            const data = await response.json().catch(() => null) as Partial<LocalDevSession> | null
            if (!data?.user?.id || !data.user.email) return null
            return {
                access_token: data.access_token ?? null,
                expires_at: data.expires_at ?? null,
                user: {
                    id: data.user.id,
                    email: data.user.email,
                },
            }
        })
        .catch(() => null)
    const session = await localDevSessionPromise
    if (session?.expires_at && session.expires_at - Math.floor(Date.now() / 1000) < 60) {
        localDevSessionPromise = null
    }
    return session
}

export function createClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY

    const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
        global: isLocalDevBrowserHost()
            ? {
                fetch: async (input, init) => {
                    const session = await getLocalDevSession()
                    if (!session?.access_token) return fetch(input, init)

                    const headers = new Headers(init?.headers)
                    if (!headers.has('Authorization')) {
                        headers.set('Authorization', `Bearer ${session.access_token}`)
                    }
                    return fetch(input, { ...init, headers })
                },
            }
            : undefined,
    })

    if (isLocalDevBrowserHost()) {
        const auth = supabase.auth as unknown as {
            getUser: (...args: unknown[]) => Promise<unknown>
            getSession: (...args: unknown[]) => Promise<unknown>
        }
        const originalGetUser = auth.getUser.bind(supabase.auth)
        const originalGetSession = auth.getSession.bind(supabase.auth)
        auth.getUser = async (...args: unknown[]) => {
            if (args.length > 0) return originalGetUser(...args)
            const session = await getLocalDevSession()
            if (!session) return originalGetUser(...args)
            return { data: { user: session.user }, error: null }
        }
        auth.getSession = async (...args: unknown[]) => {
            const session = await getLocalDevSession()
            if (!session) return originalGetSession(...args)
            if (!session.access_token || !session.expires_at) {
                return {
                    data: { session: null },
                    error: null,
                }
            }
            return {
                data: {
                    session: {
                        access_token: session.access_token,
                        refresh_token: 'local-dev-refresh-token',
                        token_type: 'bearer',
                        expires_at: session.expires_at,
                        expires_in: Math.max(0, session.expires_at - Math.floor(Date.now() / 1000)),
                        user: session.user,
                    },
                },
                error: null,
            }
        }
    }

    return supabase
}
