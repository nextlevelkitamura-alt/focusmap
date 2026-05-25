"use client"

import { AiChatPanel } from "@/components/ai/ai-chat-panel"

interface MobileAiExecutionViewProps {
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
  selectedProjectId,
  onMindmapUpdated,
  onCalendarEventCreated,
}: MobileAiExecutionViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <AiChatPanel
        mode="fullscreen"
        activeProjectId={selectedProjectId}
        onMindmapUpdated={onMindmapUpdated}
        onCalendarEventCreated={onCalendarEventCreated}
      />
    </div>
  )
}
