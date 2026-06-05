import { NextRequest, NextResponse } from 'next/server'
import { deleteR2Object, isR2Configured, R2ConfigurationError } from '@/lib/r2/client'
import { isTursoConfigured, TursoConfigurationError } from '@/lib/turso/client'
import { getScreenshotForUser, markScreenshotDeleted } from '@/lib/turso/codex-monitoring'
import { authenticateMonitoringRequest } from '@/lib/turso/request-auth'

function unavailable(code: 'turso_not_configured' | 'r2_not_configured') {
  return NextResponse.json(
    { error: code === 'turso_not_configured' ? 'Turso is not configured' : 'R2 is not configured', code },
    { status: 503 },
  )
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateMonitoringRequest(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isTursoConfigured()) return unavailable('turso_not_configured')
  if (!isR2Configured()) return unavailable('r2_not_configured')

  const { id } = await params
  try {
    const screenshot = await getScreenshotForUser(id, auth.userId)
    if (!screenshot) return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 })

    await markScreenshotDeleted(id, auth.userId)
    await Promise.all([
      screenshot.thumbnail_key ? deleteR2Object(screenshot.thumbnail_key).catch(() => undefined) : undefined,
      screenshot.preview_key ? deleteR2Object(screenshot.preview_key).catch(() => undefined) : undefined,
    ])

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof TursoConfigurationError) return unavailable('turso_not_configured')
    if (error instanceof R2ConfigurationError) return unavailable('r2_not_configured')
    console.error('[screenshots DELETE]', error)
    return NextResponse.json({ error: 'Screenshot delete failed' }, { status: 500 })
  }
}
