import { NextResponse } from 'next/server'
import { consumeDesktopAuthSession } from '@/lib/desktop-auth-session'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const nonce = searchParams.get('nonce')
  if (!nonce) {
    return NextResponse.json({ error: 'nonce is required' }, { status: 400 })
  }

  const session = consumeDesktopAuthSession(nonce)
  if (!session) {
    return NextResponse.json({ status: 'pending' }, { status: 202 })
  }

  return NextResponse.json({
    status: 'ready',
    user_id: session.userId,
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.sessionExpiresAt,
  })
}
