"use client"

import { useCallback } from "react"
import { AiChatPanel } from "./ai-chat-panel"
import { MindMap } from "@/components/dashboard/mind-map"
import { Project, Task } from "@/types/database"
import type { CalendarEvent } from "@/types/calendar"

interface AiViewProps {
  projects: Project[]
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
}

export function AiView({
  projects,
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
}: AiViewProps) {
  const handleMindmapUpdated = useCallback(() => {
    refreshFromServer()
  }, [refreshFromServer])

  return (
    <div className="flex h-full w-full">
      {/* 左: AI チャット */}
      <div className="flex-1 min-w-0 border-r">
        <AiChatPanel
          mode="fullscreen"
          activeProjectId={selectedProjectId}
          onMindmapUpdated={handleMindmapUpdated}
          onCalendarEventCreated={onCalendarEventCreated}
        />
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
