"use client"

import { useState } from "react"
import { Project, Space } from "@/types/database"
import { ChevronDown, Plus, MoreHorizontal, FolderPlus } from "lucide-react"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface MobileProjectSelectorProps {
    project?: Project
    projects: Project[]
    spaces: Space[]
    selectedSpaceId: string | null
    onSelectProject: (id: string) => void
    onCreateGroup: () => void
}

const statusColorMap: Record<string, string> = {
    active: "bg-green-500",
    concept: "bg-blue-500",
    on_hold: "bg-blue-500",
    completed: "bg-gray-500",
    archived: "bg-gray-500",
}

export function MobileProjectSelector({
    project,
    projects,
    spaces,
    selectedSpaceId,
    onSelectProject,
    onCreateGroup,
}: MobileProjectSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)

    const currentSpaceName = selectedSpaceId
        ? spaces.find(s => s.id === selectedSpaceId)?.title
        : "全体"

    return (
        <div className="flex items-center justify-between px-3 py-2.5 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
            {/* プロジェクト選択 */}
            <Popover open={isOpen} onOpenChange={setIsOpen}>
                <PopoverTrigger asChild>
                    <button className="flex items-center gap-2 min-w-0 flex-1">
                        {/* ステータス色ドット */}
                        <div className={cn(
                            "w-2.5 h-2.5 rounded-full shrink-0",
                            statusColorMap[project?.status ?? 'active'] ?? "bg-green-500"
                        )} />

                        <div className="flex flex-col items-start min-w-0">
                            <span className="text-sm font-semibold truncate max-w-[200px]">
                                {project?.title ?? "プロジェクト未選択"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                                {currentSpaceName}
                            </span>
                        </div>

                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                </PopoverTrigger>

                <PopoverContent
                    className="w-[280px] p-0"
                    align="start"
                    side="bottom"
                    sideOffset={4}
                >
                    <div className="py-1 max-h-[60vh] overflow-y-auto">
                        <div className="px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            プロジェクト
                        </div>
                        {projects.map(p => (
                            <button
                                key={p.id}
                                onClick={() => {
                                    onSelectProject(p.id)
                                    setIsOpen(false)
                                }}
                                className={cn(
                                    "flex items-center gap-2 w-full px-3 py-2 text-sm text-left transition-colors",
                                    p.id === project?.id
                                        ? "bg-primary/10 text-primary"
                                        : "hover:bg-muted/50"
                                )}
                            >
                                <div className={cn(
                                    "w-2 h-2 rounded-full shrink-0",
                                    statusColorMap[p.status ?? 'active'] ?? "bg-green-500"
                                )} />
                                <span className="truncate">{p.title}</span>
                            </button>
                        ))}
                    </div>
                </PopoverContent>
            </Popover>

            {/* ハンバーガーメニュー */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-center w-9 h-9 rounded-md text-muted-foreground active:bg-muted transition-colors">
                        <MoreHorizontal className="w-5 h-5" />
                    </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={onCreateGroup}>
                        <FolderPlus className="w-4 h-4 mr-2" />
                        グループ追加
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
