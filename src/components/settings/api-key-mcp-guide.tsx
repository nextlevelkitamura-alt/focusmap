"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ApiKeyMcpGuide() {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const configExample = `{
  "mcpServers": {
    "shikumika": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/claude-code-mcp"],
      "env": {
        "SHIKUMIKA_API_KEY": "sk_shikumika_xxxx..."
      }
    }
  }
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
        <span className="text-sm font-medium">MCP連携ガイド</span>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="border-t px-3 pb-3 pt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            Claude DesktopやCline等のMCPクライアントからShikimikaに接続できます。
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
              <li>GET /api/v1/tasks — タスク一覧</li>
              <li>POST /api/v1/tasks — タスク作成</li>
              <li>GET /api/v1/projects — プロジェクト一覧</li>
              <li>GET /api/v1/spaces — スペース一覧</li>
              <li>GET /api/v1/habits — 習慣一覧</li>
              <li>POST /api/v1/ai/scheduling — AIスケジューリング</li>
              <li>POST /api/v1/ai/chat — AIチャット</li>
              <li>GET /api/v1/calendar/events — カレンダーイベント</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
