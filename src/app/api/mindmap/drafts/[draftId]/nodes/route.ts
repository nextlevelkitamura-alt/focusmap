import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import {
  upsertMindmapDraftNode,
  type SaveMindmapDraftNodeInput,
} from "@/lib/mindmap-draft-service"

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : String(error) },
    { status },
  )
}

export async function POST(
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
    const input = body.node as SaveMindmapDraftNodeInput | undefined
    if (!input || typeof input.title !== "string") {
      return NextResponse.json({ success: false, error: "node.title is required" }, { status: 400 })
    }
    const draft = await upsertMindmapDraftNode({
      supabase,
      userId: user.id,
      draftId,
      input,
    })
    return NextResponse.json({ success: true, draft })
  } catch (error) {
    return errorResponse(error)
  }
}
