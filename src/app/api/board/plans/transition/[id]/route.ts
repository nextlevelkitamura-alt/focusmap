import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 })
  const { id } = await params
  const { data: command, error } = await supabase
    .from('agent_commands')
    .select('id, status, type, result, error, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('type', 'plan_transition')
    .maybeSingle()
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!command) return NextResponse.json({ success: false, error: 'COMMAND_NOT_FOUND' }, { status: 404 })
  return NextResponse.json({ success: true, command })
}
