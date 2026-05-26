"use client"

import { useCallback, useState } from "react"
import { AiChatPanel } from "./ai-chat-panel"
import { AutoChatView } from "@/components/chat/auto-chat-view"
import { MindMap } from "@/components/dashboard/mind-map"
import { Project, Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"
import { cn } from "@/lib/utils"

interface AiViewProps {
  projects: Project[]
  selectedSpaceId: string | null
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  // MindMap 用
  selectedProject: Project | null | undefined
  groups: Task[]
  tasks: Task[]
  // MindMap ハンドラー
  onCreateGroup?: (title: string) => Promise<Task | null>
  onDeleteGroup?: (groupId: string) => Promise<void>
  onReorderGroup?: (groupId: string, referenceGroupId: string, position: 'above' | 'below') => Promise<void>
  onUpdateProject?: (projectId: string, title: string) => Promise<void>
  onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
  onDeleteTask?: (taskId: string) => Promise<void>
  onBulkDelete?: (groupIds: string[], taskIds: string[]) => Promise<void>
  onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
  // AI コールバック
  refreshFromServer: () => Promise<void>
  onCalendarEventCreated?: (eventData?: { id: string; title: string; scheduled_at: string; estimated_time: number; calendar_id?: string | null }) => void
  onRefreshCalendar?: () => Promise<void>
  onAddOptimisticEvent?: (event: CalendarEvent) => void
  onRemoveOptimisticEvent?: (eventId: string) => void
  onOpenLinkedMemos?: (taskId: string) => void
}

export function AiView({
  projects,
  selectedSpaceId,
  selectedProjectId,
  onSelectProject,
  selectedProject,
  groups,
  tasks,
  onCreateGroup,
  onDeleteGroup,
  onReorderGroup,
  onUpdateProject,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onBulkDelete,
  onReorderTask,
  refreshFromServer,
  onCalendarEventCreated,
  onRefreshCalendar,
  onAddOptimisticEvent,
  onRemoveOptimisticEvent,
  onOpenLinkedMemos,
}: AiViewProps) {
  const [chatMode, setChatMode] = useState<"normal" | "automation">("normal")
  const handleMindmapUpdated = useCallback(() => {
    refreshFromServer()
  }, [refreshFromServer])

  return (
    <div className="flex h-full w-full">
      {/* 左: AI チャット */}
      <div className="flex flex-1 min-w-0 flex-col border-r">
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
            <AiChatPanel
              mode="fullscreen"
              activeProjectId={selectedProjectId}
              onMindmapUpdated={handleMindmapUpdated}
              onCalendarEventCreated={onCalendarEventCreated}
            />
          ) : (
            <AutoChatView spaceId={selectedSpaceId} />
          )}
        </div>
      </div>

      {/* 右: マインドマップ (デスクトップのみ) */}
      <div className="hidden md:flex w-[50%] flex-col min-w-0">
        {selectedProject ? (
          <>
            {/* マインドマップヘッダー */}
            <div className="px-4 py-2.5 border-b shrink-0 flex items-center justify-between">
              <span className="text-sm font-medium truncate">{selectedProject.title}</span>
              {projects.length > 1 && (
                <select
                  value={selectedProjectId || ''}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="text-xs border rounded px-2 py-1 bg-background"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              )}
            </div>
            {/* マインドマップ本体 */}
            <div className="flex-1 min-h-0">
              <MindMap
                project={selectedProject}
                groups={groups}
                tasks={tasks}
                onCreateGroup={onCreateGroup}
                onDeleteGroup={onDeleteGroup}
                onReorderGroup={onReorderGroup}
                onUpdateProject={onUpdateProject}
                onCreateTask={onCreateTask}
                onUpdateTask={onUpdateTask}
                onDeleteTask={onDeleteTask}
                onBulkDelete={onBulkDelete}
                onReorderTask={onReorderTask}
                onRefreshCalendar={onRefreshCalendar}
                onAddOptimisticEvent={onAddOptimisticEvent}
                onRemoveOptimisticEvent={onRemoveOptimisticEvent}
                onOpenLinkedMemos={onOpenLinkedMemos}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <p>プロジェクトを選択するとマインドマップが表示されます</p>
          </div>
        )}
      </div>
    </div>
  )
}
