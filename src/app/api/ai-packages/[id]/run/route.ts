import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import {
  canEditSpace,
  normalizeVisibility,
  renderPackagePrompt,
  resolveAiTaskSpaceId,
} from "@/lib/space-access"

type PackageSchedule = {
  scheduled_at?: string | null
  recurrence_cron?: string | null
}

function validDateOrNull(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toISOString()
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: pkg, error: pkgError } = await supabase
    .from("ai_task_packages")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .single()

  if (pkgError || !pkg) return NextResponse.json({ error: "Package not found" }, { status: 404 })
  if (pkg.space_id && !(await canEditSpace(supabase, user.id, pkg.space_id))) {
    return NextResponse.json({ error: "No edit access to the package space" }, { status: 403 })
  }

  const currentVersionId = typeof (pkg as { current_version_id?: unknown }).current_version_id === "string"
    ? (pkg as { current_version_id: string }).current_version_id
    : null
  const { data: currentVersion, error: currentVersionError } = currentVersionId
    ? await supabase
      .from("ai_task_package_versions")
      .select("*")
      .eq("id", currentVersionId)
      .maybeSingle()
    : { data: null, error: null }

  if (currentVersionError) return NextResponse.json({ error: currentVersionError.message }, { status: 500 })

  const body = await request.json().catch(() => ({}))
  const inputs = body.inputs && typeof body.inputs === "object" && !Array.isArray(body.inputs)
    ? body.inputs as Record<string, unknown>
    : {}
  const prompt = renderPackagePrompt(pkg.prompt_template, inputs)
  if (!prompt) return NextResponse.json({ error: "Rendered prompt is empty" }, { status: 400 })

  const schedule = (pkg.schedule && typeof pkg.schedule === "object" && !Array.isArray(pkg.schedule)
    ? pkg.schedule
    : {}) as PackageSchedule

  const scheduledAt =
    validDateOrNull(body.scheduled_at) ??
    validDateOrNull(schedule.scheduled_at) ??
    new Date().toISOString()
  const recurrenceCron = typeof body.recurrence_cron === "string"
    ? body.recurrence_cron
    : typeof schedule.recurrence_cron === "string"
      ? schedule.recurrence_cron
      : null

  const resolved = await resolveAiTaskSpaceId(supabase, user.id, {
    space_id: typeof body.space_id === "string" ? body.space_id : pkg.space_id,
  })
  if (resolved.error) return NextResponse.json({ error: resolved.error }, { status: 403 })

  const visibility = normalizeVisibility(body.run_visibility, pkg.default_visibility ?? "space")
  const packageSnapshot = {
    package_id: pkg.id,
    package_version_id: currentVersion?.id ?? null,
    package_version: currentVersion?.version ?? null,
    title: pkg.title,
    executor: pkg.executor,
    schedule: pkg.schedule,
    required_repo_key: pkg.required_repo_key,
    required_secret_names: pkg.required_secret_names,
    input_schema: pkg.input_schema,
    version: currentVersion ? {
      id: currentVersion.id,
      version: currentVersion.version,
      source_kind: currentVersion.source_kind,
      repo_url: currentVersion.repo_url,
      git_ref: currentVersion.git_ref,
      git_commit_sha: currentVersion.git_commit_sha,
      package_path: currentVersion.package_path,
      content_sha256: currentVersion.content_sha256,
      manifest: currentVersion.manifest,
      published_at: currentVersion.published_at,
    } : null,
    inputs,
    rendered_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from("ai_tasks")
    .insert({
      user_id: user.id,
      space_id: resolved.spaceId,
      package_id: pkg.id,
      package_version_id: currentVersion?.id ?? null,
      package_snapshot: packageSnapshot,
      prompt,
      skill_id: null,
      approval_type: body.approval_type === "confirm" || body.approval_type === "interactive"
        ? body.approval_type
        : "auto",
      status: "pending",
      scheduled_at: scheduledAt,
      recurrence_cron: recurrenceCron,
      cwd: null,
      executor: pkg.executor,
      run_visibility: visibility,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ task: data }, { status: 201 })
}
