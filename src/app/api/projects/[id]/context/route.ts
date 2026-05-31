import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

type ProjectContextPayload = {
  heading?: unknown
  details?: unknown
  progress?: unknown
  progress_status?: unknown
}

const PROGRESS_STATUSES = new Set(["not_started", "in_progress", "blocked", "done", "archived"])

function compactText(value: unknown, limit: number) {
  if (typeof value !== "string") return ""
  return Array.from(value.trim()).slice(0, limit).join("")
}

async function getAuthedProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .single()

  if (error || !data) return null
  return data
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const project = await getAuthedProject(supabase, user.id, id)
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const { data: existing, error: loadError } = await supabase
      .from("project_contexts")
      .select("id, project_id, heading, details, progress, progress_status, progress_updated_at, updated_at")
      .eq("project_id", id)
      .eq("user_id", user.id)
      .maybeSingle()

    if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })
    if (existing) return NextResponse.json(existing)

    const { data: created, error: createError } = await supabase
      .from("project_contexts")
      .insert({
        user_id: user.id,
        project_id: id,
      })
      .select("id, project_id, heading, details, progress, progress_status, progress_updated_at, updated_at")
      .single()

    if (createError) return NextResponse.json({ error: createError.message }, { status: 500 })
    return NextResponse.json(created)
  } catch (error) {
    console.error("[API] GET /api/projects/[id]/context error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const project = await getAuthedProject(supabase, user.id, id)
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as ProjectContextPayload
    const heading = compactText(body.heading, 160)
    const details = compactText(body.details, 3000)
    const progress = body.progress === undefined ? undefined : compactText(body.progress, 2000)
    const progressStatus =
      typeof body.progress_status === "string" && PROGRESS_STATUSES.has(body.progress_status)
        ? body.progress_status
        : undefined

    const payload = {
      user_id: user.id,
      project_id: id,
      heading,
      details,
      ...(progress !== undefined ? { progress } : {}),
      ...(progressStatus !== undefined ? { progress_status: progressStatus } : {}),
    }

    const { data, error } = await supabase
      .from("project_contexts")
      .upsert(payload, { onConflict: "project_id,user_id" })
      .select("id, project_id, heading, details, progress, progress_status, progress_updated_at, updated_at")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  } catch (error) {
    console.error("[API] PUT /api/projects/[id]/context error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
