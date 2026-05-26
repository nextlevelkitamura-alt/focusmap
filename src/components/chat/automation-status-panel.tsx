"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  Bot,
  CheckCircle2,
  Cloud,
  DownloadCloud,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type StatusLevel = "ok" | "warn" | "missing" | "checking" | "unknown"

interface Runner {
  id: string
  hostname: string
  display_name: string | null
  executors: string[]
  available_secret_names?: string[]
  last_heartbeat_at: string | null
}

interface CalendarStatus {
  isConnected?: boolean
  linkedAccount?: {
    name?: string | null
    email?: string | null
  } | null
  needsReconnect?: boolean
  tokenExpired?: boolean
}

interface LocalStatus {
  claudeInstalled?: boolean
  taskRunnerInstalled?: boolean
  nodeInstalled?: boolean
}

interface PingResult {
  provider: string
  model: string
  ok: boolean
  latency_ms: number
  error?: string
}

interface AutomationStatusPanelProps {
  spaceId: string | null
}

function isRecentHeartbeat(value: string | null | undefined) {
  if (!value) return false
  return Date.now() - new Date(value).getTime() < 2 * 60 * 1000
}

function formatRelativeHeartbeat(value: string | null | undefined) {
  if (!value) return "未確認"
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}秒前`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.round(minutes / 60)
  return `${hours}時間前`
}

function StatusIcon({ level }: { level: StatusLevel }) {
  if (level === "checking") return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (level === "ok") return <CheckCircle2 className="h-3.5 w-3.5" />
  if (level === "warn" || level === "unknown") return <TriangleAlert className="h-3.5 w-3.5" />
  return <XCircle className="h-3.5 w-3.5" />
}

function statusClass(level: StatusLevel) {
  if (level === "ok") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (level === "warn") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (level === "missing") return "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
  return "border-border bg-muted/40 text-muted-foreground"
}

export function AutomationStatusPanel({ spaceId }: AutomationStatusPanelProps) {
  const [runners, setRunners] = useState<Runner[]>([])
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null)
  const [aiPing, setAiPing] = useState<PingResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkingAi, setCheckingAi] = useState(false)
  const [scanMessage, setScanMessage] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setScanMessage(null)
    const runnerUrl = spaceId ? `/api/ai-runners?space_id=${encodeURIComponent(spaceId)}` : "/api/ai-runners"
    const [runnerRes, calendarRes, localRes] = await Promise.allSettled([
      fetch(runnerUrl, { cache: "no-store" }),
      fetch("/api/calendar/status", { cache: "no-store" }),
      fetch("/api/ai-tasks/status", { cache: "no-store" }),
    ])

    if (runnerRes.status === "fulfilled" && runnerRes.value.ok) {
      const data = await runnerRes.value.json()
      setRunners(Array.isArray(data.runners) ? data.runners : [])
    } else {
      setRunners([])
    }

    if (calendarRes.status === "fulfilled" && calendarRes.value.ok) {
      setCalendar(await calendarRes.value.json())
    } else {
      setCalendar(null)
    }

    if (localRes.status === "fulfilled" && localRes.value.ok) {
      setLocalStatus(await localRes.value.json())
    } else {
      setLocalStatus(null)
    }
    setLoading(false)
  }, [spaceId])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const latestRunner = runners[0] ?? null
  const onlineRunner = runners.find(runner => isRecentHeartbeat(runner.last_heartbeat_at)) ?? null
  const runnerExecutors = useMemo(
    () => new Set(runners.flatMap(runner => runner.executors ?? [])),
    [runners],
  )
  const runnerSecrets = useMemo(
    () => new Set(runners.flatMap(runner => runner.available_secret_names ?? [])),
    [runners],
  )

  const testAi = async () => {
    setCheckingAi(true)
    try {
      const res = await fetch("/api/chat/ping", { cache: "no-store" })
      const data = await res.json()
      setAiPing(data)
    } catch (error) {
      setAiPing({
        provider: "unknown",
        model: "unknown",
        ok: false,
        latency_ms: 0,
        error: error instanceof Error ? error.message : "connection failed",
      })
    } finally {
      setCheckingAi(false)
    }
  }

  const requestScan = async () => {
    setScanMessage("確認を依頼中...")
    try {
      const res = await fetch("/api/scan-settings/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(latestRunner?.hostname ? { hostname: latestRunner.hostname } : {}),
      })
      const data = await res.json()
      setScanMessage(res.ok ? data.message : data.error || "確認依頼に失敗しました")
      await refreshStatus()
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "確認依頼に失敗しました")
    }
  }

  const rows: Array<{
    key: string
    icon: React.ComponentType<{ className?: string }>
    label: string
    detail: string
    level: StatusLevel
  }> = [
    {
      key: "pc",
      icon: Laptop,
      label: "PC連携",
      detail: onlineRunner
        ? `${onlineRunner.display_name || onlineRunner.hostname} / ${formatRelativeHeartbeat(onlineRunner.last_heartbeat_at)}`
        : latestRunner
          ? `${latestRunner.display_name || latestRunner.hostname} / 最終 ${formatRelativeHeartbeat(latestRunner.last_heartbeat_at)}`
          : "未登録",
      level: loading ? "checking" : onlineRunner ? "ok" : latestRunner ? "warn" : "missing",
    },
    {
      key: "lite",
      icon: Terminal,
      label: "Liteスクリプト",
      detail: localStatus?.taskRunnerInstalled || latestRunner ? "確認済み" : "未確認",
      level: loading ? "checking" : localStatus?.taskRunnerInstalled || latestRunner ? "ok" : "missing",
    },
    {
      key: "executor",
      icon: Bot,
      label: "実行エンジン",
      detail: runnerExecutors.size
        ? Array.from(runnerExecutors).join(" / ")
        : localStatus?.claudeInstalled
          ? "claude"
          : "未確認",
      level: loading ? "checking" : runnerExecutors.size || localStatus?.claudeInstalled ? "ok" : "warn",
    },
    {
      key: "ai",
      icon: Activity,
      label: "DeepSeek / Gemini",
      detail: aiPing
        ? `${aiPing.model}${aiPing.ok ? ` / ${aiPing.latency_ms}ms` : " / エラー"}`
        : runnerSecrets.has("DEEPSEEK_API_KEY")
          ? "DeepSeekキーあり"
          : "接続テスト未実行",
      level: checkingAi ? "checking" : aiPing ? (aiPing.ok ? "ok" : "missing") : "unknown",
    },
    {
      key: "google",
      icon: Cloud,
      label: "Google認証",
      detail: calendar?.linkedAccount?.email || (calendar?.isConnected ? "接続済み" : "未接続"),
      level: loading ? "checking" : calendar?.isConnected && !calendar.needsReconnect ? "ok" : "missing",
    },
    {
      key: "browser",
      icon: ShieldCheck,
      label: "ブラウザ認証",
      detail: onlineRunner ? "PC側で確認可能" : "PC連携後に確認",
      level: loading ? "checking" : onlineRunner ? "warn" : "missing",
    },
    {
      key: "updates",
      icon: DownloadCloud,
      label: "アップデート",
      detail: scanMessage || "PC内容と更新を確認できます",
      level: scanMessage ? "ok" : "unknown",
    },
  ]

  return (
    <section className="shrink-0 overflow-hidden border-b border-border/40 bg-muted/10 px-3 py-3 md:px-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">自動化セットアップ</h2>
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px]", statusClass(onlineRunner ? "ok" : latestRunner ? "warn" : "missing"))}>
              <StatusIcon level={onlineRunner ? "ok" : latestRunner ? "warn" : "missing"} />
              {onlineRunner ? "このPCで実行可能" : latestRunner ? "PC確認待ち" : "PC未登録"}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {calendar?.linkedAccount?.email ? `連携アカウント: ${calendar.linkedAccount.email}` : "Google / ブラウザ / PC実行状態をここで確認します"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={refreshStatus} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            更新
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={testAi} disabled={checkingAi}>
            {checkingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
            AI接続
          </Button>
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={requestScan}>
            <DownloadCloud className="h-3.5 w-3.5" />
            PC内容・更新確認
          </Button>
          <Button asChild size="sm" className="h-9 gap-1.5 text-xs">
            <a href="/api/calendar/connect?next=/dashboard/chat">
              <ShieldCheck className="h-3.5 w-3.5" />
              Google認証
            </a>
          </Button>
        </div>
      </div>

      <div className="mt-3 grid max-h-[126px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 md:max-h-none md:grid-cols-4 md:overflow-visible md:pr-0 xl:grid-cols-7">
        {rows.map(row => {
          const Icon = row.icon
          return (
            <div key={row.key} className={cn("min-h-[54px] rounded-md border px-2.5 py-2 md:min-h-[58px]", statusClass(row.level))}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-[11px] font-semibold">{row.label}</span>
                </div>
                <StatusIcon level={row.level} />
              </div>
              <p className="mt-1 truncate text-[10px] opacity-80">{row.detail}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
