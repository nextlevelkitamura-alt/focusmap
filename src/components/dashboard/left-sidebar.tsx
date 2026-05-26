"use client"

import { useState, useRef, useEffect, useMemo } from "react"
import { Project, Space } from "@/types/database"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
    MoreHorizontal, Plus, ChevronRight, ChevronDown,
    Pencil, Trash2, Palette, ArrowRightLeft, FolderInput,
} from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
    DEFAULT_PROJECT_COLOR, DEFAULT_SPACE_COLOR, normalizeColor,
} from "@/lib/color-utils"
import { SpaceCreateDialog } from "./space-create-dialog"
import { UsageCard } from "@/components/usage/usage-card"

const EXPAND_KEY = "focusmap:sidebarExpandedSpaces"

const statusMap: Record<string, string> = {
    active: "実行",
    concept: "構想",
    archived: "アーカイブ",
}

// アーカイブ済みプロジェクトはツリーに出さない（管理は設定画面で）
function isArchivedProject(p: Project) {
    return p.status === "archived" || p.status === "completed"
}

// --- インライン入力 ---
function InlineInput({
    inputRef, value, placeholder, onChange, onSubmit, onCancel, indent,
}: {
    inputRef: React.RefObject<HTMLInputElement | null>
    value: string
    placeholder: string
    onChange: (v: string) => void
    onSubmit: () => void
    onCancel: () => void
    indent?: boolean
}) {
    return (
        <div className={cn("py-1", indent ? "pl-7 pr-2" : "px-2")}>
            <input
                ref={inputRef}
                value={value}
                placeholder={placeholder}
                onChange={e => onChange(e.target.value)}
                onKeyDown={e => {
                    if (e.key === "Enter") { e.preventDefault(); onSubmit() }
                    if (e.key === "Escape") onCancel()
                }}
                onBlur={() => (value.trim() ? onSubmit() : onCancel())}
                className="w-full text-sm bg-muted/50 border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
            />
        </div>
    )
}

// --- プロジェクト行 ---
interface ProjectRowProps {
    project: Project
    isSelected: boolean
    isRenaming: boolean
    renameTitle: string
    renameInputRef: React.RefObject<HTMLInputElement | null>
    otherSpaces: Space[]
    onSelect: () => void
    onRenameChange: (v: string) => void
    onRenameSubmit: () => void
    onRenameCancel: () => void
    onStartRename: () => void
    onUpdateStatus: (status: string) => void
    onUpdateColor: (color: string) => void
    onMoveToSpace: (spaceId: string) => void
    onDelete: () => void
}

function ProjectRow({
    project, isSelected, isRenaming, renameTitle, renameInputRef, otherSpaces,
    onSelect, onRenameChange, onRenameSubmit, onRenameCancel, onStartRename,
    onUpdateStatus, onUpdateColor, onMoveToSpace, onDelete,
}: ProjectRowProps) {
    const color = normalizeColor(project.color_theme, DEFAULT_PROJECT_COLOR)

    if (isRenaming) {
        return (
            <InlineInput
                inputRef={renameInputRef}
                value={renameTitle}
                placeholder="プロジェクト名..."
                onChange={onRenameChange}
                onSubmit={onRenameSubmit}
                onCancel={onRenameCancel}
                indent
            />
        )
    }

    return (
        <div
            onClick={onSelect}
            className={cn(
                "group relative flex items-center gap-2 py-1.5 pl-7 pr-2 rounded-md cursor-pointer transition-colors",
                isSelected ? "bg-muted/70 border-l-2" : "hover:bg-muted/40",
            )}
            style={isSelected ? { borderLeftColor: color } : undefined}
        >
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-sm leading-none truncate flex-1">{project.title}</span>
            {project.status === "concept" && (
                <span className="text-[9px] text-muted-foreground/60 shrink-0">構想</span>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={e => e.stopPropagation()}
                    >
                        <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={e => { e.stopPropagation(); onStartRename() }}>
                        <Pencil className="w-3.5 h-3.5 mr-2" />名前を変更
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                            <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />ステータス変更
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            {["active", "concept", "archived"].filter(s => s !== project.status).map(s => (
                                <DropdownMenuItem key={s} onClick={e => { e.stopPropagation(); onUpdateStatus(s) }}>
                                    {statusMap[s] || s}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {otherSpaces.length > 0 && (
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <FolderInput className="w-3.5 h-3.5 mr-2" />スペースを移動
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                {otherSpaces.map(s => (
                                    <DropdownMenuItem key={s.id} onClick={e => { e.stopPropagation(); onMoveToSpace(s.id) }}>
                                        {s.title}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    )}
                    <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                        <Palette className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="flex-1 text-muted-foreground">色</span>
                        <input
                            type="color"
                            value={color}
                            onClick={e => e.stopPropagation()}
                            onChange={e => onUpdateColor(e.target.value)}
                            className="h-7 w-8 cursor-pointer rounded border bg-transparent p-0.5"
                            aria-label={`${project.title}の色`}
                        />
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={e => { e.stopPropagation(); onDelete() }}
                    >
                        <Trash2 className="w-3.5 h-3.5 mr-2" />削除
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}

// --- LeftSidebar ---
interface LeftSidebarProps {
    spaces: Space[]
    projects: Project[]
    selectedSpaceId: string | null
    selectedProjectId: string | null
    onSelectSpace: (id: string | null) => void
    onSelectProject: (id: string) => void
    onCreateSpace: (title: string, color?: string) => Promise<Space | null>
    onUpdateSpace: (spaceId: string, updates: Partial<Space>) => Promise<void>
    onDeleteSpace: (spaceId: string) => Promise<void>
    onCreateProject: (title: string, status?: string, spaceId?: string, colorTheme?: string) => Promise<Project | null>
    onUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<void>
    onDeleteProject: (projectId: string) => Promise<void>
}

export function LeftSidebar({
    spaces, projects, selectedSpaceId, selectedProjectId,
    onSelectSpace, onSelectProject,
    onCreateSpace, onUpdateSpace, onDeleteSpace,
    onCreateProject, onUpdateProject, onDeleteProject,
}: LeftSidebarProps) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [showSpaceDialog, setShowSpaceDialog] = useState(false)

    // プロジェクト作成（インライン）
    const [creatingInSpace, setCreatingInSpace] = useState<string | null>(null)
    const [newProjectTitle, setNewProjectTitle] = useState("")
    const createInputRef = useRef<HTMLInputElement>(null)
    const isSubmittingRef = useRef(false)

    // 名前変更（インライン）
    const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
    const [renamingSpaceId, setRenamingSpaceId] = useState<string | null>(null)
    const [renameTitle, setRenameTitle] = useState("")
    const renameInputRef = useRef<HTMLInputElement>(null)

    // 展開状態を localStorage から復元 + 選択中プロジェクトのスペースは展開
    useEffect(() => {
        let restored: string[] = []
        try {
            const raw = localStorage.getItem(EXPAND_KEY)
            if (raw) restored = JSON.parse(raw)
        } catch { /* ignore */ }
        const next = new Set(restored)
        const selProject = projects.find(p => p.id === selectedProjectId)
        if (selProject) next.add(selProject.space_id)
        else if (selectedSpaceId) next.add(selectedSpaceId)
        setExpanded(next)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
        if (creatingInSpace && createInputRef.current) createInputRef.current.focus()
    }, [creatingInSpace])

    useEffect(() => {
        if ((renamingProjectId || renamingSpaceId) && renameInputRef.current) {
            renameInputRef.current.focus()
            renameInputRef.current.select()
        }
    }, [renamingProjectId, renamingSpaceId])

    const persistExpanded = (next: Set<string>) => {
        try {
            localStorage.setItem(EXPAND_KEY, JSON.stringify([...next]))
        } catch { /* ignore */ }
    }

    const toggleExpand = (spaceId: string) => {
        setExpanded(prev => {
            const next = new Set(prev)
            if (next.has(spaceId)) next.delete(spaceId)
            else next.add(spaceId)
            persistExpanded(next)
            return next
        })
    }

    const expandSpace = (spaceId: string) => {
        setExpanded(prev => {
            if (prev.has(spaceId)) return prev
            const next = new Set(prev)
            next.add(spaceId)
            persistExpanded(next)
            return next
        })
    }

    const projectsBySpace = useMemo(() => {
        const map = new Map<string, Project[]>()
        for (const p of projects) {
            if (isArchivedProject(p)) continue
            const arr = map.get(p.space_id) || []
            arr.push(p)
            map.set(p.space_id, arr)
        }
        // 実行 → 構想 の順
        for (const arr of map.values()) {
            arr.sort((a, b) => (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1))
        }
        return map
    }, [projects])

    const handleSelectProject = (project: Project) => {
        onSelectProject(project.id)
        if (project.space_id !== selectedSpaceId) onSelectSpace(project.space_id)
    }

    const handleSelectSpace = (spaceId: string) => {
        onSelectSpace(spaceId)
        toggleExpand(spaceId)
    }

    const handleStartCreateProject = (spaceId: string) => {
        setCreatingInSpace(spaceId)
        setNewProjectTitle("")
        expandSpace(spaceId)
    }

    const submitCreateProject = async () => {
        if (isSubmittingRef.current) return
        if (!newProjectTitle.trim() || !creatingInSpace) return
        isSubmittingRef.current = true
        try {
            await onCreateProject(newProjectTitle.trim(), "active", creatingInSpace)
            setNewProjectTitle("")
            setCreatingInSpace(null)
        } finally {
            isSubmittingRef.current = false
        }
    }

    const submitRenameProject = async () => {
        if (renameTitle.trim() && renamingProjectId) {
            await onUpdateProject(renamingProjectId, { title: renameTitle.trim() })
        }
        setRenamingProjectId(null)
        setRenameTitle("")
    }

    const submitRenameSpace = async () => {
        if (renameTitle.trim() && renamingSpaceId) {
            await onUpdateSpace(renamingSpaceId, { title: renameTitle.trim() })
        }
        setRenamingSpaceId(null)
        setRenameTitle("")
    }

    return (
        <div className="flex flex-col h-full w-full bg-muted/10 overflow-hidden border-r border-border/30">
            {/* スペース見出し + 作成 */}
            <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
                <span className="text-xs font-semibold text-muted-foreground tracking-wide">
                    スペース
                </span>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSpaceDialog(true)}
                    title="スペースを追加"
                >
                    <Plus className="w-4 h-4" />
                </Button>
            </div>

            <ScrollArea className="flex-1 h-full" hideScrollbar>
                <div className="px-2 pb-3 space-y-0.5">
                    {spaces.length === 0 && (
                        <div className="text-[11px] text-muted-foreground/60 px-3 py-4 text-center">
                            スペースがありません。
                            <br />右上の + で追加してください。
                        </div>
                    )}

                    {spaces.map(space => {
                        const isExpanded = expanded.has(space.id)
                        const spaceColor = normalizeColor(space.color, DEFAULT_SPACE_COLOR)
                        const spaceProjects = projectsBySpace.get(space.id) || []
                        const isActiveSpace = selectedSpaceId === space.id

                        return (
                            <div key={space.id}>
                                {/* スペース行 */}
                                {renamingSpaceId === space.id ? (
                                    <InlineInput
                                        inputRef={renameInputRef}
                                        value={renameTitle}
                                        placeholder="スペース名..."
                                        onChange={setRenameTitle}
                                        onSubmit={submitRenameSpace}
                                        onCancel={() => { setRenamingSpaceId(null); setRenameTitle("") }}
                                    />
                                ) : (
                                    <div
                                        onClick={() => handleSelectSpace(space.id)}
                                        className={cn(
                                            "group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors",
                                            isActiveSpace ? "bg-muted/60" : "hover:bg-muted/40",
                                        )}
                                    >
                                        {isExpanded
                                            ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                            : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                                        <span
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: spaceColor }}
                                        />
                                        <span className="text-sm font-semibold leading-none truncate flex-1">
                                            {space.title}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground/50 shrink-0">
                                            {spaceProjects.length || ""}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                            onClick={e => { e.stopPropagation(); handleStartCreateProject(space.id) }}
                                            title="プロジェクトを追加"
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                                    onClick={e => e.stopPropagation()}
                                                >
                                                    <MoreHorizontal className="w-3.5 h-3.5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-44">
                                                <DropdownMenuItem onClick={e => {
                                                    e.stopPropagation()
                                                    setRenamingSpaceId(space.id)
                                                    setRenameTitle(space.title)
                                                }}>
                                                    <Pencil className="w-3.5 h-3.5 mr-2" />名前を変更
                                                </DropdownMenuItem>
                                                <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                                                    <Palette className="w-3.5 h-3.5 text-muted-foreground" />
                                                    <span className="flex-1 text-muted-foreground">色</span>
                                                    <input
                                                        type="color"
                                                        value={spaceColor}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => onUpdateSpace(space.id, {
                                                            color: normalizeColor(e.target.value, DEFAULT_SPACE_COLOR),
                                                        })}
                                                        className="h-7 w-8 cursor-pointer rounded border bg-transparent p-0.5"
                                                        aria-label={`${space.title}の色`}
                                                    />
                                                </div>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem
                                                    className="text-destructive focus:text-destructive"
                                                    onClick={e => {
                                                        e.stopPropagation()
                                                        if (window.confirm(`スペース「${space.title}」を削除しますか？\n配下のプロジェクトも全て削除されます。`)) {
                                                            onDeleteSpace(space.id)
                                                        }
                                                    }}
                                                >
                                                    <Trash2 className="w-3.5 h-3.5 mr-2" />削除
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                )}

                                {/* プロジェクト一覧 */}
                                {isExpanded && (
                                    <div className="mb-1">
                                        {spaceProjects.map(p => (
                                            <ProjectRow
                                                key={p.id}
                                                project={p}
                                                isSelected={selectedProjectId === p.id}
                                                isRenaming={renamingProjectId === p.id}
                                                renameTitle={renameTitle}
                                                renameInputRef={renameInputRef}
                                                otherSpaces={spaces.filter(s => s.id !== p.space_id)}
                                                onSelect={() => handleSelectProject(p)}
                                                onRenameChange={setRenameTitle}
                                                onRenameSubmit={submitRenameProject}
                                                onRenameCancel={() => { setRenamingProjectId(null); setRenameTitle("") }}
                                                onStartRename={() => { setRenamingProjectId(p.id); setRenameTitle(p.title) }}
                                                onUpdateStatus={s => onUpdateProject(p.id, { status: s })}
                                                onUpdateColor={c => onUpdateProject(p.id, { color_theme: normalizeColor(c, DEFAULT_PROJECT_COLOR) })}
                                                onMoveToSpace={spaceId => onUpdateProject(p.id, { space_id: spaceId })}
                                                onDelete={() => {
                                                    if (window.confirm(`「${p.title}」を削除しますか？\nグループとタスクも全て削除されます。`)) {
                                                        onDeleteProject(p.id)
                                                    }
                                                }}
                                            />
                                        ))}
                                        {creatingInSpace === space.id && (
                                            <InlineInput
                                                inputRef={createInputRef}
                                                value={newProjectTitle}
                                                placeholder="プロジェクト名..."
                                                onChange={setNewProjectTitle}
                                                onSubmit={submitCreateProject}
                                                onCancel={() => { setCreatingInSpace(null); setNewProjectTitle("") }}
                                                indent
                                            />
                                        )}
                                        <button
                                            onClick={() => handleStartCreateProject(space.id)}
                                            className="flex items-center gap-1.5 w-full pl-7 pr-2 py-1.5 text-xs text-muted-foreground/70 hover:text-foreground transition-colors"
                                        >
                                            <Plus className="w-3 h-3" />
                                            プロジェクトを追加
                                        </button>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </ScrollArea>

            <div className="border-t border-border/40 p-2.5">
                <UsageCard spaceId={selectedSpaceId} compact />
            </div>

            <SpaceCreateDialog
                open={showSpaceDialog}
                onClose={() => setShowSpaceDialog(false)}
                onCreate={onCreateSpace}
            />
        </div>
    )
}
