"use client"

import { UnifiedChat } from "@/components/chat/unified-chat"

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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <UnifiedChat spaceId={selectedSpaceId} projectId={selectedProjectId} />
    </div>
  )
}
