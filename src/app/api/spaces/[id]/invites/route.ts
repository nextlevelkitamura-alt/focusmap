import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canOwnSpace, normalizeSpaceRole } from "@/lib/space-access"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!(await canOwnSpace(supabase, user.id, id))) {
    return NextResponse.json({ error: "Only space owners can create invites" }, { status: 403 })
  }

  const body = await request.json()
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : ""
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "valid email is required" }, { status: 400 })
  }

  const role = normalizeSpaceRole(body.role)
  const expiresAt = typeof body.expires_at === "string" && !Number.isNaN(Date.parse(body.expires_at))
    ? new Date(body.expires_at).toISOString()
    : undefined

  const { data, error } = await supabase
    .from("space_invites")
    .upsert({
      space_id: id,
      email,
      role,
      invited_by: user.id,
      ...(expiresAt ? { expires_at: expiresAt } : {}),
    }, { onConflict: "space_id,email" })
    .select("id, space_id, email, role, token, expires_at, created_at")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invite: data }, { status: 201 })
}
