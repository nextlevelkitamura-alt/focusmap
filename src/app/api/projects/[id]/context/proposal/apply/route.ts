import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

const PROGRESS_STATUSES = new Set(["not_started", "in_progress", "blocked", "done", "archived"])

function compactText(value: unknown, limit: number) {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (!text) return null
  return Array.from(text).slice(0, limit).join("")
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const { data: project, error: projectLoadError } = await supabase
      .from("projects")
      .select("id, title")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle()
    if (projectLoadError) return NextResponse.json({ error: projectLoadError.message }, { status: 500 })
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const projectDescription = compactText(body.projectDescription, 3000)
    const heading = compactText(body.heading, 160)
    const details = compactText(body.details, 3000)
    const progress = compactText(body.progress, 2000)
    const progressStatus =
      typeof body.progressStatus === "string" && PROGRESS_STATUSES.has(body.progressStatus)
        ? body.progressStatus
        : null

    const updated: string[] = []
    if (projectDescription) {
      const { error } = await supabase
        .from("projects")
        .update({ description: projectDescription })
        .eq("id", id)
        .eq("user_id", user.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      updated.push("プロジェクト概要")
    }

    const contextPayload: Record<string, unknown> = {
      user_id: user.id,
      project_id: id,
    }
    if (heading) contextPayload.heading = heading
    if (details) contextPayload.details = details
    if (progress) contextPayload.progress = progress
    if (progressStatus) contextPayload.progress_status = progressStatus

    const hasContextUpdate = ["heading", "details", "progress", "progress_status"]
      .some(key => Object.prototype.hasOwnProperty.call(contextPayload, key))
    if (hasContextUpdate) {
      const { error } = await supabase
        .from("project_contexts")
        .upsert(contextPayload, { onConflict: "project_id,user_id" })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      updated.push("蓄積コンテキスト")
    }

    if (updated.length === 0) {
      return NextResponse.json({ error: "保存する内容がありません" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      projectId: id,
      projectTitle: project.title,
      updated,
      message: `「${project.title}」の${updated.join("・")}を保存しました`,
    })
  } catch (error) {
    console.error("[API] POST /api/projects/[id]/context/proposal/apply error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
