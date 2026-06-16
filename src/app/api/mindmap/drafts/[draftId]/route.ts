import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : String(error) },
    { status },
  )
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const status = body.status === "discarded" ? "discarded" : null
    if (!status) {
      return NextResponse.json({ success: false, error: "unsupported status" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("mindmap_drafts")
      .update({ status })
      .eq("id", draftId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .select("*")
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ success: false, error: "active draft not found" }, { status: 404 })
    return NextResponse.json({ success: true, draft: data })
  } catch (error) {
    return errorResponse(error)
  }
}
