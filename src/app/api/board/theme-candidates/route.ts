import { NextResponse } from 'next/server'
import { getProposedThemeCandidates } from '@/lib/turso/theme-candidates'
import { createClient } from '@/utils/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  try {
    return NextResponse.json({ success: true, candidates: await getProposedThemeCandidates() })
  } catch {
    return NextResponse.json({ success: false, error: 'THEME_CANDIDATES_LOAD_FAILED' }, { status: 500 })
  }
}
