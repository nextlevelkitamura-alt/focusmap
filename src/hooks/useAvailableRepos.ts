"use client"

import { useCallback, useEffect, useState } from "react"

export interface AvailableRepo {
  id: string
  hostname: string
  absolute_path: string
  display_name: string
  last_git_commit_at: string | null
  last_seen_at: string
  source?: "codex" | "agent"
  thread_count?: number
}

type DesktopCodexRepoResult = {
  ok?: boolean
  repos?: AvailableRepo[]
  error?: string
}

type FocusmapDesktopRepoBridge = {
  listCodexRepos?: () => Promise<DesktopCodexRepoResult>
}

function focusmapDesktopRepoBridge() {
  if (typeof window === "undefined") return null
  return (window as Window & { focusmapDesktop?: FocusmapDesktopRepoBridge }).focusmapDesktop ?? null
}

function normalizeRepoPath(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : ""
}

function mergeRepos(codexRepos: AvailableRepo[], agentRepos: AvailableRepo[]) {
  const merged = new Map<string, AvailableRepo>()
  for (const repo of codexRepos) {
    const path = normalizeRepoPath(repo.absolute_path)
    if (!path) continue
    merged.set(path, { ...repo, absolute_path: path, source: "codex" })
  }
  for (const repo of agentRepos) {
    const path = normalizeRepoPath(repo.absolute_path)
    if (!path || merged.has(path)) continue
    merged.set(path, { ...repo, absolute_path: path, source: "agent" })
  }
  return Array.from(merged.values())
}

export function useAvailableRepos() {
  const [repos, setRepos] = useState<AvailableRepo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRepos = useCallback(async () => {
    setIsLoading(true)
    let fetchError: string | null = null
    try {
      const res = await fetch("/api/available-repos")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const agentRepos = ((await res.json()) as AvailableRepo[]).map(repo => ({ ...repo, source: "agent" as const }))
      let codexRepos: AvailableRepo[] = []
      const bridge = focusmapDesktopRepoBridge()
      if (bridge?.listCodexRepos) {
        const result = await bridge.listCodexRepos().catch(error => ({
          ok: false,
          repos: [],
          error: error instanceof Error ? error.message : "Codex repo list failed",
        }))
        if (result?.ok && Array.isArray(result.repos)) {
          codexRepos = result.repos.map(repo => ({ ...repo, source: "codex" as const }))
        }
      }
      setRepos(mergeRepos(codexRepos, agentRepos))
      setError(fetchError)
    } catch (e) {
      fetchError = e instanceof Error ? e.message : "failed"
      const bridge = focusmapDesktopRepoBridge()
      if (bridge?.listCodexRepos) {
        const result = await bridge.listCodexRepos().catch(error => ({
          ok: false,
          repos: [],
          error: error instanceof Error ? error.message : "Codex repo list failed",
        }))
        const codexRepos = result?.ok && Array.isArray(result.repos)
          ? result.repos.map(repo => ({ ...repo, source: "codex" as const }))
          : []
        setRepos(mergeRepos(codexRepos, []))
        setError(codexRepos.length > 0 ? null : fetchError)
      } else {
        setError(fetchError)
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { fetchRepos() }, [fetchRepos])

  const requestRescan = useCallback(async () => {
    await fetch("/api/scan-settings/trigger", { method: "POST", body: "{}" })
  }, [])

  return { repos, isLoading, error, refresh: fetchRepos, requestRescan }
}
