"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

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
    <div className="rounded-lg border">
      <button
        className="flex w-full items-center justify-between p-3 text-left"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-sm font-medium">外部AI連携ガイド</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="border-t px-3 pb-3 pt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            Codexなどの外部AIからFocusmap APIを呼び、マインドマップのAI案を保存できます。
          </p>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium">設定例</p>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            <pre className="rounded bg-muted p-2 text-[11px] overflow-x-auto">
              <code>{configExample}</code>
            </pre>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium">利用可能なエンドポイント</p>
            <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
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
    </div>
  )
}
