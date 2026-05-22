import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canOwnSpace, normalizeSpaceRole } from "@/lib/space-access"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("space_members")
    .select("id, space_id, user_id, role, invited_by, created_at, updated_at")
    .eq("space_id", id)
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: data ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await canOwnSpace(supabase, user.id, id))) {
    return NextResponse.json({ error: "Only space owners can manage members" }, { status: 403 })
  }

  const body = await request.json()
  const targetUserId = typeof body.user_id === "string" ? body.user_id.trim() : ""
  if (!targetUserId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 })
  }

  const role = normalizeSpaceRole(body.role)
  const { data, error } = await supabase
    .from("space_members")
    .upsert({
      space_id: id,
      user_id: targetUserId,
      role,
      invited_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "space_id,user_id" })
    .select("id, space_id, user_id, role, invited_by, created_at, updated_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ member: data }, { status: 201 })
}
