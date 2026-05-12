import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Timeout for auth operations in middleware (5 seconds max)
const AUTH_TIMEOUT = 5000
const PUBLIC_PATHS = new Set(['/', '/login', '/privacy', '/terms'])

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
    const timeout = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    )
    try {
        return await Promise.race([promise, timeout]) as T
    } catch {
        return null
    }
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    // Skip auth check if env vars are missing (during build)
    if (!supabaseUrl || !supabaseAnonKey) {
        return supabaseResponse
    }

    const supabase = createServerClient(
        supabaseUrl,
        supabaseAnonKey,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // Use timeout to prevent hanging
    const result = await withTimeout(
        supabase.auth.getUser(),
        AUTH_TIMEOUT
    )

    const user = result?.data?.user ?? null

    // Redirect unauthenticated users to login, while keeping public OAuth review pages accessible.
    if (
        !user &&
        !PUBLIC_PATHS.has(request.nextUrl.pathname) &&
        !request.nextUrl.pathname.startsWith('/auth')
    ) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        return NextResponse.redirect(url)
    }

    // Redirect authenticated users away from login page to dashboard
    if (user && request.nextUrl.pathname === '/login') {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
    }

    return supabaseResponse
}
