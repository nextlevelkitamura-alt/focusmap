import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canViewSpace } from "@/lib/space-access"

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get("space_id")

  if (spaceId) {
    if (!(await canViewSpace(supabase, user.id, spaceId))) {
      return NextResponse.json({ error: "No access to the selected space" }, { status: 403 })
    }

    const { data: runnerSpaces, error: runnerSpacesError } = await supabase
      .from("ai_runner_spaces")
      .select("runner_id, enabled")
      .eq("space_id", spaceId)
      .eq("enabled", true)

    if (runnerSpacesError) return NextResponse.json({ error: runnerSpacesError.message }, { status: 500 })

    const runnerIds = [...new Set((runnerSpaces ?? []).map(row => row.runner_id))]
    if (runnerIds.length === 0) return NextResponse.json({ runners: [] })

    const { data: runners, error } = await supabase
      .from("ai_runners")
      .select("id, user_id, hostname, display_name, executors, available_repo_keys, available_secret_names, repo_paths, metadata, last_heartbeat_at, created_at, updated_at")
      .in("id", runnerIds)
      .order("last_heartbeat_at", { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ runners: runners ?? [] })
  }

  const { data, error } = await supabase
    .from("ai_runners")
    .select("id, user_id, hostname, display_name, executors, available_repo_keys, available_secret_names, repo_paths, metadata, last_heartbeat_at, created_at, updated_at")
    .eq("user_id", user.id)
    .order("last_heartbeat_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ runners: data ?? [] })
}
