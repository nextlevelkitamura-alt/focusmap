"use client"

import { useCallback, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { MobileMindMap } from "@/components/mobile/mobile-mind-map"
import { MemoToMindmapDialog } from "@/components/memo/memo-to-mindmap-dialog"
import { SpaceProjectSwitcher } from "@/components/dashboard/space-project-switcher"
import { Button } from "@/components/ui/button"
import { fetchWishlistItems } from "@/lib/wishlist-cache"
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
}: MobileAiMapViewProps) {
  const [organizeMemoIds, setOrganizeMemoIds] = useState<string[]>([])
  const [organizeMemoProjects, setOrganizeMemoProjects] = useState<Record<string, string | null>>({})
  const [isLoadingOrganizeMemos, setIsLoadingOrganizeMemos] = useState(false)
  const [organizeError, setOrganizeError] = useState<string | null>(null)
  const [isMindmapDialogOpen, setIsMindmapDialogOpen] = useState(false)

  const defaultProjectId = selectedProject?.id ?? null

  const handleOpenMindmapDialog = useCallback(async () => {
    if (!selectedProjectId || isLoadingOrganizeMemos) return

    setIsLoadingOrganizeMemos(true)
    setOrganizeError(null)
    try {
      const items = await fetchWishlistItems({
        spaceId: selectedSpaceId,
        projectId: selectedProjectId,
        force: true,
      })
      const candidates = items
        .filter(item =>
          !item.is_completed &&
          !item.google_event_id &&
          (item.memo_status ?? "unsorted") === "unsorted",
        )
        .slice(0, 50)
      setOrganizeMemoIds(candidates.map(item => item.id))
      setOrganizeMemoProjects(
        Object.fromEntries(candidates.map(item => [item.id, item.project_id ?? null])),
      )
      setIsMindmapDialogOpen(true)
    } catch (error) {
      setOrganizeError(error instanceof Error ? error.message : "メモの取得に失敗しました")
    } finally {
      setIsLoadingOrganizeMemos(false)
    }
  }, [isLoadingOrganizeMemos, selectedProjectId, selectedSpaceId])

  const handleMindmapSuccess = useCallback(async (projectId: string) => {
    onSelectProject(projectId)
    setOrganizeMemoIds([])
    setOrganizeMemoProjects({})
    setIsMindmapDialogOpen(false)
    await refreshFromServer()
  }, [onSelectProject, refreshFromServer])

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="z-10 shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <h1 className="shrink-0 text-lg font-semibold leading-none tracking-normal">マップ</h1>
            <SpaceProjectSwitcher
              spaces={spaces}
              projects={projects}
              selectedSpaceId={selectedSpaceId}
              selectedProjectId={selectedProjectId}
              onSelectSpace={onSelectSpace}
              onSelectProject={onSelectProject}
              showAllProjectsOption={false}
              variant="memoHeaderCompact"
              className="ml-6"
            />
          </div>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-11 w-11 shrink-0 rounded-md"
            onClick={() => { void handleOpenMindmapDialog() }}
            disabled={!selectedProjectId || isLoadingOrganizeMemos}
            aria-label="AIでメモからマップを作成"
            title="AIでメモからマップを作成"
          >
            {isLoadingOrganizeMemos ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
          </Button>
        </div>
        {organizeError && (
          <div className="mt-2 flex min-h-8 items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            <span className="min-w-0 flex-1 truncate">{organizeError}</span>
            <button
              type="button"
              onClick={() => setOrganizeError(null)}
              className="shrink-0 rounded px-2 py-1 hover:bg-destructive/10"
            >
              閉じる
            </button>
          </div>
        )}
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
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            プロジェクトを選択するとマップが表示されます
          </div>
        )}
      </div>

      <MemoToMindmapDialog
        open={isMindmapDialogOpen}
        noteIds={organizeMemoIds}
        noteProjects={organizeMemoProjects}
        source="wishlist"
        projects={projects.map(project => ({ id: project.id, title: project.title }))}
        spaces={spaces.map(space => ({ id: space.id, title: space.title }))}
        defaultSpaceId={selectedSpaceId}
        defaultProjectId={defaultProjectId}
        onClose={() => setIsMindmapDialogOpen(false)}
        onSuccess={handleMindmapSuccess}
        allowTextImport
      />
    </div>
  )
}
