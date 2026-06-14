"use client"

import { UnifiedChat } from "@/components/chat/unified-chat"
import type { Project } from "@/types/database"

interface MobileAiExecutionViewProps {
  selectedSpaceId: string | null
  selectedProjectId: string | null
  selectedProjectTitle?: string | null
  projects?: Project[]
  onSelectProject?: (id: string) => void
  projectChatLaunchProjectId?: string | null
  projectChatLaunchKey?: number
  onProjectChatLaunchConsumed?: () => void
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
  selectedProjectTitle = null,
  projects = [],
  onSelectProject,
  projectChatLaunchProjectId = null,
  projectChatLaunchKey = 0,
  onProjectChatLaunchConsumed,
  onMindmapUpdated,
  onCalendarEventCreated,
}: MobileAiExecutionViewProps) {
  void onMindmapUpdated
  void onCalendarEventCreated

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <UnifiedChat
        spaceId={selectedSpaceId}
        projectId={selectedProjectId}
        projectTitle={selectedProjectTitle}
        projects={projects}
        onSelectProject={onSelectProject}
        projectChatLaunchProjectId={projectChatLaunchProjectId}
        projectChatLaunchKey={projectChatLaunchKey}
        onProjectChatLaunchConsumed={onProjectChatLaunchConsumed}
      />
    </div>
  )
}
