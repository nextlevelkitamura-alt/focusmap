import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canEditSpace, normalizeVisibility } from "@/lib/space-access"

const VALID_EXECUTORS = ["claude", "codex", "codex_app"] as const
const VALID_SOURCE_KINDS = ["git", "local_repo_key", "inline"] as const

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(v => String(v).trim()).filter(Boolean)
    : []
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isMissingPackageVersionSchemaError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? ""
  return error?.code === "42703" ||
    error?.code === "42P01" ||
    /Could not find .*ai_task_package_versions|Could not find .*ai_runner_package_cache|current_version_id|relation .* does not exist|column .* does not exist/i.test(message)
}

function normalizeInitialVersion(value: unknown) {
  if (!isObject(value)) return null
  const version = typeof value.version === "string" && value.version.trim()
    ? value.version.trim()
    : "v1"
  const sourceKind = VALID_SOURCE_KINDS.includes(value.source_kind as typeof VALID_SOURCE_KINDS[number])
    ? value.source_kind as typeof VALID_SOURCE_KINDS[number]
    : (typeof value.repo_url === "string" && value.repo_url.trim() ? "git" : "local_repo_key")
  return {
    version,
    source_kind: sourceKind,
    repo_url: typeof value.repo_url === "string" && value.repo_url.trim() ? value.repo_url.trim() : null,
    git_ref: typeof value.git_ref === "string" && value.git_ref.trim() ? value.git_ref.trim() : null,
    git_commit_sha: typeof value.git_commit_sha === "string" && value.git_commit_sha.trim() ? value.git_commit_sha.trim() : null,
    package_path: typeof value.package_path === "string" && value.package_path.trim() ? value.package_path.trim() : ".",
    content_sha256: typeof value.content_sha256 === "string" && value.content_sha256.trim() ? value.content_sha256.trim() : null,
    changelog: typeof value.changelog === "string" && value.changelog.trim() ? value.changelog.trim() : null,
    manifest: isObject(value.manifest) ? value.manifest : {},
    publish: value.publish !== false,
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get("space_id")

  let query = supabase
    .from("ai_task_packages")
    .select("*")
    .order("created_at", { ascending: false })

  if (spaceId === "__unassigned__") query = query.is("space_id", null)
  else if (spaceId) query = query.eq("space_id", spaceId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const packages = data ?? []
  const packageIds = packages.map(pkg => pkg.id).filter(Boolean)
  const currentVersionIds = packages
    .map(pkg => typeof (pkg as { current_version_id?: unknown }).current_version_id === "string"
      ? (pkg as { current_version_id: string }).current_version_id
      : null)
    .filter((id): id is string => !!id)

  if (packageIds.length === 0 || currentVersionIds.length === 0) {
    return NextResponse.json({ packages })
  }

  const { data: versions, error: versionsError } = await supabase
    .from("ai_task_package_versions")
    .select("*")
    .in("id", currentVersionIds)

  if (versionsError && !isMissingPackageVersionSchemaError(versionsError)) {
    return NextResponse.json({ error: versionsError.message }, { status: 500 })
  }

  const { data: runners } = await supabase
    .from("ai_runners")
    .select("id")
    .eq("user_id", user.id)

  const runnerIds = (runners ?? []).map(runner => runner.id).filter(Boolean)
  const { data: caches, error: cachesError } = runnerIds.length > 0
    ? await supabase
      .from("ai_runner_package_cache")
      .select("*")
      .in("runner_id", runnerIds)
      .in("package_id", packageIds)
    : { data: [], error: null }

  if (cachesError && !isMissingPackageVersionSchemaError(cachesError)) {
    return NextResponse.json({ error: cachesError.message }, { status: 500 })
  }

  const versionById = new Map((versions ?? []).map(version => [version.id, version]))
  const cachesByPackage = new Map<string, unknown[]>()
  for (const cache of caches ?? []) {
    const list = cachesByPackage.get(cache.package_id) ?? []
    list.push(cache)
    cachesByPackage.set(cache.package_id, list)
  }

  return NextResponse.json({
    packages: packages.map(pkg => {
      const currentVersionId = (pkg as { current_version_id?: string | null }).current_version_id ?? null
      return {
        ...pkg,
        current_version: currentVersionId ? versionById.get(currentVersionId) ?? null : null,
        runner_caches: cachesByPackage.get(pkg.id) ?? [],
      }
    }),
  })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const title = typeof body.title === "string" ? body.title.trim() : ""
  const promptTemplate = typeof body.prompt_template === "string" ? body.prompt_template.trim() : ""
  const spaceId = typeof body.space_id === "string" && body.space_id.trim() ? body.space_id.trim() : null
  const executor = VALID_EXECUTORS.includes(body.executor) ? body.executor : "claude"

  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 })
  if (!promptTemplate) return NextResponse.json({ error: "prompt_template is required" }, { status: 400 })
  if (spaceId && !(await canEditSpace(supabase, user.id, spaceId))) {
    return NextResponse.json({ error: "No edit access to the selected space" }, { status: 403 })
  }
  const initialVersion = normalizeInitialVersion(body.initial_version)

  const { data, error } = await supabase
    .from("ai_task_packages")
    .insert({
      user_id: user.id,
      space_id: spaceId,
      title,
      prompt_template: promptTemplate,
      executor,
      schedule: body.schedule && typeof body.schedule === "object" ? body.schedule : {},
      required_repo_key: typeof body.required_repo_key === "string" && body.required_repo_key.trim()
        ? body.required_repo_key.trim()
        : null,
      required_secret_names: normalizeStringArray(body.required_secret_names),
      input_schema: body.input_schema && typeof body.input_schema === "object" ? body.input_schema : {},
      default_visibility: normalizeVisibility(body.default_visibility, spaceId ? "space" : "private"),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let currentVersion = null
  if (initialVersion) {
    const { data: version, error: versionError } = await supabase
      .from("ai_task_package_versions")
      .insert({
        package_id: data.id,
        user_id: user.id,
        version: initialVersion.version,
        manifest: initialVersion.manifest,
        source_kind: initialVersion.source_kind,
        repo_url: initialVersion.repo_url,
        git_ref: initialVersion.git_ref,
        git_commit_sha: initialVersion.git_commit_sha,
        package_path: initialVersion.package_path,
        content_sha256: initialVersion.content_sha256,
        changelog: initialVersion.changelog,
      })
      .select()
      .single()

    if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 })
    currentVersion = version

    if (initialVersion.publish) {
      const { error: publishError } = await supabase
        .from("ai_task_packages")
        .update({ current_version_id: version.id, updated_at: new Date().toISOString() })
        .eq("id", data.id)
      if (publishError) return NextResponse.json({ error: publishError.message }, { status: 500 })
    }
  }

  return NextResponse.json({
    package: {
      ...data,
      current_version_id: initialVersion?.publish ? currentVersion?.id ?? null : null,
      current_version: currentVersion,
      runner_caches: [],
    },
  }, { status: 201 })
}
