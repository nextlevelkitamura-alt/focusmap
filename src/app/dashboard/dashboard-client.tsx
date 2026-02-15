"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { LeftSidebar } from "@/components/dashboard/left-sidebar"
import { CenterPane } from "@/components/dashboard/center-pane"
import { RightSidebar, RightSidebarRef } from "@/components/dashboard/right-sidebar"
import { Header } from "@/components/layout/header"
import { Database, Task, TaskGroup, Project, Space } from "@/types/database"
import { useMindMapSync } from "@/hooks/useMindMapSync"
import { TimerProvider } from "@/contexts/TimerContext"
import { DragProvider } from "@/contexts/DragContext"
import { CalendarToast } from "@/components/calendar/calendar-toast"
import { ChevronLeft, ChevronRight, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useView } from "@/contexts/ViewContext"
import { TodayView } from "@/components/today/today-view"

interface DashboardClientProps {
    initialSpaces: Space[]
    initialProjects: Project[]
    initialGroups: TaskGroup[]
    initialTasks: Task[]
    userId: string
}

export function DashboardClient({
    initialSpaces,
    initialProjects,
    initialGroups,
    initialTasks,
    userId
}: DashboardClientProps) {
    // State
    const [spaces, setSpaces] = useState<Space[]>(initialSpaces)
    const [projects, setProjects] = useState<Project[]>(initialProjects)

    // Selection State — null means "全体" (all spaces)
    const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
        initialSpaces.length > 0 ? initialSpaces[0].id : null
    )
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        initialProjects.length > 0 ? initialProjects[0].id : null
    )

    // STABLE reference for filtered projects using useMemo
    const filteredProjects = useMemo(() =>
        selectedSpaceId === null
            ? projects  // "全体" shows all projects
            : projects.filter(p => p.space_id === selectedSpaceId),
        [projects, selectedSpaceId]
    )

    // Auto-select first project when space changes (NOTE: deps are primitives only)
    useEffect(() => {
        const projectsInSpace = selectedSpaceId === null
            ? projects
            : projects.filter(p => p.space_id === selectedSpaceId)
        if (projectsInSpace.length > 0 && !projectsInSpace.find(p => p.id === selectedProjectId)) {
            setSelectedProjectId(projectsInSpace[0].id)
        } else if (projectsInSpace.length === 0) {
            setSelectedProjectId(null)
        }
    }, [selectedSpaceId]) // ONLY depends on selectedSpaceId, not objects

    const selectedProject = useMemo(() =>
        projects.find(p => p.id === selectedProjectId),
        [projects, selectedProjectId]
    )

    // --- MindMap Sync Hook ---
    // STABLE reference for initial groups using useMemo with string dep
    const projectGroupsInitial = useMemo(() =>
        initialGroups.filter(g => g.project_id === selectedProjectId),
        [initialGroups, selectedProjectId]
    )

    // STABLE reference for initial tasks - useMemo
    const projectTasksInitial = useMemo(() => {
        const groupIds = new Set(projectGroupsInitial.map(g => g.id))
        return initialTasks.filter(t => groupIds.has(t.group_id))
    }, [initialTasks, projectGroupsInitial])

    const {
        groups: currentGroups,
        tasks: currentTasks,
        createGroup,
        updateGroupTitle,
        updateGroup,
        deleteGroup,
        createTask,
        updateTask,
        deleteTask,
        moveTask,
        updateProjectTitle,
        bulkDelete,
        reorderTask,
        reorderGroup,
        promoteTaskToGroup,
        isLoading,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useMindMapSync({
        projectId: selectedProjectId,
        userId,
        initialGroups: projectGroupsInitial,
        initialTasks: projectTasksInitial
    })

    // STABLE handlers using useCallback
    const handleCreateGroup = useCallback(async (title: string) => {
        return await createGroup(title)
    }, [createGroup])

    const handleUpdateProjectTitle = useCallback(async (projectId: string, newTitle: string) => {
        // Optimistic update local state
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, title: newTitle } : p))

        // Persist to DB
        if (updateProjectTitle) {
            await updateProjectTitle(projectId, newTitle)
        }
    }, [updateProjectTitle])

    const handleUpdateGroupTitle = useCallback(async (groupId: string, newTitle: string) => {
        await updateGroupTitle(groupId, newTitle)
    }, [updateGroupTitle])

    const handleDeleteGroup = useCallback(async (groupId: string) => {
        await deleteGroup(groupId)
    }, [deleteGroup])

    const handleDeleteTask = useCallback(async (taskId: string) => {
        await deleteTask(taskId)
        // Refresh calendar to reflect the deletion
        await rightSidebarRef.current?.refreshCalendar()
    }, [deleteTask])

    // --- Project CRUD ---
    const handleCreateProject = useCallback(async (title: string, status: string = 'active', targetSpaceId?: string) => {
        const spaceId = targetSpaceId || selectedSpaceId || (spaces.length > 0 ? spaces[0].id : null)
        if (!spaceId) return null

        const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ space_id: spaceId, title, status }),
        })
        if (!res.ok) return null
        const newProject: Project = await res.json()
        setProjects(prev => [newProject, ...prev])
        setSelectedProjectId(newProject.id)
        return newProject
    }, [selectedSpaceId, spaces])

    const handleUpdateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
        // Optimistic update
        setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...updates } : p))
        await fetch(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
    }, [])

    const handleDeleteProject = useCallback(async (projectId: string) => {
        // Optimistic update
        setProjects(prev => prev.filter(p => p.id !== projectId))
        if (selectedProjectId === projectId) {
            const remaining = projects.filter(p => p.id !== projectId)
            setSelectedProjectId(remaining.length > 0 ? remaining[0].id : null)
        }
        await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
    }, [selectedProjectId, projects])

    // --- Space CRUD ---
    const handleCreateSpace = useCallback(async (title: string) => {
        const res = await fetch('/api/spaces', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        })
        if (!res.ok) return null
        const newSpace: Space = await res.json()
        setSpaces(prev => [newSpace, ...prev])
        setSelectedSpaceId(newSpace.id)
        return newSpace
    }, [])

    const handleUpdateSpace = useCallback(async (spaceId: string, updates: Partial<Space>) => {
        setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, ...updates } : s))
        await fetch(`/api/spaces/${spaceId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        })
    }, [])

    const handleDeleteSpace = useCallback(async (spaceId: string) => {
        setSpaces(prev => prev.filter(s => s.id !== spaceId))
        setProjects(prev => prev.filter(p => p.space_id !== spaceId))
        if (selectedSpaceId === spaceId) {
            setSelectedSpaceId(null)
        }
        await fetch(`/api/spaces/${spaceId}`, { method: 'DELETE' })
    }, [selectedSpaceId])

    // --- View State ---
    const { activeView } = useView()

    // Merge all tasks: current project (latest state) + other projects (initial state)
    const allTasksMerged = useMemo(() => {
        const currentMap = new Map(currentTasks.map(t => [t.id, t]))
        return initialTasks.map(t => currentMap.get(t.id) || t)
    }, [initialTasks, currentTasks])

    // --- Undo/Redo Keyboard Listener ---
    const [undoToast, setUndoToast] = useState<{ type: 'success' | 'info'; message: string } | null>(null)

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault()
                if (e.shiftKey) {
                    // Cmd+Shift+Z = Redo
                    redo().then(desc => {
                        if (desc) setUndoToast({ type: 'info', message: `やり直し: ${desc}` })
                    })
                } else {
                    // Cmd+Z = Undo
                    undo().then(desc => {
                        if (desc) setUndoToast({ type: 'success', message: `元に戻す: ${desc}` })
                    })
                }
            }
        }
        document.addEventListener('keydown', handler)
        return () => document.removeEventListener('keydown', handler)
    }, [undo, redo])

    // Sidebar State
    const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(320)
    const isDraggingRightRef = useRef(false)
    const dragStartXRef = useRef(0)
    const dragStartWidthRightRef = useRef(0)

    // RightSidebar ref for calendar refresh
    const rightSidebarRef = useRef<RightSidebarRef>(null)

    // Calendar refresh handler
    const handleRefreshCalendar = useCallback(async () => {
        await rightSidebarRef.current?.refreshCalendar()
    }, [])

    // Toggle left sidebar
    const toggleLeftSidebar = useCallback(() => {
        setIsLeftSidebarCollapsed(prev => !prev)
    }, [])

    // Handle right sidebar resize
    const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRightRef.current = true
        dragStartXRef.current = e.clientX
        dragStartWidthRightRef.current = rightSidebarWidth
        e.preventDefault()
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
    }, [rightSidebarWidth])

    // Touch event handler for right sidebar
    const handleRightTouchStart = useCallback((e: React.TouchEvent) => {
        isDraggingRightRef.current = true
        dragStartXRef.current = e.touches[0].clientX
        dragStartWidthRightRef.current = rightSidebarWidth
        e.preventDefault()
    }, [rightSidebarWidth])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingRightRef.current) {
                const delta = dragStartXRef.current - e.clientX
                const newWidth = Math.max(200, Math.min(600, dragStartWidthRightRef.current + delta))
                setRightSidebarWidth(newWidth)
            }
        }

        const handleTouchMove = (e: TouchEvent) => {
            if (isDraggingRightRef.current) {
                const delta = dragStartXRef.current - e.touches[0].clientX
                const newWidth = Math.max(200, Math.min(600, dragStartWidthRightRef.current + delta))
                setRightSidebarWidth(newWidth)
            }
        }

        const handleMouseUp = () => {
            isDraggingRightRef.current = false
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        document.addEventListener('touchmove', handleTouchMove, { passive: false })
        document.addEventListener('touchend', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
            document.removeEventListener('touchmove', handleTouchMove)
            document.removeEventListener('touchend', handleMouseUp)
        }
    }, [])

    return (
        <DragProvider>
            <TimerProvider tasks={allTasksMerged} onUpdateTask={updateTask}>
                {/* Header with Space Switcher */}
                <Header
                    spaces={spaces}
                    selectedSpaceId={selectedSpaceId}
                    onSelectSpace={setSelectedSpaceId}
                    onCreateSpace={handleCreateSpace}
                    onUpdateSpace={handleUpdateSpace}
                    onDeleteSpace={handleDeleteSpace}
                />

                {/* Undo/Redo Toast */}
                {undoToast && (
                    <CalendarToast
                        type={undoToast.type}
                        message={undoToast.message}
                        duration={2000}
                        onClose={() => setUndoToast(null)}
                    />
                )}
                {/* === Mobile: Today View === */}
                {activeView === 'today' && (
                    <div className="flex-1 md:hidden overflow-hidden">
                        <TodayView
                            allTasks={allTasksMerged}
                            allGroups={initialGroups}
                            onUpdateTask={updateTask}
                        />
                    </div>
                )}

                {/* === Mobile: Habits View (placeholder) === */}
                {activeView === 'habits' && (
                    <div className="flex-1 md:hidden overflow-hidden flex items-center justify-center">
                        <div className="text-center text-muted-foreground">
                            <Target className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">習慣ビューは準備中です</p>
                        </div>
                    </div>
                )}

                {/* === Desktop: Always 3-pane. Mobile: Only for map view === */}
                <div className={cn(
                    "flex-1 w-full relative gap-0 overflow-hidden",
                    "md:flex",
                    activeView === 'map' ? "flex" : "hidden"
                )}>
                {/* Toggle Button (Always visible on left top) */}
                <div className={cn(
                    "absolute top-4 z-50 hidden md:flex transition-all duration-300 ease-in-out",
                    isLeftSidebarCollapsed ? "left-4" : "left-[220px]"
                )}>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleLeftSidebar}
                        className="h-8 w-8 rounded-full bg-background border shadow-sm hover:bg-muted"
                    >
                        {isLeftSidebarCollapsed ? (
                            <ChevronRight className="h-4 w-4" />
                        ) : (
                            <ChevronLeft className="h-4 w-4" />
                        )}
                    </Button>
                </div>

                {/* Pane 1: Left Sidebar */}
                <div
                    className={cn(
                        "hidden md:flex flex-none overflow-hidden h-full transition-all duration-300 ease-in-out",
                        isLeftSidebarCollapsed ? "w-0 opacity-0" : "w-52 opacity-100"
                    )}
                    style={isLeftSidebarCollapsed ? {} : { minWidth: '13rem' }}
                >
                    <LeftSidebar
                        spaces={spaces}
                        selectedSpaceId={selectedSpaceId}
                        projects={filteredProjects}
                        selectedProjectId={selectedProjectId}
                        onSelectProject={setSelectedProjectId}
                        onCreateProject={handleCreateProject}
                        onUpdateProject={handleUpdateProject}
                        onDeleteProject={handleDeleteProject}
                    />
                </div>

                {/* Pane 2: Center (MindMap + Lists) */}
                <div className="flex-1 min-w-0 overflow-hidden h-full w-full" style={{ minWidth: 0 }}>
                    <CenterPane
                        project={selectedProject}
                        groups={currentGroups}
                        tasks={currentTasks}
                        onUpdateGroupTitle={handleUpdateGroupTitle}
                        onUpdateGroup={updateGroup}
                        onUpdateProject={handleUpdateProjectTitle}
                        onCreateGroup={handleCreateGroup}
                        onDeleteGroup={handleDeleteGroup}
                        onCreateTask={createTask}
                        onUpdateTask={updateTask}
                        onDeleteTask={handleDeleteTask}
                        onMoveTask={moveTask}
                        onBulkDelete={bulkDelete}
                        onReorderTask={reorderTask}
                        onReorderGroup={reorderGroup}
                        onPromoteTaskToGroup={promoteTaskToGroup}
                        onRefreshCalendar={handleRefreshCalendar}
                    />
                </div>

                {/* Right Resize Handle */}
                <div
                    className="w-1 h-full bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-none flex items-center justify-center group"
                    onMouseDown={handleRightMouseDown}
                    onTouchStart={handleRightTouchStart}
                >
                    <div className="w-0.5 h-8 bg-muted-foreground/20 group-hover:bg-primary rounded-full" />
                </div>

                {/* Pane 3: Right Sidebar (Calendar) */}
                <div
                    className="flex-none overflow-hidden h-full"
                    style={{ width: rightSidebarWidth }}
                >
                    <RightSidebar ref={rightSidebarRef} onUpdateTask={updateTask} />
                </div>
            </div>
            </TimerProvider>
        </DragProvider>
    )
}

