"use client"

import { useCallback, useEffect, useState } from "react"

export interface AvailableRepo {
  id: string
  hostname: string
  absolute_path: string
  display_name: string
  last_git_commit_at: string | null
  last_seen_at: string
}

export function useAvailableRepos() {
  const [repos, setRepos] = useState<AvailableRepo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRepos = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/available-repos")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as AvailableRepo[]
      setRepos(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed")
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
