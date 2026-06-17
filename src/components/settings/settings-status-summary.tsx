"use client"

import { useEffect, useMemo, useState } from "react"
import { Bot, CalendarDays, FolderKanban, KeyRound } from "lucide-react"
import { fetchWithSupabaseAuth } from "@/lib/auth/supabase-auth-fetch"
import {
  SettingsStatusChip,
  SettingsStatusTile,
  type SettingsStatusTone,
} from "@/components/settings/settings-primitives"

type RunnerHeartbeat = {
  status?: string | null
  last_seen_at?: string | null
  last_heartbeat_at?: string | null
  updated_at?: string | null
}

type ApiKeyRow = {
  id: string
  is_active?: boolean | null
  scopes?: string[] | null
  last_used_at?: string | null
}

type CalendarStatus = {
  isConnected?: boolean
  isSyncEnabled?: boolean
  syncStatus?: string
  lastSyncedAt?: string | null
  needsReconnect?: boolean
  tokenExpired?: boolean
}

export type SettingsStatusSummary = {
  ai: {
    label: string
    detail: string
    tone: SettingsStatusTone
    chip: string
  }
  calendar: {
    label: string
    detail: string
    tone: SettingsStatusTone
    chip: string
  }
  apiKeys: {
    label: string
    detail: string
    tone: SettingsStatusTone
    chip: string
  }
  projects: {
    label: string
    detail: string
    tone: SettingsStatusTone
    chip: string
  }
  loading: boolean
}

const ONLINE_WINDOW_MS = 90_000

function seenAt(heartbeat: RunnerHeartbeat) {
  return heartbeat.last_seen_at || heartbeat.last_heartbeat_at || heartbeat.updated_at || null
}

function isOnlineHeartbeat(heartbeat: RunnerHeartbeat | null | undefined) {
  if (!heartbeat || heartbeat.status === "offline") return false
  const value = seenAt(heartbeat)
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) && Date.now() - time < ONLINE_WINDOW_MS
}

function formatRelativeTime(value: string | null | undefined) {
  if (!value) return "未確認"
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return "未確認"
  const diff = Math.max(0, Date.now() - time)
  if (diff < 60_000) return "1分以内"
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}分前`
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / (60 * 60_000))}時間前`
  return `${Math.round(diff / (24 * 60 * 60_000))}日前`
}

async function readJson(response: Response) {
  if (!response.ok) return null
  return response.json().catch(() => null)
}

const fallbackSummary: SettingsStatusSummary = {
  ai: {
    label: "状態を取得中",
    detail: "Macエージェント",
    tone: "muted",
    chip: "未確認",
  },
  calendar: {
    label: "状態を取得中",
    detail: "Google Calendar",
    tone: "muted",
    chip: "未確認",
  },
  apiKeys: {
    label: "状態を取得中",
    detail: "APIキー",
    tone: "muted",
    chip: "未確認",
  },
  projects: {
    label: "未確認",
    detail: "プロジェクト実行先",
    tone: "muted",
    chip: "未確認",
  },
  loading: true,
}

export function useSettingsStatusSummary(): SettingsStatusSummary {
  const [summary, setSummary] = useState<SettingsStatusSummary>(fallbackSummary)

  useEffect(() => {
    let active = true

    async function load() {
      const [heartbeatData, calendarData, apiKeyData] = await Promise.all([
        fetchWithSupabaseAuth("/api/task-progress/runner-heartbeats?limit=5", { cache: "no-store" })
          .then(readJson)
          .catch(() => null),
        fetchWithSupabaseAuth("/api/calendar/status", { cache: "no-store" })
          .then(readJson)
          .catch(() => null),
        fetchWithSupabaseAuth("/api/v1/api-keys", { cache: "no-store" })
          .then(readJson)
          .catch(() => null),
      ])

      const heartbeats = Array.isArray(heartbeatData?.heartbeats)
        ? heartbeatData.heartbeats as RunnerHeartbeat[]
        : []
      const latestHeartbeat = heartbeats
        .map(heartbeat => ({ heartbeat, seen: seenAt(heartbeat) }))
        .filter((entry): entry is { heartbeat: RunnerHeartbeat; seen: string } => Boolean(entry.seen))
        .sort((a, b) => Date.parse(b.seen) - Date.parse(a.seen))[0]?.heartbeat ?? null

      const runnerReady = isOnlineHeartbeat(latestHeartbeat)
      const calendar = calendarData as CalendarStatus | null
      const rawApiKeys = Array.isArray(apiKeyData?.data) ? apiKeyData.data as ApiKeyRow[] : []
      const activeKeys = rawApiKeys.filter(key => key.is_active !== false)
      const highRiskKeys = activeKeys.filter(key => Array.isArray(key.scopes) && key.scopes.some(scope => scope.includes("write") || scope.includes("runners")))
      const lastUsedAt = activeKeys
        .map(key => key.last_used_at)
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null

      if (!active) return

      setSummary({
        ai: {
          label: runnerReady ? "Macエージェント 接続中" : latestHeartbeat ? "Macエージェント 要確認" : "Macエージェント 未確認",
          detail: latestHeartbeat ? `最終確認 ${formatRelativeTime(seenAt(latestHeartbeat))}` : "heartbeat未取得",
          tone: runnerReady ? "ok" : "attention",
          chip: runnerReady ? "接続中" : "要確認",
        },
        calendar: {
          label: calendar?.isConnected ? "Google Calendar 連携中" : calendar ? "Google Calendar 要確認" : "Google Calendar 未確認",
          detail: calendar?.lastSyncedAt ? `最終同期 ${formatRelativeTime(calendar.lastSyncedAt)}` : "最終同期 未確認",
          tone: calendar?.isConnected && !calendar.needsReconnect && !calendar.tokenExpired ? "ok" : calendar ? "attention" : "muted",
          chip: calendar?.isConnected ? "接続中" : calendar ? "要確認" : "未確認",
        },
        apiKeys: {
          label: `${activeKeys.length} active`,
          detail: lastUsedAt ? `最終使用 ${formatRelativeTime(lastUsedAt)}` : highRiskKeys.length > 0 ? "高権限scopeあり" : "危険scope 未確認",
          tone: highRiskKeys.length > 0 ? "attention" : "neutral",
          chip: highRiskKeys.length > 0 ? "要確認" : `${activeKeys.length} keys`,
        },
        projects: {
          label: "repo / context",
          detail: "既存APIで詳細未確認",
          tone: "muted",
          chip: "未確認",
        },
        loading: false,
      })
    }

    void load()

    return () => {
      active = false
    }
  }, [])

  return summary
}

export function SettingsStatusSummaryBlock({
  compact = false,
  summary = fallbackSummary,
}: {
  compact?: boolean
  summary?: SettingsStatusSummary
}) {
  const items = useMemo(() => [
    {
      icon: Bot,
      title: "AI実行",
      value: summary.ai.label,
      detail: summary.ai.detail,
      chip: summary.ai.chip,
      tone: summary.ai.tone,
    },
    {
      icon: CalendarDays,
      title: "Google Calendar",
      value: summary.calendar.label,
      detail: summary.calendar.detail,
      chip: summary.calendar.chip,
      tone: summary.calendar.tone,
    },
    {
      icon: KeyRound,
      title: "APIキー",
      value: summary.apiKeys.label,
      detail: summary.apiKeys.detail,
      chip: summary.apiKeys.chip,
      tone: summary.apiKeys.tone,
    },
    {
      icon: FolderKanban,
      title: "プロジェクト実行先",
      value: summary.projects.label,
      detail: summary.projects.detail,
      chip: summary.projects.chip,
      tone: summary.projects.tone,
    },
  ], [summary])

  if (compact) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.045] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-zinc-50">運用状態</h2>
          <SettingsStatusChip tone={summary.ai.tone}>{summary.loading ? "取得中" : summary.ai.chip}</SettingsStatusChip>
        </div>
        <p className="mt-2 text-[13px] leading-5 text-zinc-400">
          {summary.ai.label} / {summary.calendar.label} / {summary.apiKeys.label}
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(item => (
        <SettingsStatusTile key={item.title} {...item} />
      ))}
    </div>
  )
}
