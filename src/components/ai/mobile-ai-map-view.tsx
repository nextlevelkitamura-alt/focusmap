"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { MessageCircle, Network, Plus, Sparkles, X } from "lucide-react"
import { AiChatPanel } from "@/components/ai/ai-chat-panel"
import { MobileMindMap } from "@/components/mobile/mobile-mind-map"
import { MemoToMindmapDialog } from "@/components/memo/memo-to-mindmap-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { Project, Space, Task } from "@/types/database"
import type { Note } from "@/types/note"

interface MobileAiMapViewProps {
  projects: Project[]
  spaces: Space[]
  selectedProjectId: string | null
  selectedSpaceId: string | null
  onSelectProject: (id: string) => void
  onSelectSpace: (id: string | null) => void
  selectedProject: Project | null | undefined
  groups: Task[]
  tasks: Task[]
  onCreateGroup?: (title: string) => Promise<Task | null>
  onDeleteGroup?: (groupId: string) => Promise<void>
  onUpdateProject?: (projectId: string, title: string) => Promise<void>
  onCreateTask?: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<void>
  onDeleteTask?: (taskId: string) => Promise<void>
  onReorderTask?: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
  refreshFromServer: () => Promise<void>
  onCalendarEventCreated?: (eventData?: { id: string; title: string; scheduled_at: string; estimated_time: number; calendar_id?: string | null }) => void
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
  onCreateGroup,
  onDeleteGroup,
  onUpdateProject,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onReorderTask,
  refreshFromServer,
  onCalendarEventCreated,
}: MobileAiMapViewProps) {
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [isMemoPickerOpen, setIsMemoPickerOpen] = useState(false)
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoadingNotes, setIsLoadingNotes] = useState(false)
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set())
  const [isMindmapDialogOpen, setIsMindmapDialogOpen] = useState(false)

  const loadNotes = useCallback(async () => {
    setIsLoadingNotes(true)
    try {
      const res = await fetch("/api/notes")
      if (!res.ok) throw new Error("Failed to load notes")
      const data = await res.json()
      setNotes(Array.isArray(data.notes) ? data.notes : [])
    } catch (error) {
      console.error("[MobileAiMapView] Failed to load notes:", error)
      setNotes([])
    } finally {
      setIsLoadingNotes(false)
    }
  }, [])

  useEffect(() => {
    if (isMemoPickerOpen) void loadNotes()
  }, [isMemoPickerOpen, loadNotes])

  const selectableNotes = useMemo(() => {
    return notes
      .filter(note => note.status !== "archived")
      .filter(note => !selectedProjectId || !note.project_id || note.project_id === selectedProjectId)
      .slice(0, 50)
  }, [notes, selectedProjectId])

  const defaultProjectId = selectedProject?.id ?? null

  const toggleNote = useCallback((noteId: string) => {
    setSelectedNoteIds(prev => {
      const next = new Set(prev)
      if (next.has(noteId)) next.delete(noteId)
      else next.add(noteId)
      return next
    })
  }, [])

  const handleOpenMindmapDialog = useCallback(() => {
    if (selectedNoteIds.size === 0) return
    setIsMemoPickerOpen(false)
    setIsMindmapDialogOpen(true)
  }, [selectedNoteIds])

  const handleMindmapSuccess = useCallback(async (projectId: string) => {
    onSelectProject(projectId)
    setSelectedNoteIds(new Set())
    setIsMindmapDialogOpen(false)
    await refreshFromServer()
  }, [onSelectProject, refreshFromServer])

  const handleCreateRoot = useCallback(async () => {
    await onCreateGroup?.("新しいノード")
    await refreshFromServer()
  }, [onCreateGroup, refreshFromServer])

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="z-10 shrink-0 border-b bg-background/95 px-3 py-2 backdrop-blur">
        <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_auto_auto_auto] gap-2">
          <select
            value={selectedSpaceId ?? ""}
            onChange={(event) => onSelectSpace(event.target.value || null)}
            className="min-w-0 rounded-md border bg-background px-2 py-2 text-xs font-medium"
            aria-label="スペースを選択"
          >
            <option value="">全体</option>
            {spaces.map(space => (
              <option key={space.id} value={space.id}>{space.title}</option>
            ))}
          </select>
          <select
            value={selectedProjectId || ""}
            onChange={(event) => onSelectProject(event.target.value)}
            className="min-w-0 rounded-md border bg-background px-2 py-2 text-xs font-medium"
            aria-label="プロジェクトを選択"
          >
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.title}</option>
            ))}
          </select>
          <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={handleCreateRoot}>
            <Plus className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => setIsMemoPickerOpen(true)}>
            <Network className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon" className="h-9 w-9 shrink-0" onClick={() => setIsChatOpen(true)}>
            <MessageCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {selectedProject ? (
          <MobileMindMap
            project={selectedProject}
            groups={groups}
            tasks={tasks}
            onCreateGroup={onCreateGroup}
            onDeleteGroup={onDeleteGroup}
            onUpdateProject={onUpdateProject}
            onCreateTask={onCreateTask}
            onUpdateTask={onUpdateTask}
            onDeleteTask={onDeleteTask}
            onReorderTask={onReorderTask}
            projects={projects}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            プロジェクトを選択するとマップが表示されます
          </div>
        )}
      </div>

      <Dialog open={isMemoPickerOpen} onOpenChange={setIsMemoPickerOpen}>
        <DialogContent className="max-h-[86dvh] max-w-[94vw] overflow-hidden p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              メモからマップ整理
            </DialogTitle>
          </DialogHeader>
          <div className="max-h-[58dvh] overflow-y-auto px-3 py-2">
            {isLoadingNotes ? (
              <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
            ) : selectableNotes.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">整理できるメモがありません</div>
            ) : (
              <div className="space-y-2">
                {selectableNotes.map(note => {
                  const checked = selectedNoteIds.has(note.id)
                  const preview = note.content.trim().replace(/\s+/g, " ")
                  return (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => toggleNote(note.id)}
                      className={cn(
                        "flex w-full gap-2 rounded-md border p-3 text-left transition-colors",
                        checked ? "border-primary bg-primary/10" : "border-border bg-background active:bg-muted",
                      )}
                    >
                      <span className={cn("mt-0.5 h-4 w-4 rounded border", checked ? "border-primary bg-primary" : "border-muted-foreground/40")} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{preview || "無題メモ"}</span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {note.status === "processed" ? "処理済み" : "未整理"}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t p-3">
            <Button type="button" variant="outline" onClick={() => setIsMemoPickerOpen(false)}>
              閉じる
            </Button>
            <Button type="button" disabled={selectedNoteIds.size === 0} onClick={handleOpenMindmapDialog}>
              整理する
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <MemoToMindmapDialog
        open={isMindmapDialogOpen}
        noteIds={Array.from(selectedNoteIds)}
        source="notes"
        projects={projects}
        spaces={spaces}
        defaultSpaceId={selectedSpaceId}
        defaultProjectId={defaultProjectId}
        onClose={() => setIsMindmapDialogOpen(false)}
        onSuccess={handleMindmapSuccess}
      />

      {isChatOpen && (
        <div className="fixed inset-0 z-[90] bg-background md:hidden">
          <div className="flex h-full flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b px-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4" />
                AIアシスタント
              </div>
              <button type="button" className="rounded-md p-2 active:bg-muted" onClick={() => setIsChatOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <AiChatPanel
                mode="fullscreen"
                activeProjectId={selectedProjectId}
                onMindmapUpdated={refreshFromServer}
                onCalendarEventCreated={onCalendarEventCreated}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
