"use client"

import { useState } from "react"
import { ChevronRight, ChevronDown, Check } from "lucide-react"
import { Project, Space } from "@/types/database"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { DEFAULT_PROJECT_COLOR, DEFAULT_SPACE_COLOR, normalizeColor } from "@/lib/color-utils"

interface SpaceProjectSwitcherProps {
  spaces: Space[]
  projects: Project[]
  selectedSpaceId: string | null
  selectedProjectId: string | null
  onSelectSpace: (id: string | null) => void
  onSelectProject: (id: string) => void
}

function isArchived(p: Project) {
  return p.status === "archived" || p.status === "completed"
}

/**
 * 中央ペイン上部のパンくず＝現在地表示 + 切替ポップオーバー。
 * サイドバーを開かずにスペース/プロジェクトを切り替える主導線。
 */
export function SpaceProjectSwitcher({
  spaces,
  projects,
  selectedSpaceId,
  selectedProjectId,
  onSelectSpace,
  onSelectProject,
}: SpaceProjectSwitcherProps) {
  const [open, setOpen] = useState(false)

  const currentProject = projects.find(p => p.id === selectedProjectId) || null
  const currentSpace =
    spaces.find(s => s.id === (currentProject?.space_id ?? selectedSpaceId)) || null

  const handlePickProject = (project: Project) => {
    onSelectProject(project.id)
    if (project.space_id !== selectedSpaceId) onSelectSpace(project.space_id)
    setOpen(false)
  }

  return (
    <div className="shrink-0 border-b bg-background px-2 py-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1.5 max-w-full rounded-md px-2 py-1 text-sm hover:bg-muted transition-colors">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: normalizeColor(currentSpace?.color, DEFAULT_SPACE_COLOR) }}
            />
            <span className="text-muted-foreground truncate max-w-[140px]">
              {currentSpace?.title ?? "スペース"}
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground/50 shrink-0" />
            <span className="font-medium truncate max-w-[200px]">
              {currentProject?.title ?? "プロジェクト未選択"}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-1.5" align="start" sideOffset={4}>
          <div className="max-h-[60vh] overflow-y-auto">
            {spaces.length === 0 && (
              <div className="px-2 py-3 text-sm text-muted-foreground text-center">
                スペースがありません
              </div>
            )}
            {spaces.map(space => {
              const spaceProjects = projects.filter(
                p => p.space_id === space.id && !isArchived(p),
              )
              return (
                <div key={space.id} className="mb-1.5 last:mb-0">
                  <button
                    onClick={() => {
                      onSelectSpace(space.id)
                    }}
                    className="flex items-center gap-1.5 w-full px-1.5 py-1 rounded text-left hover:bg-muted/60 transition-colors"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: normalizeColor(space.color, DEFAULT_SPACE_COLOR) }}
                    />
                    <span className="text-sm font-semibold truncate">{space.title}</span>
                  </button>
                  {spaceProjects.map(p => {
                    const active = p.id === selectedProjectId
                    return (
                      <button
                        key={p.id}
                        onClick={() => handlePickProject(p)}
                        className={cn(
                          "flex items-center gap-2 w-full pl-6 pr-2 py-1.5 rounded text-left text-sm transition-colors",
                          active ? "bg-primary/10 text-primary" : "hover:bg-muted/50",
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
                  {spaceProjects.length === 0 && (
                    <div className="pl-6 pr-2 py-1 text-xs text-muted-foreground/50">
                      プロジェクトなし
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
