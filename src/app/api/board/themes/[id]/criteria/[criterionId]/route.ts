import { NextRequest, NextResponse } from 'next/server'
import { deleteThemeCompletionCriterion, updateThemeCompletionCriterion } from '@/lib/turso/themes'
import { createClient } from '@/utils/supabase/server'

function expectedVersion(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function content(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 1_000) : undefined
}

async function authenticate() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return !error && user
}

// Web APIは人の操作だけを許可する。将来のAIは同じdomain serviceへ actor=ai を渡す。
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string; criterionId: string }> }) {
  if (!await authenticate()) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  const { id: themeId, criterionId } = await params
  let body: { content?: unknown; isCompleted?: unknown; expectedVersion?: unknown }
  try {
    body = await request.json() as { content?: unknown; isCompleted?: unknown; expectedVersion?: unknown }
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const version = expectedVersion(body.expectedVersion)
  const criterionContent = content(body.content)
  const isCompleted = body.isCompleted === undefined ? undefined : typeof body.isCompleted === 'boolean' ? body.isCompleted : null
  if (!themeId || !criterionId || !version || criterionContent === '' || isCompleted === null) {
    return NextResponse.json({ success: false, error: 'INVALID_COMPLETION_CRITERION' }, { status: 400 })
  }

  try {
    const result = await updateThemeCompletionCriterion({
      themeId,
      id: criterionId,
      expectedVersion: version,
      content: criterionContent,
      isCompleted,
      completedBy: 'human',
    })
    if (!result.ok) return NextResponse.json({ success: false, error: 'VERSION_CONFLICT', current: result.current }, { status: 409 })
    return NextResponse.json({ success: true, criterion: result.value })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_COMPLETION_CRITERION_UPDATE_FAILED' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; criterionId: string }> }) {
  if (!await authenticate()) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  const { id: themeId, criterionId } = await params
  const version = expectedVersion(new URL(request.url).searchParams.get('expectedVersion') ? Number(new URL(request.url).searchParams.get('expectedVersion')) : null)
  if (!themeId || !criterionId || !version) return NextResponse.json({ success: false, error: 'INVALID_COMPLETION_CRITERION' }, { status: 400 })

  try {
    const result = await deleteThemeCompletionCriterion({ themeId, id: criterionId, expectedVersion: version })
    if (!result.ok) return NextResponse.json({ success: false, error: 'VERSION_CONFLICT', current: result.current }, { status: 409 })
    return NextResponse.json({ success: true, criterion: result.value })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_COMPLETION_CRITERION_DELETE_FAILED' }, { status: 500 })
  }
}
