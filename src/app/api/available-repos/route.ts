import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

interface AvailableRepoRow {
  id: string
  hostname: string
  absolute_path: string
  display_name: string
  last_git_commit_at: string | null
  last_seen_at: string | null
}

function normalizeRepoPath(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : ""
}

function repoDisplayName(repoPath: string) {
  return repoPath.split("/").filter(Boolean).at(-1) ?? repoPath
}

function recordRepo(repos: Map<string, AvailableRepoRow>, repo: AvailableRepoRow) {
  const key = normalizeRepoPath(repo.absolute_path)
  if (!key) return
  const existing = repos.get(key)
  if (!existing) {
    repos.set(key, { ...repo, absolute_path: key })
    return
  }

  const existingSeen = existing.last_seen_at ? Date.parse(existing.last_seen_at) : 0
  const nextSeen = repo.last_seen_at ? Date.parse(repo.last_seen_at) : 0
  repos.set(key, {
    ...(nextSeen >= existingSeen ? repo : existing),
    absolute_path: key,
    last_git_commit_at: existing.last_git_commit_at ?? repo.last_git_commit_at,
  })
}

function repoPathValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.values(value)
    .map(normalizeRepoPath)
    .filter(Boolean)
}

function sortRepos(a: AvailableRepoRow, b: AvailableRepoRow) {
  const aCommit = a.last_git_commit_at ? Date.parse(a.last_git_commit_at) : 0
  const bCommit = b.last_git_commit_at ? Date.parse(b.last_git_commit_at) : 0
  if (aCommit !== bCommit) return bCommit - aCommit
  return a.display_name.localeCompare(b.display_name, "ja")
}

function isMissingLegacyAvailableRepos(error: { message?: string } | null) {
  return !!error?.message &&
    /(relation .*available_repos.*does not exist|available_repos.*does not exist|Could not find .*available_repos)/i.test(error.message)
}

// GET /api/available-repos — focusmap-agent heartbeat と legacy table からMacのリポ候補を返す
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const repos = new Map<string, AvailableRepoRow>()

  const { data: runners, error: runnersError } = await supabase
    .from("ai_runners")
    .select("id, hostname, repo_paths, last_heartbeat_at")
    .eq("user_id", user.id)
    .order("last_heartbeat_at", { ascending: false })

  if (runnersError) {
    return NextResponse.json({ error: runnersError.message }, { status: 500 })
  }

  for (const runner of runners ?? []) {
    for (const repoPath of repoPathValues(runner.repo_paths)) {
      recordRepo(repos, {
        id: `runner:${runner.id}:${repoPath}`,
        hostname: runner.hostname || "focusmap-agent",
        absolute_path: repoPath,
        display_name: repoDisplayName(repoPath),
        last_git_commit_at: null,
        last_seen_at: runner.last_heartbeat_at ?? null,
      })
    }
  }

  const { data: legacyRepos, error: legacyError } = await supabase
    .from("available_repos")
    .select("id, hostname, absolute_path, display_name, last_git_commit_at, last_seen_at")
    .eq("user_id", user.id)
    .order("last_git_commit_at", { ascending: false, nullsFirst: false })
    .order("display_name")

  if (legacyError && !isMissingLegacyAvailableRepos(legacyError)) {
    return NextResponse.json({ error: legacyError.message }, { status: 500 })
  }

  for (const repo of legacyRepos ?? []) {
    recordRepo(repos, {
      id: repo.id,
      hostname: repo.hostname,
      absolute_path: repo.absolute_path,
      display_name: repo.display_name,
      last_git_commit_at: repo.last_git_commit_at,
      last_seen_at: repo.last_seen_at,
    })
  }

  return NextResponse.json(Array.from(repos.values()).sort(sortRepos))
}
