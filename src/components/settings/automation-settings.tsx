"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Bot, CalendarCheck, CheckCircle2, Clipboard, DownloadCloud, Inbox, Loader2, Play, Power, PowerOff, RefreshCw, WifiOff, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { AgentStatusBadge } from "@/components/settings/agent-status-badge"
import {
  AGENT_PREF_ASK_CALENDAR_ON_EVENT_CREATE,
  parseAgentCalendarPreferences,
} from "@/lib/ai/agent-preferences"
import type { FocusmapDesktopAutomationStatus } from "@/lib/external-auth-launch"

interface SpaceOption {
  id: string
  title?: string | null
  name?: string | null
}

const CODEX_DOWNLOAD_URL = "https://openai.com/codex/"

function formatStatusTime(value: string | null | undefined) {
  if (!value) return "未取得"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未取得"
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function agentDetail(status: FocusmapDesktopAutomationStatus | null) {
  const agent = status?.agent
  if (!agent) return "状態を取得していません。"
  if (agent.ready && agent.managed) return `Macアプリから起動中 / 接続先: ${agent.apiUrl ?? "config"}`
  if (agent.ready && agent.external) return "launchdなど外部のMacエージェントが動いています。"
  if (!agent.configured) return "~/.focusmap/config.json がまだありません。"
  if (!agent.available) return "Macエージェントのビルドが見つかりません。"
  return "停止中です。接続で起動できます。"
}

function codexDetail(status: FocusmapDesktopAutomationStatus | null) {
  const codex = status?.codex
  if (!codex) return "Macアプリから状態を取得していません。"
  if (codex.appInstalled === false && codex.commandAvailable) {
    return "Codex Desktopが未導入です。接続/復旧でCodexのインストーラーを開けます。"
  }
  if (codex.appInstalled === false) {
    return "Codex Desktopが未導入です。Codexを入れるボタンで公式ページを開けます。"
  }
  if (codex.ready && codex.managed) return "このMacアプリからCodex app-serverを起動しています。"
  if (codex.ready) return "Codex app-serverに接続できます。"
  if (!codex.available) return "Codex.app または codex CLI が見つかりません。"
  if (!codex.scriptAvailable) return "起動スクリプトが見つかりません。"
  return "停止中です。接続で起動できます。"
}

function codexImportDetail(status: FocusmapDesktopAutomationStatus | null) {
  const api = status?.codex?.threadImportApi
  if (!api) return "Macアプリから取り込みAPIの状態を取得していません。"
  if (api.ready) {
    const mode = api.mode === "remote" ? "本番API" : "ローカルAPI"
    return `${mode}でCodex.app起点threadの取り込み口を確認済みです。`
  }
  if (api.reason === "app_not_ready") return "ローカルWebの起動後に確認します。"
  if (api.reason === "not_deployed") return "現在のWeb/APIには取り込み口が未反映です。Macアプリ更新または本番反映が必要です。"
  if (api.reason === "unreachable") return "取り込みAPIに到達できません。接続/復旧で再確認してください。"
  return api.message || "取り込みAPIの状態を確認できません。"
}

function MacCodexConnectionPanel() {
  const [status, setStatus] = useState<FocusmapDesktopAutomationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [bridgeAvailable, setBridgeAvailable] = useState(false)
  const [action, setAction] = useState<"connect" | "disconnect" | "refresh" | "install" | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadStatus = async (silent = false) => {
    if (typeof window === "undefined") return
    const bridge = window.focusmapDesktop
    if (!bridge?.getAutomationStatus) {
      setBridgeAvailable(false)
      setLoading(false)
      return
    }

    setBridgeAvailable(true)
    if (!silent) setLoading(true)
    try {
      const next = await bridge.getAutomationStatus()
      setStatus(next)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mac連携状態の取得に失敗しました")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadStatus()
    const id = window.setInterval(() => void loadStatus(true), 5_000)
    return () => window.clearInterval(id)
  }, [])

  const runDesktopAction = async (nextAction: "connect" | "disconnect" | "refresh") => {
    if (typeof window === "undefined") return
    const bridge = window.focusmapDesktop
    setAction(nextAction)
    setMessage(null)
    try {
      if (nextAction === "refresh") {
        await loadStatus(true)
        setMessage("Mac連携状態を更新しました。")
        return
      }
      const handler = nextAction === "connect" ? bridge?.connectAutomation : bridge?.disconnectAutomation
      if (!handler) {
        setMessage("Focusmap Macアプリから開くと操作できます。")
        return
      }
      const result = await handler()
      if (result.status) setStatus(result.status)
      setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Mac連携操作に失敗しました")
    } finally {
      setAction(null)
      setLoading(false)
    }
  }

  const connected = Boolean(status?.connected)
  const canDisconnect = Boolean(status?.agent.managed || status?.codex.managed)
  const codexNeedsInstall = status?.codex?.appInstalled === false
  const codexInstallUrl = status?.codex?.installUrl || CODEX_DOWNLOAD_URL
  const codexThreadImportReady = status?.codex?.threadImportApi?.ready === true

  const openCodexInstall = async () => {
    if (typeof window === "undefined") return
    const bridge = window.focusmapDesktop
    setAction("install")
    setMessage(null)
    try {
      if (!bridge?.openExternal) {
        setMessage("Focusmap Macアプリから開くとCodexの導入ページを開けます。")
        return
      }
      await bridge.openExternal(codexInstallUrl)
      setMessage("Codexの導入ページを開きました。インストールとログイン後に接続/復旧してください。")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Codexの導入ページを開けませんでした")
    } finally {
      setAction(null)
    }
  }

  if (!bridgeAvailable && !loading) return null

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:shadow-none md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${connected ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>
            {connected ? <CheckCircle2 className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase text-zinc-500">Mac App Control</p>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
              {connected ? "Macアプリ操作は接続中" : "Macアプリ操作は要確認"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              このパネルはFocusmap Macアプリ内だけで表示します。AIエージェントの再接続とCodex導入を操作できます。
            </p>
            {status?.keepAwake?.active && (
              <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                Macアプリのバックグラウンド停止を抑制中です。
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {codexNeedsInstall && (
            <Button
              variant="outline"
              className="h-11 gap-1.5"
              onClick={() => void openCodexInstall()}
              disabled={!bridgeAvailable || action !== null}
            >
              <DownloadCloud className="h-4 w-4" />
              {action === "install" ? "起動中..." : "Codexを入れる"}
            </Button>
          )}
          <Button
            className="h-11 gap-1.5"
            onClick={() => void runDesktopAction("connect")}
            disabled={!bridgeAvailable || action !== null}
          >
            <Power className="h-4 w-4" />
            {action === "connect" ? "接続中..." : "接続/復旧"}
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-1.5"
            onClick={() => void runDesktopAction("disconnect")}
            disabled={!bridgeAvailable || !canDisconnect || action !== null}
          >
            <PowerOff className="h-4 w-4" />
            {action === "disconnect" ? "切断中..." : "切断"}
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-1.5"
            onClick={() => void runDesktopAction("refresh")}
            disabled={!bridgeAvailable || action !== null}
          >
            <RefreshCw className={`h-4 w-4 ${action === "refresh" || loading ? "animate-spin" : ""}`} />
            診断更新
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-white/[0.08] dark:bg-black/30">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Workflow className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            Macエージェント
            <span className="ml-auto rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] text-zinc-700 dark:bg-black/25 dark:text-zinc-300">
              {status?.agent.ready ? "接続中" : "要確認"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{agentDetail(status)}</p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-white/[0.08] dark:bg-black/30">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Bot className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            Codex
            <span className="ml-auto rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] text-zinc-700 dark:bg-black/25 dark:text-zinc-300">
              {codexNeedsInstall ? "要インストール" : status?.codex.ready ? "接続中" : "要確認"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{codexDetail(status)}</p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-white/[0.08] dark:bg-black/30">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            <Inbox className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            Codex thread取り込み
            <span className="ml-auto rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] text-zinc-700 dark:bg-black/25 dark:text-zinc-300">
              {codexThreadImportReady ? "対応済み" : status?.codex.threadImportApi?.checked ? "未反映" : "未確認"}
            </span>
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">{codexImportDetail(status)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 text-xs leading-5 text-zinc-500 md:flex-row md:items-center md:justify-between">
        <span>
          最終診断: {formatStatusTime(status?.timestamp)} / 自動確認: {status?.supervisor?.enabled ? "有効" : "停止"}
        </span>
        {message && <span className="text-zinc-700 dark:text-zinc-300">{message}</span>}
      </div>
    </section>
  )
}

function FocusmapLiteInstallPanel() {
  const [spaces, setSpaces] = useState<SpaceOption[]>([])
  const [spaceId, setSpaceId] = useState("")
  const [command, setCommand] = useState("")
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void fetch("/api/spaces", { cache: "no-store" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!mounted) return
        const rows = Array.isArray(data) ? data : Array.isArray(data?.spaces) ? data.spaces : []
        setSpaces(rows)
        if (rows[0]?.id) setSpaceId(rows[0].id)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])

  const issueToken = async () => {
    if (!spaceId) {
      setMessage("Workspaceを選択してください。")
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch("/api/agents/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: spaceId, name: "Focusmap Lite" }),
      })
      const text = await res.text()
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(text) } catch {
        throw new Error(res.status === 401 ? "ログインセッションが切れています。再読み込みしてください。" : `サーバーエラー (${res.status})`)
      }
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "トークン発行に失敗しました")
      setCommand(typeof data.install_command === "string" ? data.install_command : "")
      setMessage("このコマンドでMacを接続できます。実行後、数十秒で上の状態がオンラインになります。")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "トークン発行に失敗しました")
    } finally {
      setLoading(false)
    }
  }

  const copyCommand = async () => {
    if (!command) return
    await navigator.clipboard.writeText(command)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
        <label className="grid gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          Workspace
          <select
            value={spaceId}
            onChange={event => setSpaceId(event.target.value)}
            className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none focus:ring-1 focus:ring-blue-400 dark:border-white/[0.08] dark:bg-black/40 dark:text-zinc-100"
          >
            {spaces.length === 0 ? (
              <option value="">Workspaceを読み込み中</option>
            ) : spaces.map(space => (
              <option key={space.id} value={space.id}>{space.title ?? space.name ?? space.id}</option>
            ))}
          </select>
        </label>
        <Button className="h-10 gap-1.5" onClick={issueToken} disabled={loading || !spaceId}>
          <DownloadCloud className="h-4 w-4" />
          {loading ? "発行中..." : "導入コマンドを発行"}
        </Button>
      </div>

      {command && (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-white/[0.08] dark:bg-black/40">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Macのターミナルで1回だけ実行</span>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={copyCommand}>
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? "コピー済み" : "コピー"}
            </Button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-3 font-mono text-xs leading-5 text-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
            {command}
          </pre>
        </div>
      )}

      {message && <p className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">{message}</p>}
    </div>
  )
}

function AiCalendarBehaviorSettings() {
  const [askCalendar, setAskCalendar] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    void fetch("/api/ai/context", { cache: "no-store" })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!mounted) return
        const preferences = parseAgentCalendarPreferences(data?.preferences)
        setAskCalendar(preferences.askCalendarOnEventCreate)
      })
      .catch(() => {
        if (mounted) setMessage("AI設定を読み込めませんでした。")
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const updateAskCalendar = async (nextValue: boolean) => {
    const previous = askCalendar
    setAskCalendar(nextValue)
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch("/api/ai/context", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: {
            [AGENT_PREF_ASK_CALENDAR_ON_EVENT_CREATE]: nextValue,
          },
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        throw new Error(typeof data.error === "string" ? data.error : "AI設定を保存できませんでした")
      }
      setMessage(nextValue
        ? "予定を入れる前に、毎回カレンダーを確認します。"
        : "予定作成時はデフォルトカレンダーを使える状態に戻しました。")
    } catch (error) {
      setAskCalendar(previous)
      setMessage(error instanceof Error ? error.message : "AI設定を保存できませんでした")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:shadow-none md:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          <CalendarCheck className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase text-zinc-500">Calendar behavior</p>
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">予定作成時の確認</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            チャットから予定を作る前に、AIが追加先カレンダーを毎回確認します。
          </p>
        </div>
        {loading ? (
          <Loader2 className="mt-2 h-5 w-5 shrink-0 animate-spin text-zinc-400" />
        ) : (
          <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-1">
            <span className="sr-only">予定作成時に毎回カレンダーを聞く</span>
            <Switch
              checked={askCalendar}
              onCheckedChange={value => void updateAskCalendar(value)}
              disabled={saving}
              aria-label="予定作成時に毎回カレンダーを聞く"
            />
          </label>
        )}
      </div>
      <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600 dark:border-white/[0.08] dark:bg-black/30 dark:text-zinc-400">
        ONにすると、時間と予定名だけを伝えた場合でも、AIは予定を登録する前に「どのカレンダーに入れますか？」と聞きます。予定登録後は、必要なら予定詳細も追記できます。
      </div>
      {message && <p className="mt-3 text-xs leading-5 text-zinc-600 dark:text-zinc-400">{message}</p>}
    </section>
  )
}

export function AutomationSettings() {
  return (
    <div className="space-y-5">
      <AgentStatusBadge />

      <MacCodexConnectionPanel />

      <AiCalendarBehaviorSettings />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-[#1c1c1e] dark:shadow-none md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">AIへ依頼</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              メモやノードから依頼を作り、Macエージェントが巡回してCodexへつなぎます。
            </p>
          </div>
          <Button asChild className="h-10 gap-1.5">
            <Link
              href="/dashboard"
              prefetch={false}
              onClick={() => {
                try { localStorage.setItem("focusmap:activeView", "ai") } catch {}
              }}
            >
              <Play className="h-4 w-4" />
              チャットを開く
            </Link>
          </Button>
        </div>

        <details className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-white/[0.08] dark:bg-black/30 dark:text-zinc-300">
          <summary className="cursor-pointer select-none font-medium text-zinc-950 dark:text-zinc-100">
            Macエージェントを導入/再設定
          </summary>
          <div className="mt-3">
            <FocusmapLiteInstallPanel />
          </div>
        </details>
      </section>
    </div>
  )
}
