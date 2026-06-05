"use client"

import { useEffect, useState } from "react"
import { Activity, Loader2, WifiOff, Download } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"

const HEARTBEAT_ONLINE_WINDOW_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 30_000

export type AgentConnectionState = "online" | "offline" | "absent" | "loading"

interface RunnerRow {
  last_heartbeat_at: string | null
  metadata?: unknown
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
      try {
        const res = await fetchWithSupabaseAuth("/api/ai-runners", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const allRunners: RunnerRow[] = Array.isArray(data?.runners) ? data.runners : []
        if (!mounted) return
        // ターミナル等を実行できる focusmap-agent だけを対象にする
        const runners = allRunners.filter(r => canExecuteRemoteCommands(r.metadata))
        if (runners.length === 0) {
          setState("absent")
          return
        }
        const now = Date.now()
        const anyOnline = runners.some(r => {
          const t = r.last_heartbeat_at ? new Date(r.last_heartbeat_at).getTime() : 0
          return t > 0 && now - t < HEARTBEAT_ONLINE_WINDOW_MS
        })
        setState(anyOnline ? "online" : "offline")
      } catch {
        // ネットワーク失敗時は状態を維持（チラつき防止）
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
