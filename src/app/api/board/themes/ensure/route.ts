import { NextRequest, NextResponse } from 'next/server'
import { ensureThemeDay } from '@/lib/turso/themes'
import { createClient } from '@/utils/supabase/server'

type EnsureBody = { date?: unknown; sourceDate?: unknown }

function date(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null
}

// Daily loaderがGET前に明示して呼ぶ、冪等な日次継承コマンド。
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  let body: EnsureBody
  try {
    body = (await request.json()) as EnsureBody
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const day = date(body.date)
  const sourceDateProvided = body.sourceDate !== undefined
  const sourceDay = sourceDateProvided ? date(body.sourceDate) ?? undefined : undefined
  if (!day || (sourceDateProvided && !sourceDay)) {
    return NextResponse.json({ success: false, error: 'INVALID_DATE' }, { status: 400 })
  }

  try {
    const result = await ensureThemeDay(day, sourceDay)
    return NextResponse.json({ success: true, ...result })
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('INVALID_THEME_DAY')) {
      return NextResponse.json({ success: false, error: cause.message }, { status: 400 })
    }
    return NextResponse.json({ success: false, error: 'THEME_DAY_ENSURE_FAILED' }, { status: 500 })
  }
}
