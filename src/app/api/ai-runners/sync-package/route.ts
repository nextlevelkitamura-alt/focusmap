import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canViewSpace } from "@/lib/space-access"

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  if (!isObject(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const packageId = typeof body.package_id === "string" && body.package_id.trim()
    ? body.package_id.trim()
    : ""
  const requestedRunnerId = typeof body.runner_id === "string" && body.runner_id.trim()
    ? body.runner_id.trim()
    : null

  if (!packageId) return NextResponse.json({ error: "package_id is required" }, { status: 400 })

  const { data: pkg, error: pkgError } = await supabase
    .from("ai_task_packages")
    .select("id, user_id, space_id, title, current_version_id")
    .eq("id", packageId)
    .single()

  if (pkgError || !pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 })
  if (pkg.user_id !== user.id && !(pkg.space_id && await canViewSpace(supabase, user.id, pkg.space_id))) {
    return NextResponse.json({ error: "No access to the package" }, { status: 403 })
  }
  if (!pkg.current_version_id) {
    return NextResponse.json({ error: "Package has no published version" }, { status: 400 })
  }

  const runnerQuery = supabase
    .from("ai_runners")
    .select("id, user_id, hostname, last_heartbeat_at")
    .eq("user_id", user.id)
    .order("last_heartbeat_at", { ascending: false })
    .limit(1)

  const { data: runnerList, error: runnerListError } = requestedRunnerId
    ? await supabase
      .from("ai_runners")
      .select("id, user_id, hostname, last_heartbeat_at")
      .eq("id", requestedRunnerId)
      .eq("user_id", user.id)
      .limit(1)
    : await runnerQuery

  if (runnerListError) return NextResponse.json({ error: runnerListError.message }, { status: 500 })
  const runner = runnerList?.[0]
  if (!runner) return NextResponse.json({ error: "No runner found for this user" }, { status: 404 })

  const now = new Date().toISOString()
  const { data: cache, error: cacheError } = await supabase
    .from("ai_runner_package_cache")
    .upsert({
      runner_id: runner.id,
      package_id: pkg.id,
      version_id: pkg.current_version_id,
      sync_status: "sync_requested",
      sync_requested_at: now,
      updated_at: now,
      last_error: null,
    }, { onConflict: "runner_id,package_id" })
    .select()
    .single()

  if (cacheError) return NextResponse.json({ error: cacheError.message }, { status: 500 })

  return NextResponse.json({
    runner,
    cache,
    message: "Sync requested. The local runner will fetch the package on its next heartbeat.",
  })
}
