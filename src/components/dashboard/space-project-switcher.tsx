"use client"

import { useState } from "react"
import { ChevronDown, Check, Plus, Layers, FolderKanban, Pencil } from "lucide-react"
import { Project, Space } from "@/types/database"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { DEFAULT_PROJECT_COLOR, DEFAULT_SPACE_COLOR, normalizeColor } from "@/lib/color-utils"
import { CreateProjectDialog } from "./create-project-dialog"
import { SpaceFormDialog, type SpaceFormMode } from "./space-form-dialog"

interface SpaceProjectSwitcherProps {
  spaces: Space[]
  projects: Project[]
  selectedSpaceId: string | null
  selectedProjectId: string | null
  onSelectSpace: (id: string | null) => void
  onSelectProject: (id: string | null) => void
  /** 新規作成されたプロジェクトを親 (lists) に反映するコールバック (任意) */
  onProjectCreated?: (project: Project) => void
  /** スペース作成・更新を親に反映するコールバック (任意) */
  onSpaceSaved?: (space: Space) => void
  showAllProjectsOption?: boolean
  className?: string
}

function isArchived(p: Project) {
  return p.status === "archived" || p.status === "completed"
}

/**
 * Space と Project を **別々のポップオーバー** で切り替える UI。
 *
 * 旧版は1つのポップオーバー内に両方並べていたが、スマホでも操作しやすいよう分離。
 * Project側には「+ 新規プロジェクト」ボタンを内蔵し、その場で追加可能。
 */
export function SpaceProjectSwitcher({
  spaces,
  projects,
  selectedSpaceId,
  selectedProjectId,
  onSelectSpace,
  onSelectProject,
  onProjectCreated,
  onSpaceSaved,
  showAllProjectsOption = false,
  className,
}: SpaceProjectSwitcherProps) {
  const [spaceOpen, setSpaceOpen] = useState(false)
  const [projectOpen, setProjectOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [spaceFormOpen, setSpaceFormOpen] = useState(false)
  const [spaceFormMode, setSpaceFormMode] = useState<SpaceFormMode>("create")
  const [editingSpace, setEditingSpace] = useState<Space | null>(null)

  const currentProject = projects.find((p) => p.id === selectedProjectId) || null
  const currentSpace =
    spaces.find((s) => s.id === (currentProject?.space_id ?? selectedSpaceId)) || null

  // Project switcher に表示する候補: 現在の space に属するもの (未選択時は全体)
  const visibleProjects = selectedSpaceId
    ? projects.filter((p) => p.space_id === selectedSpaceId && !isArchived(p))
    : projects.filter((p) => !isArchived(p))

  const handlePickSpace = (id: string | null) => {
    onSelectSpace(id)
    // Space切替時は project 選択を解除 (showAll の時のみ。それ以外は維持)
    if (showAllProjectsOption) onSelectProject(null)
    setSpaceOpen(false)
  }

  const handlePickProject = (project: Project) => {
    onSelectProject(project.id)
    if (project.space_id !== selectedSpaceId) onSelectSpace(project.space_id)
    setProjectOpen(false)
  }

  const handleProjectCreated = (project: Project) => {
    onProjectCreated?.(project)
    onSelectSpace(project.space_id)
    onSelectProject(project.id)
    setCreateDialogOpen(false)
    setProjectOpen(false)
  }

  const openCreateSpace = () => {
    setSpaceFormMode("create")
    setEditingSpace(null)
    setSpaceFormOpen(true)
    setSpaceOpen(false)
  }

  const openEditSpace = (space: Space) => {
    setSpaceFormMode("edit")
    setEditingSpace(space)
    setSpaceFormOpen(true)
    setSpaceOpen(false)
  }

  const handleSpaceSaved = (space: Space) => {
    onSpaceSaved?.(space)
    if (spaceFormMode === "create") {
      onSelectSpace(space.id)
    }
    setSpaceFormOpen(false)
  }

  return (
    <div className={cn("flex shrink-0 items-center gap-1.5 px-2 py-1", className)}>
      {/* Space switcher */}
      <Popover open={spaceOpen} onOpenChange={setSpaceOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-0 max-w-[180px] items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-sm hover:bg-muted transition-colors"
            title="スペースを切替"
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: normalizeColor(currentSpace?.color, DEFAULT_SPACE_COLOR) }}
            />
            <span className="min-w-0 truncate text-muted-foreground">
              {currentSpace?.title ?? "全体"}
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-60 p-1" align="start" sideOffset={4}>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <Layers className="h-3 w-3" />
            スペース
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {showAllProjectsOption && (
              <button
                onClick={() => handlePickSpace(null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                  selectedSpaceId === null
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/60",
                )}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: DEFAULT_SPACE_COLOR }}
                />
                <span className="truncate flex-1">全体</span>
                {selectedSpaceId === null && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            )}
            {spaces.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                スペースがありません
              </div>
            )}
            {spaces.map((space) => {
              const active = space.id === currentSpace?.id
              return (
                <div
                  key={space.id}
                  className={cn(
                    "group flex w-full items-center gap-1 rounded transition-colors",
                    active ? "bg-primary/10" : "hover:bg-muted/60",
                  )}
                >
                  <button
                    onClick={() => handlePickSpace(space.id)}
                    className={cn(
                      "flex flex-1 items-center gap-2 px-2 py-1.5 text-left text-sm",
                      active ? "text-primary font-medium" : "",
                    )}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: normalizeColor(space.color, DEFAULT_SPACE_COLOR) }}
                    />
                    <span className="truncate flex-1">{space.title}</span>
                    {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openEditSpace(space)
                    }}
                    aria-label={`${space.title} を編集`}
                    title="名前・色を編集"
                    className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-opacity focus:opacity-100"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="mt-1 border-t border-border/40 pt-1">
            <button
              onClick={openCreateSpace}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-primary hover:bg-primary/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate flex-1">新しいスペース</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <span className="text-muted-foreground/40 text-xs select-none">/</span>

      {/* Project switcher */}
      <Popover open={projectOpen} onOpenChange={setProjectOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-0 max-w-[220px] items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-sm hover:bg-muted transition-colors"
            title="プロジェクトを切替"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: normalizeColor(currentProject?.color_theme, DEFAULT_PROJECT_COLOR),
              }}
            />
            <span className="min-w-0 font-medium truncate">
              {currentProject?.title ?? (showAllProjectsOption ? "全プロジェクト" : "プロジェクトを選択")}
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground/60 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-1" align="start" sideOffset={4}>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
            <FolderKanban className="h-3 w-3" />
            プロジェクト {currentSpace && <span className="normal-case">({currentSpace.title})</span>}
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {showAllProjectsOption && (
              <button
                onClick={() => {
                  onSelectProject(null)
                  setProjectOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                  selectedProjectId === null
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/60",
                )}
              >
                <span className="w-2 h-2 rounded-full shrink-0 bg-muted-foreground/30" />
                <span className="truncate flex-1">全プロジェクト</span>
                {selectedProjectId === null && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            )}
            {visibleProjects.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground/70 text-center">
                プロジェクトがありません
              </div>
            )}
            {visibleProjects.map((p) => {
              const active = p.id === selectedProjectId
              return (
                <button
                  key={p.id}
                  onClick={() => handlePickProject(p)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted/60",
                  )}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: normalizeColor(p.color_theme, DEFAULT_PROJECT_COLOR) }}
                  />
                  <span className="truncate flex-1">{p.title}</span>
                  {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
          <div className="mt-1 border-t border-border/40 pt-1">
            <button
              onClick={() => {
                setProjectOpen(false)
                setCreateDialogOpen(true)
              }}
              disabled={spaces.length === 0}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                spaces.length === 0
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "text-primary hover:bg-primary/10",
              )}
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate flex-1">新しいプロジェクト</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <CreateProjectDialog
        open={createDialogOpen}
        spaces={spaces}
        defaultSpaceId={selectedSpaceId ?? currentSpace?.id ?? null}
        onClose={() => setCreateDialogOpen(false)}
        onCreated={handleProjectCreated}
      />

      <SpaceFormDialog
        open={spaceFormOpen}
        mode={spaceFormMode}
        space={editingSpace}
        onClose={() => setSpaceFormOpen(false)}
        onSaved={handleSpaceSaved}
      />
    </div>
  )
}
