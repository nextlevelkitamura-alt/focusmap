import { NextRequest, NextResponse } from 'next/server'
import { addThemeCompletionCriterion } from '@/lib/turso/themes'
import { createClient } from '@/utils/supabase/server'

function content(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 1_000) : ''
}

// Daily画面の人操作で条件を追加する入口。AI向けの追加は同じdomain serviceを直接使う。
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })

  const { id: themeId } = await params
  let body: { id?: unknown; content?: unknown }
  try {
    body = await request.json() as { id?: unknown; content?: unknown }
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const criterionContent = content(body.content)
  if (!themeId || !criterionContent) return NextResponse.json({ success: false, error: 'INVALID_COMPLETION_CRITERION' }, { status: 400 })

  try {
    const criterion = await addThemeCompletionCriterion({
      id: typeof body.id === 'string' && body.id ? body.id : undefined,
      themeId,
      content: criterionContent,
    })
    if (!criterion) return NextResponse.json({ success: false, error: 'THEME_NOT_FOUND' }, { status: 404 })
    return NextResponse.json({ success: true, criterion }, { status: 201 })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_COMPLETION_CRITERION_CREATE_FAILED' }, { status: 500 })
  }
}
