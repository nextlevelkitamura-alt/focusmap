"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Bot, CheckCircle2, Chrome, Clipboard, Cloud, DownloadCloud, KeyRound, Play, RefreshCw, ShieldCheck, Terminal, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AutomationStatusPanel } from "@/components/chat/automation-status-panel"
import { ScanSettingsSection } from "@/components/settings/scan-settings-section"
import { AgentStatusBadge } from "@/components/settings/agent-status-badge"

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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "トークン発行に失敗しました")
      setCommand(data.install_command)
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

      <div className="grid gap-4 lg:grid-cols-2">
        <SettingBlock
          icon={Workflow}
          title="自動化チャット"
          description="自動化の指示を判定し、ai_tasks に投入してMac側のランナーがバックグラウンド実行します。"
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-10 gap-1.5">
              <Link
                href="/dashboard"
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
          icon={Bot}
          title="モデル設定"
          description="通常チャットと自動化チャットのAI実行設定を管理します。"
        >
          <div className="grid gap-2 text-sm">
            <div className="rounded-md border border-white/[0.08] bg-black/30 px-3 py-2">
              <div className="text-zinc-500">通常チャット</div>
              <div className="font-mono text-zinc-100">gemini-3.1-flash-lite</div>
            </div>
            <div className="rounded-md border border-white/[0.08] bg-black/30 px-3 py-2">
              <div className="text-zinc-500">自動化チャット</div>
              <div className="font-mono text-zinc-100">deepseek-v4-pro</div>
            </div>
          </div>
        </SettingBlock>
      </div>

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
              ランナーの heartbeat で GWS 認証状態を検出し、未設定なら自動化チャット起動時に案内します。
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
            認証切れやブラウザ権限不足が検出された場合は、自動化チャット起動時に設定案内を出します。
          </p>
        </SettingBlock>

        <SettingBlock
          icon={Cloud}
          title="Googleカレンダー認証"
          description="Focusmap本体の予定連携です。GWSとは別に、画面表示とカレンダー同期で使用します。"
        >
          <Button asChild className="h-10 gap-1.5">
            <a href="/api/calendar/connect?next=/dashboard/settings/automation">
              <KeyRound className="h-4 w-4" />
              Google認証を更新
            </a>
          </Button>
        </SettingBlock>
      </div>

      <section className="rounded-lg border border-white/[0.08] bg-[#1c1c1e] p-2 md:p-3">
        <ScanSettingsSection />
      </section>
    </div>
  )
}
