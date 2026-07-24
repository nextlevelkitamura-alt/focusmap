import { NextRequest, NextResponse } from 'next/server'
import { adoptThemeCandidate, rejectThemeCandidate } from '@/lib/turso/theme-candidates'
import { createClient } from '@/utils/supabase/server'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: Context) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  try {
    const { id } = await context.params
    const body = await request.json()
    if (body?.action === 'reject') {
      const candidate = await rejectThemeCandidate(id)
      return candidate
        ? NextResponse.json({ success: true, candidate })
        : NextResponse.json({ success: false, error: 'CANDIDATE_NOT_PROPOSED' }, { status: 409 })
    }
    if (body?.action === 'adopt' && typeof body?.date === 'string') {
      const adopted = await adoptThemeCandidate({ id, day: body.date })
      return adopted
        ? NextResponse.json({ success: true, ...adopted })
        : NextResponse.json({ success: false, error: 'CANDIDATE_NOT_PROPOSED' }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: 'INVALID_ACTION' }, { status: 400 })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_CANDIDATE_UPDATE_FAILED' }, { status: 500 })
  }
}
