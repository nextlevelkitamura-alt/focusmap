"use client"

import { useState, useRef, useEffect } from "react"
import { Project, Space } from "@/types/database"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Plus, ChevronRight, ChevronDown, Pencil, Trash2, ArrowRightLeft } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// --- Status label map ---
const statusMap: Record<string, string> = {
    active: "実行",
    concept: "構想",
    archived: "アーカイブ",
}

// --- InlineCreate (file-scope component) ---
interface InlineCreateProps {
    inputRef: React.RefObject<HTMLInputElement | null>
    value: string
    onChange: (value: string) => void
    onSubmit: () => void
    onCancel: () => void
}

function InlineCreate({ inputRef, value, onChange, onSubmit, onCancel }: InlineCreateProps) {
    return (
        <div className="py-1 px-3">
            <input
                ref={inputRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="プロジェクト名..."
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        onSubmit()
                    }
                    if (e.key === 'Escape') onCancel()
                }}
                onBlur={() => {
                    if (value.trim()) {
                        onSubmit()
                    } else {
                        onCancel()
                    }
                }}
                className="w-full text-sm bg-muted/50 border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
            />
        </div>
    )
}

// --- ProjectCard (file-scope component) ---
interface ProjectCardProps {
    project: Project
    isSelected: boolean
    isRenaming: boolean
    renameTitle: string
    renameInputRef: React.RefObject<HTMLInputElement | null>
    spaceName: string | null
    onSelect: () => void
    onRenameChange: (value: string) => void
    onRenameSubmit: () => void
    onRenameCancel: () => void
    onStartRename: () => void
    onUpdateStatus: (status: string) => void
    onDelete: () => void
}

function ProjectCard({
    project, isSelected, isRenaming, renameTitle, renameInputRef,
    spaceName, onSelect, onRenameChange, onRenameSubmit, onRenameCancel,
    onStartRename, onUpdateStatus, onDelete,
}: ProjectCardProps) {
    let statusColor = "bg-green-500"
    if (project.status === 'concept' || project.status === 'on_hold') statusColor = "bg-blue-500"
    if (project.status === 'completed' || project.status === 'archived') statusColor = "bg-gray-500"
    if (project.status === 'active') {
        if (project.priority >= 4) statusColor = "bg-red-500"
        else if (project.priority === 3) statusColor = "bg-green-500"
    }

    if (isRenaming) {
        return (
            <div className="py-1.5 px-3">
                <input
                    ref={renameInputRef}
                    value={renameTitle}
                    onChange={(e) => onRenameChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') onRenameSubmit()
                        if (e.key === 'Escape') onRenameCancel()
                    }}
                    onBlur={onRenameSubmit}
                    className="w-full text-sm bg-muted/50 border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-primary"
                />
            </div>
        )
    }

    return (
        <div
            onClick={onSelect}
            draggable
            onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/json', JSON.stringify({
                    type: 'project',
                    projectId: project.id,
                }))
                e.currentTarget.style.opacity = '0.4'
            }}
            onDragEnd={(e) => {
                e.currentTarget.style.opacity = '1'
            }}
            className={cn(
                "group relative py-2 px-3 rounded-md transition-all cursor-pointer hover:bg-muted/50",
                isSelected ? "bg-muted/60 border-l-2 border-l-primary" : "hover:bg-muted/30"
            )}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("w-2 h-2 rounded-full flex-shrink-0", statusColor)} />
                    <span className="text-sm font-medium leading-none truncate">
                        {project.title}
                    </span>
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <MoreHorizontal className="w-3.5 h-3.5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation()
                            onStartRename()
                        }}>
                            <Pencil className="w-3.5 h-3.5 mr-2" />
                            名前を変更
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <ArrowRightLeft className="w-3.5 h-3.5 mr-2" />
                                ステータス変更
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                {['active', 'concept', 'archived'].filter(s => s !== project.status).map(status => (
                                    <DropdownMenuItem
                                        key={status}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            onUpdateStatus(status)
                                        }}
                                    >
                                        {statusMap[status] || status}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete()
                            }}
                        >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            削除
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            {spaceName && (
                <div className="ml-4 mt-0.5 text-[10px] text-muted-foreground/60 truncate">
                    {spaceName}
                </div>
            )}
        </div>
    )
}

// --- Section (file-scope component) ---
interface SectionProps {
    id: string
    title: string
    items: Project[]
    count: number
    status: string
    isCollapsed: boolean
    onToggle: () => void
    onStartCreate: () => void
    showSpacePicker: boolean
    spaces: Space[]
    onSelectSpaceForCreate: (spaceId: string) => void
    creatingInSection: string | null
    createInputRef: React.RefObject<HTMLInputElement | null>
    newProjectTitle: string
    onNewProjectTitleChange: (value: string) => void
    onCreateSubmit: () => void
    onCreateCancel: () => void
    // ProjectCard rendering props
    selectedProjectId: string | null
    renamingProjectId: string | null
    renameTitle: string
    renameInputRef: React.RefObject<HTMLInputElement | null>
    selectedSpaceId: string | null
    allSpaces: Space[]
    onSelectProject: (id: string) => void
    onRenameChange: (value: string) => void
    onRenameSubmit: () => void
    onRenameCancel: () => void
    onStartRename: (projectId: string, currentTitle: string) => void
    onUpdateStatus: (projectId: string, status: string) => void
    onDeleteProject: (projectId: string) => void
    onDropProject: (projectId: string, newStatus: string) => void
}

function Section({
    id, title, items, count, status,
    isCollapsed, onToggle, onStartCreate,
    showSpacePicker, spaces, onSelectSpaceForCreate,
    creatingInSection, createInputRef, newProjectTitle,
    onNewProjectTitleChange, onCreateSubmit, onCreateCancel,
    selectedProjectId, renamingProjectId, renameTitle, renameInputRef,
    selectedSpaceId, allSpaces, onSelectProject,
    onRenameChange, onRenameSubmit, onRenameCancel,
    onStartRename, onUpdateStatus, onDeleteProject, onDropProject,
}: SectionProps) {
    const [isDragOver, setIsDragOver] = useState(false)

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!isDragOver) setIsDragOver(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        // Only trigger leave if we're actually leaving the section (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false)
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragOver(false)
        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'))
            if (data.type === 'project') {
                onDropProject(data.projectId, status)
            }
        } catch {
            // Ignore invalid drag data
        }
    }

    return (
        <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
                "rounded-md transition-colors",
                isDragOver && "bg-primary/10 ring-1 ring-primary/30"
            )}
        >
            <button
                onClick={onToggle}
                className="flex items-center justify-between w-full px-1 py-1 group hover:bg-muted/30 rounded-sm"
            >
                <div className="flex items-center gap-1">
                    {isCollapsed ? (
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    ) : (
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    )}
                    <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
                    {count > 0 && (
                        <span className="text-[10px] text-muted-foreground/50 ml-1">{count}</span>
                    )}
                </div>
                {id !== 'archive' && (
                    showSpacePicker ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Plus className="w-3 h-3" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuLabel className="text-xs">スペースを選択</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {spaces.map(space => (
                                    <DropdownMenuItem
                                        key={space.id}
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            onSelectSpaceForCreate(space.id)
                                        }}
                                    >
                                        {space.title}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                                e.stopPropagation()
                                onStartCreate()
                            }}
                        >
                            <Plus className="w-3 h-3" />
                        </Button>
                    )
                )}
            </button>
            {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                    {items.map(p => (
                        <ProjectCard
                            key={p.id}
                            project={p}
                            isSelected={selectedProjectId === p.id}
                            isRenaming={renamingProjectId === p.id}
                            renameTitle={renameTitle}
                            renameInputRef={renameInputRef}
                            spaceName={selectedSpaceId === null ? allSpaces.find(s => s.id === p.space_id)?.title || null : null}
                            onSelect={() => onSelectProject(p.id)}
                            onRenameChange={onRenameChange}
                            onRenameSubmit={onRenameSubmit}
                            onRenameCancel={onRenameCancel}
                            onStartRename={() => onStartRename(p.id, p.title)}
                            onUpdateStatus={(s) => onUpdateStatus(p.id, s)}
                            onDelete={() => {
                                if (window.confirm(`「${p.title}」を削除しますか？\nグループとタスクも全て削除されます。`)) {
                                    onDeleteProject(p.id)
                                }
                            }}
                        />
                    ))}
                    {creatingInSection === id && (
                        <InlineCreate
                            inputRef={createInputRef}
                            value={newProjectTitle}
                            onChange={onNewProjectTitleChange}
                            onSubmit={onCreateSubmit}
                            onCancel={onCreateCancel}
                        />
                    )}
                    {items.length === 0 && creatingInSection !== id && (
                        <div className="text-[10px] text-muted-foreground/40 px-3 py-2 italic">
                            プロジェクトなし
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// --- LeftSidebar (main component) ---
interface LeftSidebarProps {
    spaces: Space[]
    selectedSpaceId: string | null
    projects: Project[]
    selectedProjectId: string | null
    onSelectProject: (id: string) => void
    onCreateProject?: (title: string, status?: string, spaceId?: string) => Promise<Project | null>
    onUpdateProject?: (projectId: string, updates: Partial<Project>) => Promise<void>
    onDeleteProject?: (projectId: string) => Promise<void>
}

export function LeftSidebar({
    spaces,
    selectedSpaceId,
    projects,
    selectedProjectId,
    onSelectProject,
    onCreateProject,
    onUpdateProject,
    onDeleteProject,
}: LeftSidebarProps) {
    // Section collapse state
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['archive']))
    // Inline create state
    const [creatingInSection, setCreatingInSection] = useState<string | null>(null)
    const [newProjectTitle, setNewProjectTitle] = useState("")
    const [selectedCreateSpaceId, setSelectedCreateSpaceId] = useState<string | null>(null)
    const createInputRef = useRef<HTMLInputElement>(null)
    const isSubmittingRef = useRef(false)
    // Inline rename state
    const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null)
    const [renameTitle, setRenameTitle] = useState("")
    const renameInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (creatingInSection && createInputRef.current) {
            createInputRef.current.focus()
        }
    }, [creatingInSection])

    useEffect(() => {
        if (renamingProjectId && renameInputRef.current) {
            renameInputRef.current.focus()
            renameInputRef.current.select()
        }
    }, [renamingProjectId])

    const toggleSection = (section: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev)
            if (next.has(section)) next.delete(section)
            else next.add(section)
            return next
        })
    }

    const handleCreateSubmit = async (status: string) => {
        if (isSubmittingRef.current) return
        if (!newProjectTitle.trim() || !onCreateProject) return
        isSubmittingRef.current = true
        try {
            await onCreateProject(newProjectTitle.trim(), status, selectedCreateSpaceId || undefined)
            setNewProjectTitle("")
            setCreatingInSection(null)
            setSelectedCreateSpaceId(null)
        } finally {
            isSubmittingRef.current = false
        }
    }

    const handleRenameSubmit = async () => {
        if (!renameTitle.trim() || !renamingProjectId || !onUpdateProject) return
        await onUpdateProject(renamingProjectId, { title: renameTitle.trim() })
        setRenamingProjectId(null)
        setRenameTitle("")
    }

    const handleCreateCancel = () => {
        setCreatingInSection(null)
        setNewProjectTitle("")
        setSelectedCreateSpaceId(null)
    }

    const handleRenameCancel = () => {
        setRenamingProjectId(null)
        setRenameTitle("")
    }

    // Filter projects by status
    const activeProjects = projects.filter(p => p.status === 'active')
    const conceptProjects = projects.filter(p => p.status === 'concept' || p.status === 'on_hold')
    const archiveProjects = projects.filter(p => p.status === 'completed' || p.status === 'archived')

    // Whether to show space picker (全体 mode)
    const needsSpacePicker = selectedSpaceId === null

    // Get the current creating section's status for submit
    const getStatusForSection = (sectionId: string) => {
        if (sectionId === 'active') return 'active'
        if (sectionId === 'concept') return 'concept'
        return 'archived'
    }

    const sectionProps = {
        createInputRef,
        newProjectTitle,
        onNewProjectTitleChange: setNewProjectTitle,
        onCreateSubmit: () => {
            if (creatingInSection) handleCreateSubmit(getStatusForSection(creatingInSection))
        },
        onCreateCancel: handleCreateCancel,
        creatingInSection,
        selectedProjectId,
        renamingProjectId,
        renameTitle,
        renameInputRef,
        selectedSpaceId,
        allSpaces: spaces,
        onSelectProject,
        onRenameChange: setRenameTitle,
        onRenameSubmit: handleRenameSubmit,
        onRenameCancel: handleRenameCancel,
        onStartRename: (projectId: string, currentTitle: string) => {
            setRenamingProjectId(projectId)
            setRenameTitle(currentTitle)
        },
        onUpdateStatus: (projectId: string, status: string) => {
            onUpdateProject?.(projectId, { status })
        },
        onDeleteProject: (projectId: string) => {
            onDeleteProject?.(projectId)
        },
        onDropProject: (projectId: string, newStatus: string) => {
            onUpdateProject?.(projectId, { status: newStatus })
        },
        showSpacePicker: needsSpacePicker,
        spaces,
    }

    const handleStartCreate = (sectionId: string) => {
        setCreatingInSection(sectionId)
        setNewProjectTitle("")
        if (collapsedSections.has(sectionId)) toggleSection(sectionId)
    }

    const handleSelectSpaceForCreate = (sectionId: string, spaceId: string) => {
        setSelectedCreateSpaceId(spaceId)
        setCreatingInSection(sectionId)
        setNewProjectTitle("")
        if (collapsedSections.has(sectionId)) toggleSection(sectionId)
    }

    return (
        <div className="flex flex-col h-full w-full bg-muted/10 overflow-hidden border-r border-border/30">
            {/* Project List */}
            <ScrollArea className="flex-1 h-full" hideScrollbar={true}>
                <div className="p-3 space-y-4">
                    <Section
                        id="active"
                        title="実行 (Active)"
                        items={activeProjects}
                        count={activeProjects.length}
                        status="active"
                        isCollapsed={collapsedSections.has('active')}
                        onToggle={() => toggleSection('active')}
                        onStartCreate={() => handleStartCreate('active')}
                        onSelectSpaceForCreate={(spaceId) => handleSelectSpaceForCreate('active', spaceId)}
                        {...sectionProps}
                    />
                    <Section
                        id="concept"
                        title="構想 (Concept)"
                        items={conceptProjects}
                        count={conceptProjects.length}
                        status="concept"
                        isCollapsed={collapsedSections.has('concept')}
                        onToggle={() => toggleSection('concept')}
                        onStartCreate={() => handleStartCreate('concept')}
                        onSelectSpaceForCreate={(spaceId) => handleSelectSpaceForCreate('concept', spaceId)}
                        {...sectionProps}
                    />
                    <Section
                        id="archive"
                        title="アーカイブ"
                        items={archiveProjects}
                        count={archiveProjects.length}
                        status="archived"
                        isCollapsed={collapsedSections.has('archive')}
                        onToggle={() => toggleSection('archive')}
                        onStartCreate={() => handleStartCreate('archive')}
                        onSelectSpaceForCreate={(spaceId) => handleSelectSpaceForCreate('archive', spaceId)}
                        {...sectionProps}
                    />
                </div>
            </ScrollArea>
        </div>
    )
}
