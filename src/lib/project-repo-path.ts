import { execFile } from "node:child_process"
import { stat, realpath } from "node:fs/promises"
import path from "node:path"

type SupabaseLike = {
  from: (table: string) => AvailableRepoSelect
}

type AvailableRepoSelect = {
  select: (columns: string) => AvailableRepoFilter
}

type AvailableRepoFilter = {
  eq: (column: string, value: string) => AvailableRepoFilter
  limit: (count: number) => AvailableRepoFilter
  maybeSingle: () => PromiseLike<{ data: { absolute_path?: string } | null; error: { message: string } | null }>
}

function normalizeRepoPath(value: string) {
  return value.trim().replace(/\/+$/, "")
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
  const { data, error } = await client
    .from("available_repos")
    .select("absolute_path")
    .eq("user_id", userId)
    .eq("absolute_path", repoPath)
    .limit(1)
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return resolveLocalGitRepoPath(repoPath)

  return { repoPath: data.absolute_path ?? repoPath }
}
