"use client"

import { useState } from "react"
import { AutoChatView } from "@/components/chat/auto-chat-view"
import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { cn } from "@/lib/utils"

interface AiViewProps {
  selectedSpaceId: string | null
  selectedProjectId: string | null
}

export function AiView({
  selectedSpaceId,
  selectedProjectId,
}: AiViewProps) {
  const [chatMode, setChatMode] = useState<"normal" | "automation">("normal")

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background">
      <div className="shrink-0 border-b bg-background px-4 py-2">
        <div className="inline-grid min-h-9 grid-cols-2 rounded-md border bg-muted/30 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setChatMode("normal")}
            className={cn(
              "rounded px-3 py-1.5 font-medium transition-colors",
              chatMode === "normal" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            通常チャット
          </button>
          <button
            type="button"
            onClick={() => setChatMode("automation")}
            className={cn(
              "rounded px-3 py-1.5 font-medium transition-colors",
              chatMode === "automation" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            自動化チャット
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {chatMode === "normal" ? (
          <ChatWorkspace
            mode="normal"
            spaceId={selectedSpaceId}
            projectId={selectedProjectId}
            title="通常チャット"
          />
        ) : (
          <AutoChatView spaceId={selectedSpaceId} projectId={selectedProjectId} />
        )}
      </div>
    </div>
  )
}
