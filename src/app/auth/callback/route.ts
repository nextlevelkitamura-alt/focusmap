
import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { registerDesktopAuthSession } from '@/lib/desktop-auth-session'

function encodeDesktopDeepLinkPayload(payload: Record<string, unknown>) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

function desktopAuthDonePage(payload?: {
    nonce: string
    access_token: string
    refresh_token: string
    expires_at?: number | null
    user_id?: string | null
}) {
    const deepLink = payload ? new URL('focusmap://auth-complete') : null
    if (deepLink && payload) {
        deepLink.searchParams.set('desktop', '1')
        deepLink.searchParams.set('nonce', payload.nonce)
        deepLink.searchParams.set('payload', encodeDesktopDeepLinkPayload(payload))
    }
    const scriptDeepLink = deepLink ? JSON.stringify(deepLink.toString()) : 'null'

    return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Focusmap ログイン完了</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #050505; color: #f5f5f5; }
      main { max-width: 420px; padding: 32px; text-align: center; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { color: #a3a3a3; line-height: 1.7; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Focusmap にログインしました</h1>
      <p>Macアプリに戻ってください。このタブは閉じて構いません。</p>
    </main>
    <script>
      const deepLink = ${scriptDeepLink};
      if (deepLink) setTimeout(() => { window.location.href = deepLink }, 250);
      setTimeout(() => window.close(), 1500);
    </script>
  </body>
</html>`
}

function nativeAuthDonePage(payload: {
    nonce: string
    next: string
    access_token?: string | null
    refresh_token?: string | null
    expires_at?: number | null
    user_id?: string | null
}) {
    const deepLink = new URL('focusmap://auth-complete')
    deepLink.searchParams.set('nonce', payload.nonce)
    deepLink.searchParams.set('next', payload.next || '/dashboard')
    if (payload.access_token && payload.refresh_token) {
        deepLink.searchParams.set('payload', encodeDesktopDeepLinkPayload({
            nonce: payload.nonce,
            access_token: payload.access_token,
            refresh_token: payload.refresh_token,
            expires_at: payload.expires_at ?? null,
            user_id: payload.user_id ?? null,
        }))
    }
    const safeDeepLink = deepLink.toString().replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    const scriptDeepLink = JSON.stringify(deepLink.toString())

    return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Focusmap ログイン完了</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #050505; color: #f5f5f5; }
      main { max-width: 420px; padding: 32px; text-align: center; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { color: #a3a3a3; line-height: 1.7; margin: 0 0 14px; }
      a { color: #34d399; }
    </style>
  </head>
  <body>
    <main>
      <h1>Focusmap にログインしました</h1>
      <p>Focusmapアプリへ戻っています。</p>
      <a href="${safeDeepLink}">アプリへ戻る</a>
    </main>
    <script>setTimeout(() => { window.location.href = ${scriptDeepLink} }, 300)</script>
  </body>
</html>`
}

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
    const desktop = searchParams.get('desktop') === '1'
    const desktopNonce = searchParams.get('nonce')
    const nativeApp = searchParams.get('native_app')
    const nativeNonce = searchParams.get('nonce')

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
            if (desktop && desktopNonce && data.session?.access_token && data.session?.refresh_token && data.user?.id) {
                registerDesktopAuthSession({
                    nonce: desktopNonce,
                    accessToken: data.session.access_token,
                    refreshToken: data.session.refresh_token,
                    userId: data.user.id,
                    expiresAt: data.session.expires_at ?? null,
                })
                return new NextResponse(desktopAuthDonePage({
                    nonce: desktopNonce,
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: data.session.expires_at ?? null,
                    user_id: data.user.id,
                }), {
                    headers: {
                        'Content-Type': 'text/html; charset=utf-8',
                        'Cache-Control': 'no-store',
                    },
                })
            }
            if (nativeApp === 'ios' && nativeNonce && data.session?.access_token && data.session?.refresh_token && data.user?.id) {
                registerDesktopAuthSession({
                    nonce: nativeNonce,
                    accessToken: data.session.access_token,
                    refreshToken: data.session.refresh_token,
                    userId: data.user.id,
                    expiresAt: data.session.expires_at ?? null,
                })
                return new NextResponse(nativeAuthDonePage({
                    nonce: nativeNonce,
                    next,
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: data.session.expires_at ?? null,
                    user_id: data.user.id,
                }), {
                    headers: { 'Content-Type': 'text/html; charset=utf-8' },
                })
            }
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
