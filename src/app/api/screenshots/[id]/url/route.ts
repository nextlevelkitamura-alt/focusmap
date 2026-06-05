import { NextRequest, NextResponse } from 'next/server'
import { isR2Configured, R2ConfigurationError, signedR2GetUrl } from '@/lib/r2/client'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { getScreenshotForUser } from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

function unavailable(code: 'turso_not_configured' | 'r2_not_configured') {
  return NextResponse.json(
    { error: code === 'turso_not_configured' ? 'Turso is not configured' : 'R2 is not configured', code },
    { status: 503 },
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return unavailable('turso_not_configured')
  if (!isR2Configured()) return unavailable('r2_not_configured')

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const variant = searchParams.get('variant') === 'thumbnail' ? 'thumbnail' : 'preview'
  const expiresIn = Math.min(Math.max(Number.parseInt(searchParams.get('expires_in') || '300', 10) || 300, 60), 900)

  try {
    const screenshot = await getScreenshotForUser(id, auth.userId)
    if (!screenshot) return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 })
    const key = variant === 'thumbnail' ? screenshot.thumbnail_key : screenshot.preview_key
    if (!key) return NextResponse.json({ error: `${variant} is not available` }, { status: 404 })

    const url = await signedR2GetUrl(key, expiresIn)
    return NextResponse.json({ url, variant, expires_in: expiresIn })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable('turso_not_configured')
    if (error instanceof R2ConfigurationError) return unavailable('r2_not_configured')
    console.error('[screenshots/url GET]', error)
    return NextResponse.json({ error: 'Screenshot URL signing failed' }, { status: 500 })
  }
}
