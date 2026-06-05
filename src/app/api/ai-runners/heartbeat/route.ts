import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canEditSpace } from "@/lib/space-access"
import { authenticateSupabaseRequest } from "@/lib/auth/verify-supabase-jwt"

const VALID_EXECUTORS = new Set(["claude", "codex", "codex_app"])

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(v => String(v).trim()).filter(Boolean)
    : []
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(request, supabase)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { user } = auth

  const body = await request.json()
  const hostname = typeof body.hostname === "string" ? body.hostname.trim() : ""
  if (!hostname) return NextResponse.json({ error: "hostname is required" }, { status: 400 })

  const executors = stringArray(body.executors).filter(executor => VALID_EXECUTORS.has(executor))
  const availableRepoKeys = stringArray(body.available_repo_keys)
  const availableSecretNames = stringArray(body.available_secret_names)
  const repoPaths = body.repo_paths && typeof body.repo_paths === "object" && !Array.isArray(body.repo_paths)
    ? body.repo_paths
    : {}

  const { data: runner, error } = await supabase
    .from("ai_runners")
    .upsert({
      user_id: user.id,
      hostname,
      display_name: typeof body.display_name === "string" ? body.display_name.trim() : hostname,
      executors: executors.length ? executors : ["claude"],
      available_repo_keys: availableRepoKeys,
      available_secret_names: availableSecretNames,
      repo_paths: repoPaths,
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
      last_heartbeat_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,hostname" })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const requestedSpaceIds = stringArray(body.space_ids)
  const enabledRows: Array<{ runner_id: string; space_id: string; enabled: boolean }> = []
  for (const spaceId of requestedSpaceIds) {
    if (await canEditSpace(supabase, user.id, spaceId)) {
      enabledRows.push({ runner_id: runner.id, space_id: spaceId, enabled: true })
    }
  }
  if (enabledRows.length) {
    await supabase
      .from("ai_runner_spaces")
      .upsert(enabledRows, { onConflict: "runner_id,space_id" })
  }

  return NextResponse.json({ runner, enabled_space_count: enabledRows.length })
}
