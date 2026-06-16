import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import {
  fetchActiveMindmapDraft,
  replaceActiveMindmapDraft,
  type SaveMindmapDraftNodeInput,
} from "@/lib/mindmap-draft-service"

function errorResponse(error: unknown, status = 500) {
  return NextResponse.json(
    { success: false, error: error instanceof Error ? error.message : String(error) },
    { status },
  )
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const projectId = request.nextUrl.searchParams.get("project_id")
    if (!projectId) {
      return NextResponse.json({ success: false, error: "project_id is required" }, { status: 400 })
    }
    const draft = await fetchActiveMindmapDraft(supabase, user.id, projectId)
    return NextResponse.json({ success: true, draft })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const projectId = typeof body.projectId === "string" ? body.projectId : null
    if (!projectId) {
      return NextResponse.json({ success: false, error: "projectId is required" }, { status: 400 })
    }
    const nodes = Array.isArray(body.nodes) ? body.nodes as SaveMindmapDraftNodeInput[] : []
    const draft = await replaceActiveMindmapDraft({
      supabase,
      userId: user.id,
      projectId,
      chatSessionId: typeof body.chatSessionId === "string" ? body.chatSessionId : null,
      scope: body.scope ?? {},
      summary: body.summary ?? undefined,
      nodes,
      createdBy: body.createdBy === "user" ? "user" : "ai",
    })
    return NextResponse.json({ success: true, draft })
  } catch (error) {
    return errorResponse(error)
  }
}
