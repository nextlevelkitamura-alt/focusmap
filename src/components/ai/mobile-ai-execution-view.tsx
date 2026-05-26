"use client"

import { useState } from "react"
import { AutoChatView } from "@/components/chat/auto-chat-view"
import { ChatWorkspace } from "@/components/chat/chat-workspace"
import { cn } from "@/lib/utils"

interface MobileAiExecutionViewProps {
  selectedSpaceId: string | null
  selectedProjectId: string | null
  onMindmapUpdated: () => Promise<void>
  onCalendarEventCreated?: (eventData?: {
    id: string
    title: string
    scheduled_at: string
    estimated_time: number
    calendar_id?: string | null
  }) => void
}

export function MobileAiExecutionView({
  selectedSpaceId,
  selectedProjectId,
  onMindmapUpdated,
  onCalendarEventCreated,
}: MobileAiExecutionViewProps) {
  void onMindmapUpdated
  void onCalendarEventCreated
  const [chatMode, setChatMode] = useState<"normal" | "automation">("normal")

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b bg-background px-3 py-2">
        <div className="grid min-h-11 grid-cols-2 rounded-md border bg-muted/30 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setChatMode("normal")}
            className={cn(
              "rounded px-3 py-2 font-medium transition-colors",
              chatMode === "normal" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            通常チャット
          </button>
          <button
            type="button"
            onClick={() => setChatMode("automation")}
            className={cn(
              "rounded px-3 py-2 font-medium transition-colors",
              chatMode === "automation" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            )}
          >
            自動化チャット
          </button>
        </div>
      </div>

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
  )
}
