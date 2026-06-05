import { NextRequest, NextResponse } from 'next/server'
import { getLocalDevAuthForRequest } from '@/lib/auth/local-dev-auth'
import { createLocalDevSupabaseJwt } from '@/lib/auth/local-dev-jwt'

export async function GET(request: NextRequest) {
  const localDevAuth = getLocalDevAuthForRequest(request)
  if (!localDevAuth) return new NextResponse('Not found', { status: 404 })

  const token = createLocalDevSupabaseJwt(localDevAuth.user)
  return NextResponse.json({
    access_token: token?.accessToken ?? null,
    expires_at: token?.expiresAt ?? null,
    db_jwt_available: Boolean(token),
    user: localDevAuth.user,
  })
}
