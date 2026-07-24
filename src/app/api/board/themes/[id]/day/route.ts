import { NextRequest, NextResponse } from 'next/server'
import { setThemeDayState, type ThemeDayState } from '@/lib/turso/themes'
import { createClient } from '@/utils/supabase/server'

type DayPatchBody = {
  date?: unknown
  state?: unknown
  expectedVersion?: unknown
  sortOrder?: unknown
}

const DAY_STATES = new Set<ThemeDayState>(['active', 'completed', 'skipped'])

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const { id } = await params
  let body: DayPatchBody
  try {
    body = (await request.json()) as DayPatchBody
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const state = typeof body.state === 'string' ? body.state as ThemeDayState : null
  const expectedVersion = body.expectedVersion === null
    ? null
    : typeof body.expectedVersion === 'number' && Number.isInteger(body.expectedVersion) && body.expectedVersion > 0
      ? body.expectedVersion
      : undefined
  const sortOrder = body.sortOrder === undefined
    ? undefined
    : typeof body.sortOrder === 'number' && Number.isInteger(body.sortOrder) && body.sortOrder >= 0
      ? body.sortOrder
      : null
  if (!id || !isDate(body.date) || !state || !DAY_STATES.has(state) || expectedVersion === undefined || sortOrder === null) {
    return NextResponse.json({ success: false, error: 'INVALID_DAY_STATE' }, { status: 400 })
  }

  try {
    const result = await setThemeDayState({
      themeId: id,
      day: body.date,
      state,
      expectedVersion,
      sortOrder,
    })
    if (!result.ok) {
      return NextResponse.json({ success: false, error: 'VERSION_CONFLICT', current: result.current }, { status: 409 })
    }
    return NextResponse.json({ success: true, day: result.value })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_DAY_UPDATE_FAILED' }, { status: 500 })
  }
}
