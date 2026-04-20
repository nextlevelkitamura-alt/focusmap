import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * DEV ONLY: Playwright自動テスト用の認証エンドポイント
 * NODE_ENV=development の場合のみ動作する
 *
 * 使い方:
 * 1. scripts/playwright-login.sh で access_token を取得
 * 2. GET /api/dev-auth?access_token=...&refresh_token=... を呼ぶ
 * 3. セッションcookieが設定され /dashboard にリダイレクト
 */
export async function GET(request: NextRequest) {
    if (process.env.NODE_ENV !== 'development') {
        return new NextResponse('Not found', { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const accessToken = searchParams.get('access_token')
    const refreshToken = searchParams.get('refresh_token')

    if (!accessToken || !refreshToken) {
        return new NextResponse('access_token and refresh_token are required', { status: 400 })
    }

    const cookieStore = await cookies()
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
        cookies: {
            get(name: string) {
                return cookieStore.get(name)?.value
            },
            set(name: string, value: string, options) {
                try { cookieStore.set({ name, value, ...options }) } catch {}
            },
            remove(name: string, options) {
                try { cookieStore.set({ name, value: '', ...options }) } catch {}
            },
        },
    })

    const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
    })

    if (error) {
        return new NextResponse(`Auth error: ${error.message}`, { status: 401 })
    }

    const origin = new URL(request.url).origin
    return NextResponse.redirect(`${origin}/dashboard`)
}
