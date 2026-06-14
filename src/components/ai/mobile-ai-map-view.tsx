"use client"

import { useState } from "react"
import { Bot, MessageCircle } from "lucide-react"
import { MobileMindMap } from "@/components/mobile/mobile-mind-map"
import { SpaceProjectSwitcher } from "@/components/dashboard/space-project-switcher"
import { Button } from "@/components/ui/button"
import type { Project, Space, Task } from "@/types/database"
import type { Note } from "@/types/note"

interface MobileAiMapViewProps {
  projects: Project[]
  spaces: Space[]
  selectedProjectId: string | null
  selectedSpaceId: string | null
  onSelectProject: (id: string | null) => void
  onSelectSpace: (id: string | null) => void
  selectedProject: Project | null | undefined
  groups: Task[]
  tasks: Task[]
  allTasks?: Task[]
  onCreateGroup?: (title: string) => Promise<Task | null>
  onDeleteGroup?: (groupId: string) => Promise<void>
  onUpdateProject?: (projectId: string, title: string) => Promise<void>
  onPatchProject?: (projectId: string, updates: Partial<Project>) => Promise<void>
  onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
  onDeleteTask?: (taskId: string) => Promise<void>
  onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
  onOpenLinkedMemos?: (taskId: string) => void
  onKanbanUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
  onKanbanDeleteTask?: (taskId: string) => Promise<void>
  refreshFromServer: () => Promise<void>
  onOpenProjectChat: () => void
}

export function getSelectableMindmapNotes({
  notes,
  projects,
  selectedProjectId,
  selectedSpaceId,
  limit = 50,
}: {
  notes: Note[]
  projects: Array<Pick<Project, "id" | "space_id">>
  selectedProjectId: string | null
  selectedSpaceId: string | null
  limit?: number
}) {
  const scopedProjectIds = selectedSpaceId
    ? new Set(projects.filter(project => project.space_id === selectedSpaceId).map(project => project.id))
    : null

  return notes
    .filter(note => note.status === "pending")
    .filter(note => !note.task_id)
    .filter(note => {
      if (selectedProjectId) return note.project_id === selectedProjectId
      if (scopedProjectIds) return !!note.project_id && scopedProjectIds.has(note.project_id)
      return true
    })
    .slice(0, limit)
}

export function MobileAiMapView({
  projects,
  spaces,
  selectedProjectId,
  selectedSpaceId,
  onSelectProject,
  onSelectSpace,
  selectedProject,
  groups,
  tasks,
  allTasks,
  onCreateGroup,
  onDeleteGroup,
  onUpdateProject,
  onPatchProject,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onReorderTask,
  onOpenLinkedMemos,
  onKanbanUpdateTask,
  onKanbanDeleteTask,
  refreshFromServer,
  onOpenProjectChat,
}: MobileAiMapViewProps) {
  const [codexOpenSignal, setCodexOpenSignal] = useState(0)
  void refreshFromServer

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="z-10 shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center justify-start gap-1.5">
            <SpaceProjectSwitcher
              spaces={spaces}
              projects={projects}
              selectedSpaceId={selectedSpaceId}
              selectedProjectId={selectedProjectId}
              onSelectSpace={onSelectSpace}
              onSelectProject={onSelectProject}
              showAllProjectsOption={false}
              variant="memoHeaderCompact"
              className="min-w-0 justify-start"
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-11 w-11 shrink-0 rounded-md"
            onClick={() => setCodexOpenSignal(value => value + 1)}
            aria-label="Codexを開く"
            title="Codex"
          >
            <Bot className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-11 w-11 shrink-0 rounded-md"
            onClick={onOpenProjectChat}
            disabled={!selectedProjectId}
            aria-label="プロジェクトチャットを開く"
            title="プロジェクトチャット"
          >
            <MessageCircle className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {selectedProject ? (
          <MobileMindMap
            project={selectedProject}
            spaces={spaces}
            projects={projects}
            groups={groups}
            tasks={tasks}
            allTasks={allTasks}
            onCreateGroup={onCreateGroup}
            onDeleteGroup={onDeleteGroup}
            onUpdateProject={onUpdateProject}
            onPatchProject={onPatchProject}
            onCreateTask={onCreateTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            onReorderTask={onReorderTask}
            onOpenLinkedMemos={onOpenLinkedMemos}
            onKanbanUpdateTask={onKanbanUpdateTask}
            onKanbanDeleteTask={onKanbanDeleteTask}
            codexOpenSignal={codexOpenSignal}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            プロジェクトを選択するとマップが表示されます
          </div>
        )}
      </div>

    </div>
  )
}
