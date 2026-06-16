"use client"

import { UnifiedChat } from "@/components/chat/unified-chat"
import type { Project } from "@/types/database"

interface AiViewProps {
  selectedSpaceId: string | null
  selectedProjectId: string | null
  selectedProjectTitle?: string | null
  projects?: Project[]
  onSelectProject?: (id: string) => void
  projectChatLaunchProjectId?: string | null
  projectChatLaunchKey?: number
  onProjectChatLaunchConsumed?: () => void
  variant?: "full" | "map-sidebar"
}

export function AiView({
  selectedSpaceId,
  selectedProjectId,
  selectedProjectTitle = null,
  projects = [],
  onSelectProject,
  projectChatLaunchProjectId = null,
  projectChatLaunchKey = 0,
  onProjectChatLaunchConsumed,
  variant = "full",
}: AiViewProps) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background">
      <UnifiedChat
        spaceId={selectedSpaceId}
        projectId={selectedProjectId}
        projectTitle={selectedProjectTitle}
        projects={projects}
        onSelectProject={onSelectProject}
        projectChatLaunchProjectId={projectChatLaunchProjectId}
        projectChatLaunchKey={projectChatLaunchKey}
        onProjectChatLaunchConsumed={onProjectChatLaunchConsumed}
        variant={variant}
      />
    </div>
  )
}
