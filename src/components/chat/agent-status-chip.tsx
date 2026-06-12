"use client"

import { useEffect, useState } from "react"
import { Activity, Loader2, WifiOff, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"

const HEARTBEAT_ONLINE_WINDOW_MS = 5 * 60 * 1000
const RUNNER_HEARTBEAT_ONLINE_WINDOW_MS = 90_000
const POLL_INTERVAL_MS = 30_000

export type AgentConnectionState = "online" | "offline" | "absent" | "loading"

interface RunnerRow {
  last_heartbeat_at: string | null
  metadata?: unknown
}

interface RunnerHeartbeat {
  status?: string | null
  last_seen_at?: string | null
  last_heartbeat_at?: string | null
  updated_at?: string | null
}

/**
 * agent_commands (ターミナル/ブラウザ/ファイル) を実行できる focusmap-agent か。
 * ai_tasks 用 task-runner も ai_runners に heartbeat を出すが agent_commands は claim しないので除外する。
 * (サーバー側 resolveOnlineRunner の判定と揃える)
 */
function canExecuteRemoteCommands(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") return false
  const meta = metadata as Record<string, unknown>
  return meta.app === "focusmap-lite" || meta.agent === "focusmap-agent"
}

function heartbeatSeenAt(heartbeat: RunnerHeartbeat) {
  return heartbeat.last_seen_at || heartbeat.last_heartbeat_at || heartbeat.updated_at || null
}

function latestHeartbeat(heartbeats: RunnerHeartbeat[]) {
  return heartbeats
    .map(heartbeat => ({ heartbeat, seenAt: heartbeatSeenAt(heartbeat) }))
    .filter((entry): entry is { heartbeat: RunnerHeartbeat; seenAt: string } => Boolean(entry.seenAt))
    .sort((a, b) => (Date.parse(b.seenAt) || 0) - (Date.parse(a.seenAt) || 0))[0] ?? null
}

function isOnlineRunnerHeartbeat(heartbeat: RunnerHeartbeat | null | undefined, now = Date.now()) {
  if (!heartbeat || heartbeat.status === "offline") return false
  const seenAt = heartbeatSeenAt(heartbeat)
  const seenMs = seenAt ? Date.parse(seenAt) : Number.NaN
  return Number.isFinite(seenMs) && seenMs > 0 && now - seenMs < RUNNER_HEARTBEAT_ONLINE_WINDOW_MS
}

async function fetchRunnerConnectionState(): Promise<AgentConnectionState | null> {
  const res = await fetchWithSupabaseAuth("/api/ai-runners", { cache: "no-store" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const allRunners: RunnerRow[] = Array.isArray(data?.runners) ? data.runners : []
  const runners = allRunners.filter(r => canExecuteRemoteCommands(r.metadata))
  if (runners.length === 0) return "absent"
  const now = Date.now()
  const anyOnline = runners.some(r => {
    const t = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0
    return t > 0 && now - t < HEARTBEAT_ONLINE_WINDOW_MS
  })
  return anyOnline ? "online" : "offline"
}

async function fetchMonitoringHeartbeatState(): Promise<{ online: boolean; seen: boolean } | null> {
  const res = await fetchWithSupabaseAuth("/api/task-progress/runner-heartbeats?limit=5", { cache: "no-store" })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json().catch(() => ({})) as { heartbeats?: RunnerHeartbeat[] }
  const latest = latestHeartbeat(Array.isArray(data.heartbeats) ? data.heartbeats : [])
  return {
    online: isOnlineRunnerHeartbeat(latest?.heartbeat),
    seen: Boolean(latest),
  }
}

/**
 * Mac常駐エージェントの接続状態を30秒ごとにポーリングして返す。
 * - online : agent_commands を実行できる focusmap-agent が heartbeat 5分以内 → 即実行できる
 * - offline: focusmap-agent は登録済みだが heartbeat 切れ → 予約実行になる
 * - absent : focusmap-agent 未登録 → セットアップが必要
 */
export function useAgentConnection(): { state: AgentConnectionState } {
  const [state, setState] = useState<AgentConnectionState>("loading")

  useEffect(() => {
    let mounted = true

    const poll = async () => {
      const [runnerResult, monitoringResult] = await Promise.all([
        fetchRunnerConnectionState().catch(() => null),
        fetchMonitoringHeartbeatState().catch(() => null),
      ])
      if (!mounted) return

      if (monitoringResult?.online || runnerResult === "online") {
        setState("online")
      } else if (runnerResult === "offline") {
        setState("offline")
      } else if (runnerResult === "absent") {
        setState(monitoringResult?.seen ? "offline" : "absent")
      } else if (monitoringResult?.seen) {
        setState("offline")
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      mounted = false
      window.clearInterval(id)
    }
  }, [])

  return { state }
}

const CHIP_META: Record<Exclude<AgentConnectionState, "loading">, { label: string; icon: typeof Activity; className: string }> = {
  online: {
    label: "Mac接続中・即実行できます",
    icon: Activity,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  offline: {
    label: "Macがオフライン・予約実行になります",
    icon: WifiOff,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  absent: {
    label: "Mac未接続・セットアップが必要です",
    icon: Download,
    className: "border-border bg-muted/40 text-muted-foreground",
  },
}

export function AgentStatusChip({ state }: { state: AgentConnectionState }) {
  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        接続状態を確認中
      </span>
    )
  }
  const meta = CHIP_META[state]
  const Icon = meta.icon
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]", meta.className)}>
      <Icon className={cn("h-3 w-3", state === "online" && "animate-pulse")} />
      {meta.label}
    </span>
  )
}
