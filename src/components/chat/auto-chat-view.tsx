"use client"

import { ChatWorkspace } from "@/components/chat/chat-workspace"

interface AutoChatViewProps {
  spaceId: string | null
  projectId?: string | null
}

export function AutoChatView({ spaceId, projectId = null }: AutoChatViewProps) {
  return (
    <ChatWorkspace
      mode="automation"
      spaceId={spaceId}
      projectId={projectId}
      title="自動化チャット"
    />
  )
}
