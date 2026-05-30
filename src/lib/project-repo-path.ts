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

export async function resolveProjectRepoPath(
  supabase: unknown,
  userId: string,
  value: unknown,
): Promise<{ repoPath: string | null; error?: never } | { repoPath?: never; error: string }> {
  if (value === null || value === undefined || value === "") return { repoPath: null }
  if (typeof value !== "string") return { error: "repo_path must be a string" }

  const repoPath = value.trim()
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
  if (!data) return { error: "repo_path must be selected from scanned repositories" }

  return { repoPath: data.absolute_path ?? repoPath }
}
