"use client"

import { useState } from "react"
import { Bot, Check, ChevronDown, ChevronRight, Copy, FileText, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  SettingRow,
  SettingsSection,
  SettingsStatusChip,
} from "@/components/settings/settings-primitives"

export function ApiKeyMcpGuide() {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const configExample = `Base URL: https://focusmap-official.com
Authorization: Bearer sk_focusmap_xxxx...

最初に呼ぶ:
GET /api/v1/bootstrap

AI案を保存:
POST /api/v1/mindmap/drafts
{
  "project_id": "project-id",
  "nodes": [
    { "title": "追加したいノード", "parent_task_id": "parent-id" }
  ]
}

予定を移動:
PATCH /api/v1/calendar/events/{googleEventId}
{
  "calendar_id": "primary",
  "start_time": "2026-06-17T10:00:00+09:00",
  "end_time": "2026-06-17T10:30:00+09:00"
}`

  const handleCopy = async () => {
    await navigator.clipboard.writeText(configExample)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <SettingsSection
      title="外部AI連携ガイド"
      description="APIキーをCodexなどへ渡す時の最小ルール"
    >
      <SettingRow
        icon={Bot}
        title="接続先"
        description="Base URL と Authorization: Bearer <API key> を外部AIに渡します。"
        status={<SettingsStatusChip tone="neutral">/api/v1</SettingsStatusChip>}
        control={
          <Button variant="ghost" size="sm" className="min-h-10 text-zinc-300 hover:bg-white/[0.07] hover:text-white" onClick={handleCopy}>
            {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
            コピー
          </Button>
        }
      />
      <SettingRow
        icon={Workflow}
        title="最初に呼ぶ"
        description="GET /api/v1/bootstrap でスペース、プロジェクト、利用可能scopeを確認します。"
        status={<SettingsStatusChip tone="muted">bootstrap</SettingsStatusChip>}
      />
      <SettingRow
        icon={FileText}
        title="AI案を先に保存"
        description="大きなマップ整理は本番tasksを直接書かず、mindmap draftsに保存してから確定します。"
        status={<SettingsStatusChip tone="attention">draft first</SettingsStatusChip>}
      />

      <button
        className="flex min-h-11 w-full items-center justify-between border-b border-white/[0.07] px-4 py-3 text-left text-[14px] text-zinc-300 transition last:border-b-0 hover:bg-white/[0.04] hover:text-white"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>設定例とエンドポイントを表示</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-500" />
        )}
      </button>
      {isOpen && (
        <div className="space-y-4 border-t border-white/[0.07] px-4 py-4">
          <p className="text-[12px] leading-5 text-zinc-500">
            Codexなどの外部AIからFocusmap APIを呼び、マインドマップのAI案を保存できます。
          </p>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-zinc-100">設定例</p>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-300 hover:bg-white/[0.07] hover:text-white" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <pre className="max-h-80 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/30 p-3 text-[11px] leading-5 text-zinc-300">
              <code>{configExample}</code>
            </pre>
          </div>

          <div className="space-y-1">
            <p className="text-[13px] font-medium text-zinc-100">利用可能なエンドポイント</p>
            <ul className="space-y-0.5 text-[11px] leading-5 text-zinc-500">
              <li>GET /api/v1/bootstrap — 初期情報</li>
              <li>GET /api/v1/mindmap/overview — マップ概要</li>
              <li>POST /api/v1/mindmap/drafts — AI案保存</li>
              <li>POST /api/v1/mindmap/drafts/:id/apply — AI案確定</li>
              <li>POST /api/v1/mindmap/nodes — 単発ノード追加</li>
              <li>GET /api/v1/memos — 現行メモ一覧</li>
              <li>POST /api/v1/memos — 現行メモ追加</li>
              <li>POST /api/v1/calendar/events — 予定作成</li>
              <li>PATCH /api/v1/calendar/events/:id — 予定編集/移動</li>
              <li>POST /api/v1/ai/actions — 複数操作</li>
              <li>GET /api/v1/tasks — タスク一覧</li>
              <li>GET /api/v1/projects — プロジェクト一覧</li>
              <li>GET /api/v1/spaces — スペース一覧</li>
              <li>GET /api/v1/calendar/events — カレンダーイベント</li>
            </ul>
          </div>
        </div>
      )}
    </SettingsSection>
  )
}
