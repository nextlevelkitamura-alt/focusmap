import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { canEditSpace, canViewSpace } from "@/lib/space-access"

const VALID_SOURCE_KINDS = ["git", "local_repo_key", "inline"] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeVersionBody(value: Record<string, unknown>) {
  const version = typeof value.version === "string" && value.version.trim()
    ? value.version.trim()
    : ""
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

async function loadPackageForUser(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, id: string) {
  const { data: pkg, error } = await supabase
    .from("ai_task_packages")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !pkg) return { pkg: null, error: "Package not found", status: 404 }
  if (pkg.user_id === userId) return { pkg, error: null, status: 200 }
  if (pkg.space_id && await canViewSpace(supabase, userId, pkg.space_id)) {
    return { pkg, error: null, status: 200 }
  }
  return { pkg: null, error: "No access to the package", status: 403 }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const loaded = await loadPackageForUser(supabase, user.id, id)
  if (!loaded.pkg) return NextResponse.json({ error: loaded.error }, { status: loaded.status })

  const { data, error } = await supabase
    .from("ai_task_package_versions")
    .select("*")
    .eq("package_id", id)
    .order("published_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ versions: data ?? [] })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const loaded = await loadPackageForUser(supabase, user.id, id)
  if (!loaded.pkg) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  if (loaded.pkg.space_id && !(await canEditSpace(supabase, user.id, loaded.pkg.space_id)) && loaded.pkg.user_id !== user.id) {
    return NextResponse.json({ error: "No edit access to the package space" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  if (!isObject(body)) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const normalized = normalizeVersionBody(body)
  if (!normalized.version) return NextResponse.json({ error: "version is required" }, { status: 400 })

  const { data: version, error } = await supabase
    .from("ai_task_package_versions")
    .insert({
      package_id: id,
      user_id: user.id,
      version: normalized.version,
      manifest: normalized.manifest,
      source_kind: normalized.source_kind,
      repo_url: normalized.repo_url,
      git_ref: normalized.git_ref,
      git_commit_sha: normalized.git_commit_sha,
      package_path: normalized.package_path,
      content_sha256: normalized.content_sha256,
      changelog: normalized.changelog,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (normalized.publish) {
    const { error: publishError } = await supabase
      .from("ai_task_packages")
      .update({ current_version_id: version.id, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (publishError) return NextResponse.json({ error: publishError.message }, { status: 500 })
  }

  return NextResponse.json({ version }, { status: 201 })
}
