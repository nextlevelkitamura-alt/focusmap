import { NextRequest, NextResponse } from 'next/server'
import { getThemesForDate, insertThemeForDate } from '@/lib/turso/themes'
import { createClient } from '@/utils/supabase/server'

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function criteria(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).map((item) => item.slice(0, 1_000)))]
}

// 読み取り専用。日次行の作成・継承は POST /api/board/themes/ensure へ分離する。
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }

  const day = new URL(request.url).searchParams.get('date')
  if (!isDate(day)) {
    return NextResponse.json({ success: false, error: 'INVALID_DATE' }, { status: 400 })
  }

  try {
    return NextResponse.json({ success: true, day, themes: await getThemesForDate(day) })
  } catch {
    return NextResponse.json({ success: false, error: 'THEMES_LOAD_FAILED' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  try {
    const body = await request.json()
    const day = typeof body?.date === 'string' ? body.date : null
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!isDate(day) || !name) {
      return NextResponse.json({ success: false, error: 'INVALID_THEME_INPUT' }, { status: 400 })
    }
    const theme = await insertThemeForDate({
      day,
      name,
      purpose: typeof body.purpose === 'string' ? body.purpose : null,
      completionCriteria: criteria(body.completionCriteria ?? (typeof body.doneCriteria === 'string' ? [body.doneCriteria] : [])),
      goalRef: typeof body.goalRef === 'string' ? body.goalRef : null,
      repoSlugs: Array.isArray(body.repoSlugs) ? body.repoSlugs.filter((value: unknown): value is string => typeof value === 'string') : [],
    })
    return NextResponse.json({ success: true, theme }, { status: 201 })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_CREATE_FAILED' }, { status: 500 })
  }
}
