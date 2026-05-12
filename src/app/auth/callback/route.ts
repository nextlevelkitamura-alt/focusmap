
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

function getRedirectOrigin(request: Request) {
    if (process.env.NEXTAUTH_URL?.startsWith('https://')) {
        return process.env.NEXTAUTH_URL.replace(/\/$/, '')
    }

    const forwardedHost = request.headers.get('x-forwarded-host')
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https'
    return forwardedHost
        ? `${forwardedProto}://${forwardedHost}`
        : new URL(request.url).origin
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const errorParam = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')
    const next = searchParams.get('next') ?? '/dashboard'

    const origin = getRedirectOrigin(request)

    console.log('[auth/callback] start', {
        hasCode: Boolean(code),
        errorParam,
        errorDescription,
        origin,
        url: request.url,
    })

    if (errorParam) {
        console.error('[auth/callback] provider returned error', errorParam, errorDescription)
        const reason = encodeURIComponent(`${errorParam}:${errorDescription ?? ''}`)
        return NextResponse.redirect(`${origin}/login?error=provider&reason=${reason}`)
    }

    if (code) {
        const supabase = await createClient()
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            console.log('[auth/callback] exchange success', { userId: data.user?.id })
            return NextResponse.redirect(`${origin}${next}`)
        }
        console.error('[auth/callback] exchange failed', {
            message: error.message,
            status: error.status,
            name: error.name,
        })
        const reason = encodeURIComponent(error.message)
        return NextResponse.redirect(`${origin}/login?error=exchange&reason=${reason}`)
    }

    console.error('[auth/callback] no code and no error param')
    return NextResponse.redirect(`${origin}/login?error=auth-code-error`)
}
