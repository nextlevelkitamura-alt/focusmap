import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { applyMindmapDraft } from "@/lib/mindmap-draft-service"

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : String(error) },
    { status },
  )
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const { draftId } = await params
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await applyMindmapDraft({ supabase, userId: user.id, draftId })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    return errorResponse(error)
  }
}
