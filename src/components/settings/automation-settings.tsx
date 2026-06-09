"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Bot, CheckCircle2, Chrome, Clipboard, Cloud, DownloadCloud, KeyRound, Laptop, Play, Power, PowerOff, RefreshCw, ShieldCheck, Terminal, WifiOff, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AutomationStatusPanel } from "@/components/chat/automation-status-panel"
import { ScanSettingsSection } from "@/components/settings/scan-settings-section"
import { AgentStatusBadge } from "@/components/settings/agent-status-badge"
import { startCalendarOAuth, type FocusmapDesktopAutomationStatus } from "@/lib/external-auth-launch"

interface SpaceOption {
  id: string
  title?: string | null
  name?: string | null
}

function SettingBlock({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#1c1c1e] p-4 md:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-blue-300">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-zinc-50">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">{description}</p>
        </div>
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  )
}

function formatStatusTime(value: string | null | undefined) {
  if (!value) return "未取得"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未取得"
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function statusTone(ready: boolean | undefined, inactive = false) {
  if (inactive) return "border-zinc-700 bg-black/30 text-zinc-400"
  return ready
    ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
    : "border-zinc-700 bg-black/30 text-zinc-400"
}

function MacConnectionItem({
  icon: Icon,
  label,
  ready,
  detail,
  inactive = false,
  statusLabel,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  ready: boolean | undefined
  detail: string
  inactive?: boolean
  statusLabel?: string
}) {
  return (
    <div className={`rounded-md border p-3 ${statusTone(ready, inactive)}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100">{label}</span>
        <span className="ml-auto shrink-0 rounded-full bg-black/25 px-2 py-0.5 text-[10px]">
          {statusLabel ?? (ready ? "接続中" : "未接続")}
        </span>
      </div>
      <p className="mt-2 min-h-8 text-xs leading-4 text-zinc-400">{detail}</p>
    </div>
  )
}

function agentDetail(status: FocusmapDesktopAutomationStatus | null) {
  const agent = status?.agent
  if (!agent) return "Macアプリから状態を取得していません。"
  if (agent.ready && agent.managed) return `このMacアプリからfocusmap-agentを起動しています。接続先: ${agent.apiUrl ?? "config"}`
  if (agent.ready && agent.external) return "launchdなど外部のfocusmap-agentが動いています。"
  if (!agent.configured) return "~/.focusmap/config.json がまだありません。"
  if (!agent.available) return "focusmap-agentのビルドが見つかりません。"
  return "停止中です。接続で起動できます。"
}

function codexDetail(status: FocusmapDesktopAutomationStatus | null) {
  const codex = status?.codex
  if (!codex) return "Macアプリから状態を取得していません。"
  if (codex.ready && codex.managed) return "このMacアプリからCodex app-serverを起動しています。"
  if (codex.ready) return "Codex app-serverに接続できます。"
  if (!codex.available) return "Codex.app または codex CLI が見つかりません。"
  if (!codex.scriptAvailable) return "起動スクリプトが見つかりません。"
  return "停止中です。接続で起動できます。"
}

function appDetail(status: FocusmapDesktopAutomationStatus | null) {
  const app = status?.app
  if (!app) return "Macアプリから状態を取得していません。"
  if (app.ready && app.mode === "remote") return `${app.origin ?? "本番Web"} をMacアプリ内で表示しています。`
  if (app.ready) return `${app.origin ?? "localhost"} をMacアプリが管理しています。`
  return "ローカルWebのhealth確認ができていません。"
}

function runnerDetail(status: FocusmapDesktopAutomationStatus | null) {
  const runner = status?.runner
  if (!runner) return "Macアプリから状態を取得していません。"
  if (runner.enabled === false) return runner.disabledReason ?? "Codex監視はfocusmap-agentが担当します。旧runnerは互換/デバッグ時だけ使います。"
  if (!runner.available) return "task-runner起動スクリプトが見つかりません。"
  if (runner.paused) return runner.pauseReason ? `一時停止中: ${runner.pauseReason}` : "一時停止中です。接続で復旧を試します。"
  if (runner.managed) return "監視runnerはこのMacアプリから実行中です。"
  if (runner.lastKickAt) return `監視runnerを起動済み。最終: ${formatStatusTime(runner.lastKickAt)}`
  return "監視runnerは接続時に起動確認します。"
}

function MacCodexConnectionPanel() {
  const [status, setStatus] = useState<FocusmapDesktopAutomationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [bridgeAvailable, setBridgeAvailable] = useState(false)
  const [action, setAction] = useState<"connect" | "disconnect" | "refresh" | null>(null)
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

  return (
    <section className="rounded-lg border border-white/[0.08] bg-[#1c1c1e] p-4 md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${connected ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-800 text-zinc-300"}`}>
            {connected ? <CheckCircle2 className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase text-zinc-500">Mac / Codex Connection</p>
            <h2 className="text-base font-semibold text-zinc-50">
              {bridgeAvailable ? (connected ? "MacBookに接続中" : "MacBookは一部未接続") : "Macアプリ未接続"}
            </h2>
            <p className="mt-1 text-sm leading-6 text-zinc-400">
              Macアプリを開いている間、Focusmap Web、focusmap-agent、Codex app-serverを自動確認します。
            </p>
            {status?.keepAwake?.active && (
              <p className="mt-1 text-xs text-emerald-300">
                Macアプリのバックグラウンド停止を抑制中です。
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
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

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MacConnectionItem icon={Laptop} label="Focusmap 3001" ready={status?.app.ready} detail={appDetail(status)} />
        <MacConnectionItem icon={Workflow} label="focusmap-agent" ready={status?.agent.ready} detail={agentDetail(status)} />
        <MacConnectionItem icon={Bot} label="Codex app-server" ready={status?.codex.ready} detail={codexDetail(status)} />
        <MacConnectionItem
          icon={Terminal}
          label="旧task-runner"
          ready={status?.runner?.ready}
          inactive={status?.runner?.enabled === false}
          statusLabel={status?.runner?.enabled === false ? "通常停止" : undefined}
          detail={runnerDetail(status)}
        />
      </div>

      <div className="mt-3 flex flex-col gap-2 text-xs leading-5 text-zinc-500 md:flex-row md:items-center md:justify-between">
        <span>
          {bridgeAvailable
            ? `最終診断: ${formatStatusTime(status?.timestamp)} / 自動確認: ${status?.supervisor?.enabled ? "有効" : "停止"}`
            : "Focusmap Macアプリ内で開くと接続/切断できます。"}
        </span>
        {message && <span className="text-zinc-300">{message}</span>}
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
        <label className="grid gap-1 text-xs text-zinc-400">
          Workspace
          <select
            value={spaceId}
            onChange={event => setSpaceId(event.target.value)}
            className="h-10 rounded-md border border-white/[0.08] bg-black/40 px-3 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-blue-400"
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
        <div className="rounded-md border border-white/[0.08] bg-black/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-300">Macのターミナルで1回だけ実行</span>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={copyCommand}>
              {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? "コピー済み" : "コピー"}
            </Button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-100">
            {command}
          </pre>
        </div>
      )}

      {message && <p className="text-xs leading-5 text-zinc-400">{message}</p>}
    </div>
  )
}

export function AutomationSettings() {
  return (
    <div className="space-y-5">
      <MacCodexConnectionPanel />

      {/* 常駐エージェントの最上位ステータス (5秒polling) */}
      <AgentStatusBadge />

      <AutomationStatusPanel spaceId={null} />

      <SettingBlock
        icon={DownloadCloud}
        title="Focusmap Liteを導入"
        description="このMacに常駐エージェントを入れると、Webからの指示でPlaywright、ブラウザ起動、ターミナル実行、GWS認証チェックをバックグラウンド実行できます。"
      >
        <FocusmapLiteInstallPanel />
      </SettingBlock>

      <SettingBlock
        icon={Workflow}
        title="自動化"
        description="自動化の指示を判定し、ai_tasks に投入してMac側のランナーがバックグラウンド実行します。"
      >
        <div className="flex flex-wrap gap-2">
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
          <Button variant="outline" className="h-10 gap-1.5" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" />
            状態を再読込
          </Button>
        </div>
      </SettingBlock>

      <SettingBlock
        icon={Terminal}
        title="実行方式"
        description="Webアプリ単体からPCのファイルやターミナルを直接操作するのではなく、Mac側の常駐ランナーが terminal / Playwright / GWS を実行します。"
      >
        <p className="text-xs leading-5 text-zinc-500">
          Focusmapは指示と実行状態を ai_tasks に保存し、Mac側ランナーがそれを取りに行って処理します。ログイン済みブラウザの操作、スプレッドシート書き込み、コマンド実行が必要な処理はこのランナー側で実行します。
        </p>
      </SettingBlock>

      <SettingBlock
        icon={Cloud}
        title="GWS / Google Workspace MCP"
        description="Googleカレンダー、スプレッドシート、Drive、Docs などをMac側のAI実行から扱うためのMCP導入・認証をここで確認します。"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-white/[0.08] bg-black/30 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
              <DownloadCloud className="h-4 w-4 text-blue-300" />
              1. ダウンロード
            </div>
            <p className="text-xs leading-5 text-zinc-500">
              Mac側のランナーに GWS / Google Workspace MCP を入れて、Sheets と Calendar を扱える状態にします。
            </p>
          </div>
          <div className="rounded-md border border-white/[0.08] bg-black/30 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
              <KeyRound className="h-4 w-4 text-blue-300" />
              2. OAuth認証
            </div>
            <p className="text-xs leading-5 text-zinc-500">
              書き込み権限が必要なアカウントで認証します。認証情報はMac側に置く前提です。
            </p>
          </div>
          <div className="rounded-md border border-white/[0.08] bg-black/30 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-100">
              <ShieldCheck className="h-4 w-4 text-blue-300" />
              3. 実行確認
            </div>
            <p className="text-xs leading-5 text-zinc-500">
              ランナーの heartbeat で GWS 認証状態を検出し、未設定なら自動化起動時に案内します。
            </p>
          </div>
        </div>
      </SettingBlock>

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingBlock
          icon={Chrome}
          title="Playwright / ブラウザ権限"
          description="ログインが必要なサイト巡回や入力自動化は、Mac側のPlaywright実行環境とブラウザ認証状態を使います。"
        >
          <p className="text-xs leading-5 text-zinc-500">
            認証切れやブラウザ権限不足が検出された場合は、自動化起動時に設定案内を出します。
          </p>
        </SettingBlock>

        <SettingBlock
          icon={Cloud}
          title="Googleカレンダー認証"
          description="Focusmap本体の予定連携です。GWSとは別に、画面表示とカレンダー同期で使用します。"
        >
          <Button
            className="h-10 gap-1.5"
            onClick={() => startCalendarOAuth('/dashboard/settings/automation')}
          >
            <KeyRound className="h-4 w-4" />
            Google認証を更新
          </Button>
        </SettingBlock>
      </div>

      <section className="rounded-lg border border-white/[0.08] bg-[#1c1c1e] p-2 md:p-3">
        <ScanSettingsSection />
      </section>
    </div>
  )
}
