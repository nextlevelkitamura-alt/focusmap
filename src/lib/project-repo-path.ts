import { execFile } from "node:child_process"
import { stat, realpath } from "node:fs/promises"
import path from "node:path"

type SupabaseLike = {
  from: (table: string) => { select: (columns: string) => unknown }
}

type AvailableRepoFilter = {
  eq: (column: string, value: string) => AvailableRepoFilter
  limit: (count: number) => AvailableRepoFilter
  maybeSingle: () => PromiseLike<{ data: { absolute_path?: string } | null; error: { message: string } | null }>
}

type AgentRepoFilter = {
  eq: (
    column: string,
    value: string,
  ) => PromiseLike<{ data: { repo_paths?: unknown }[] | null; error: { message: string } | null }>
}

function normalizeRepoPath(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function repoPathValues(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return []
  return Object.values(value)
    .map(value => (typeof value === "string" ? normalizeRepoPath(value) : ""))
    .filter(Boolean)
}

function isMissingLegacyAvailableRepos(error: { message?: string } | null) {
  return !!error?.message &&
    /(relation .*available_repos.*does not exist|available_repos.*does not exist|Could not find .*available_repos)/i.test(error.message)
}

function gitTopLevel(cwd: string): Promise<string | null> {
  return new Promise(resolve => {
    execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 5_000 }, (error, stdout) => {
      if (error) {
        resolve(null)
        return
      }
      resolve(normalizeRepoPath(String(stdout)))
    })
  })
}

async function resolveLocalGitRepoPath(repoPath: string) {
  if (!path.isAbsolute(repoPath)) return { error: "repo_path must be an absolute path" }

  let repoStat: Awaited<ReturnType<typeof stat>>
  try {
    repoStat = await stat(repoPath)
  } catch {
    return { error: "repo_path does not exist or has not been scanned by Focusmap agent" }
  }
  if (!repoStat.isDirectory()) return { error: "repo_path must be a directory" }

  const cwd = await realpath(repoPath).catch(() => repoPath)
  const gitRoot = await gitTopLevel(cwd)
  if (!gitRoot) return { error: "repo_path must be a git repository folder" }

  const normalizedRoot = await realpath(gitRoot).catch(() => gitRoot)
  return { repoPath: normalizeRepoPath(normalizedRoot) }
}

async function resolveAgentHeartbeatRepoPath(client: SupabaseLike, userId: string, repoPath: string) {
  const query = client.from("ai_runners").select("repo_paths") as AgentRepoFilter
  const { data, error } = await query.eq("user_id", userId)
  if (error) return { error: error.message }

  for (const runner of data ?? []) {
    const match = repoPathValues(runner.repo_paths).find(candidate => candidate === repoPath)
    if (match) return { repoPath: match }
  }

  return { repoPath: null }
}

export async function resolveProjectRepoPath(
  supabase: unknown,
  userId: string,
  value: unknown,
): Promise<{ repoPath: string | null; error?: never } | { repoPath?: never; error: string }> {
  if (value === null || value === undefined || value === "") return { repoPath: null }
  if (typeof value !== "string") return { error: "repo_path must be a string" }

  const repoPath = normalizeRepoPath(value)
  if (!repoPath) return { repoPath: null }

  const client = supabase as SupabaseLike
  const agentRepo = await resolveAgentHeartbeatRepoPath(client, userId, repoPath)
  if (agentRepo.error) return { error: agentRepo.error }
  if (agentRepo.repoPath) return { repoPath: agentRepo.repoPath }

  const availableRepoQuery = client
    .from("available_repos")
    .select("absolute_path") as AvailableRepoFilter
  const { data, error } = await availableRepoQuery
    .eq("user_id", userId)
    .eq("absolute_path", repoPath)
    .limit(1)
    .maybeSingle()

  if (error && !isMissingLegacyAvailableRepos(error)) return { error: error.message }
  if (!data) return resolveLocalGitRepoPath(repoPath)

  return { repoPath: data.absolute_path ?? repoPath }
}
