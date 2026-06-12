"use client"

import { UnifiedChat } from "@/components/chat/unified-chat"

interface AiViewProps {
  selectedSpaceId: string | null
  selectedProjectId: string | null
  selectedProjectTitle?: string | null
}

export function AiView({ selectedSpaceId, selectedProjectId, selectedProjectTitle = null }: AiViewProps) {
  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-background">
      <UnifiedChat spaceId={selectedSpaceId} projectId={selectedProjectId} projectTitle={selectedProjectTitle} />
    </div>
  )
}
