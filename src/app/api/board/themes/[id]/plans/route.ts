import { NextRequest, NextResponse } from 'next/server'
import { movePlanToTheme, unlinkPlanFromTheme } from '@/lib/turso/themes'
import { createClient } from '@/utils/supabase/server'

type ExpectedLink = { themeId?: unknown; version?: unknown }
type PlanBody = {
  planSlug?: unknown
  expected?: unknown
  sortOrder?: unknown
  repoSlug?: unknown
}

function parseExpected(value: unknown): { themeId: string; version: number } | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const expected = value as ExpectedLink
  if (typeof expected.themeId !== 'string' || !expected.themeId.trim()) return undefined
  if (typeof expected.version !== 'number' || !Number.isInteger(expected.version) || expected.version <= 0) return undefined
  return { themeId: expected.themeId.trim(), version: expected.version }
}

async function userIsAuthenticated() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return !error && Boolean(user)
}

// expected=null は未所属Planの新規link、expected={themeId,version} は既存linkのD&D移動。
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await userIsAuthenticated()) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const { id } = await params
  let body: PlanBody
  try {
    body = (await request.json()) as PlanBody
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const planSlug = typeof body.planSlug === 'string' ? body.planSlug.trim() : ''
  const expected = parseExpected(body.expected)
  const sortOrder = body.sortOrder === undefined
    ? undefined
    : typeof body.sortOrder === 'number' && Number.isInteger(body.sortOrder) && body.sortOrder >= 0
      ? body.sortOrder
      : null
  const repoSlug = body.repoSlug === undefined || body.repoSlug === null
    ? null
    : typeof body.repoSlug === 'string' && body.repoSlug.trim()
      ? body.repoSlug.trim()
      : undefined
  if (!id || !planSlug || expected === undefined || sortOrder === null || repoSlug === undefined) {
    return NextResponse.json({ success: false, error: 'INVALID_PLAN_LINK' }, { status: 400 })
  }

  try {
    const result = await movePlanToTheme({ planSlug, themeId: id, expected, sortOrder, repoSlug })
    if (!result.ok) {
      return NextResponse.json({ success: false, error: 'VERSION_CONFLICT', current: result.current }, { status: 409 })
    }
    return NextResponse.json({ success: true, link: result.value })
  } catch {
    return NextResponse.json({ success: false, error: 'PLAN_LINK_FAILED' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!await userIsAuthenticated()) {
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  const { id } = await params
  let body: PlanBody
  try {
    body = (await request.json()) as PlanBody
  } catch {
    return NextResponse.json({ success: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const planSlug = typeof body.planSlug === 'string' ? body.planSlug.trim() : ''
  const expected = parseExpected(body.expected)
  if (!id || !planSlug || !expected || expected.themeId !== id) {
    return NextResponse.json({ success: false, error: 'INVALID_PLAN_LINK' }, { status: 400 })
  }

  try {
    const result = await unlinkPlanFromTheme({ planSlug, expected })
    if (!result.ok) {
      return NextResponse.json({ success: false, error: 'VERSION_CONFLICT', current: result.current }, { status: 409 })
    }
    return NextResponse.json({ success: true, unlinked: result.value })
  } catch {
    return NextResponse.json({ success: false, error: 'PLAN_UNLINK_FAILED' }, { status: 500 })
  }
}
