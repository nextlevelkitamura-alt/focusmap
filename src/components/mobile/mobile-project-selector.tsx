"use client"

import { useState, useRef, useEffect } from "react"
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
    onSelectSpace?: (id: string | null) => void
    onCreateGroup: () => void
    onCreateProject?: (title: string) => Promise<Project | null>
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
    onSelectSpace,
    onCreateGroup,
    onCreateProject,
}: MobileProjectSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [isCreating, setIsCreating] = useState(false)
    const [createTitle, setCreateTitle] = useState('')
    const createInputRef = useRef<HTMLInputElement>(null)

    const currentSpaceName = selectedSpaceId
        ? spaces.find(s => s.id === selectedSpaceId)?.title
        : "全体"

    useEffect(() => {
        if (isCreating && createInputRef.current) {
            createInputRef.current.focus()
        }
    }, [isCreating])

    const handleCreateSubmit = async () => {
        const title = createTitle.trim()
        if (!title || !onCreateProject) {
            setIsCreating(false)
            setCreateTitle('')
            return
        }
        const newProject = await onCreateProject(title)
        setIsCreating(false)
        setCreateTitle('')
        if (newProject) {
            onSelectProject(newProject.id)
            setIsOpen(false)
        }
    }

    return (
        <div className="flex items-center justify-between px-3 py-2.5 border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
            {/* プロジェクト選択 */}
            <Popover open={isOpen} onOpenChange={(open) => {
                setIsOpen(open)
                if (!open) {
                    setIsCreating(false)
                    setCreateTitle('')
                }
            }}>
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
                    <div className="max-h-[60vh] overflow-y-auto">
                        {/* スペース切り替えチップ */}
                        {onSelectSpace && spaces.length > 0 && (
                            <div className="px-3 pt-2.5 pb-1.5 border-b">
                                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                                    <button
                                        onClick={() => onSelectSpace(null)}
                                        className={cn(
                                            "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
                                            selectedSpaceId === null
                                                ? "bg-primary text-primary-foreground border-primary"
                                                : "border-border text-muted-foreground hover:bg-muted"
                                        )}
                                    >
                                        全体
                                    </button>
                                    {spaces.map(s => (
                                        <button
                                            key={s.id}
                                            onClick={() => onSelectSpace(s.id)}
                                            className={cn(
                                                "shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors",
                                                selectedSpaceId === s.id
                                                    ? "bg-primary text-primary-foreground border-primary"
                                                    : "border-border text-muted-foreground hover:bg-muted"
                                            )}
                                        >
                                            {s.title}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="py-1">
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

                            {projects.length === 0 && (
                                <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                                    プロジェクトがありません
                                </div>
                            )}

                            {/* プロジェクト新規作成 */}
                            {onCreateProject && (
                                <>
                                    <div className="mx-3 my-1 border-t" />
                                    {isCreating ? (
                                        <div className="px-3 py-1.5">
                                            <input
                                                ref={createInputRef}
                                                value={createTitle}
                                                onChange={(e) => setCreateTitle(e.target.value)}
                                                placeholder="プロジェクト名..."
                                                className="w-full text-sm bg-muted/50 border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary"
                                                onKeyDown={(e) => {
                                                    if (e.nativeEvent.isComposing) return
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        handleCreateSubmit()
                                                    }
                                                    if (e.key === 'Escape') {
                                                        setIsCreating(false)
                                                        setCreateTitle('')
                                                    }
                                                }}
                                                onBlur={handleCreateSubmit}
                                            />
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setIsCreating(true)}
                                            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                                        >
                                            <Plus className="w-4 h-4" />
                                            <span>新しいプロジェクト</span>
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
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
