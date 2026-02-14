"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { LeftSidebar } from "@/components/dashboard/left-sidebar"
import { CenterPane } from "@/components/dashboard/center-pane"
import { RightSidebar, RightSidebarRef } from "@/components/dashboard/right-sidebar"
import { Database, Task, TaskGroup, Project } from "@/types/database"
import { useMindMapSync } from "@/hooks/useMindMapSync"
import { TimerProvider } from "@/contexts/TimerContext"
import { DragProvider } from "@/contexts/DragContext"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Goal = Database['public']['Tables']['goals']['Row']

interface DashboardClientProps {
    initialGoals: Goal[]
    initialProjects: Project[]
    initialGroups: TaskGroup[]
    initialTasks: Task[]
    userId: string
}

export function DashboardClient({
    initialGoals,
    initialProjects,
    initialGroups,
    initialTasks,
    userId
}: DashboardClientProps) {
    // State
    const [goals] = useState<Goal[]>(initialGoals)
    const [projects, setProjects] = useState<Project[]>(initialProjects)

    // Selection State
    const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
        initialGoals.length > 0 ? initialGoals[0].id : null
    )
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        initialProjects.length > 0 ? initialProjects[0].id : null
    )

    // STABLE reference for filtered projects using useMemo
    const filteredProjects = useMemo(() =>
        projects.filter(p => p.goal_id === selectedGoalId),
        [projects, selectedGoalId]
    )

    // Auto-select first project when goal changes (NOTE: deps are primitives only)
    useEffect(() => {
        if (selectedGoalId) {
            const projectsInGoal = projects.filter(p => p.goal_id === selectedGoalId)
            if (projectsInGoal.length > 0 && !projectsInGoal.find(p => p.id === selectedProjectId)) {
                setSelectedProjectId(projectsInGoal[0].id)
            } else if (projectsInGoal.length === 0) {
                setSelectedProjectId(null)
            }
        }
    }, [selectedGoalId]) // ONLY depends on selectedGoalId, not objects

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
        isLoading
    } = useMindMapSync({
        projectId: selectedProjectId,
        userId,
        initialGroups: projectGroupsInitial,
        initialTasks: projectTasksInitial
    })

    // STABLE handlers using useCallback
    const handleCreateGroup = useCallback(async (title: string) => {
        await createGroup(title)
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

    // Sidebar State
    const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(360)
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
            <TimerProvider tasks={currentTasks} onUpdateTask={updateTask}>
                <div className="flex h-full w-full relative gap-0">
                {/* Toggle Button (Always visible on left top) */}
                <div className={cn(
                    "absolute top-4 z-50 hidden md:flex transition-all duration-300 ease-in-out",
                    isLeftSidebarCollapsed ? "left-4" : "left-[272px]"
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
                        isLeftSidebarCollapsed ? "w-0 opacity-0" : "w-64 opacity-100"
                    )}
                    style={isLeftSidebarCollapsed ? {} : { minWidth: '16rem' }}
                >
                    <LeftSidebar
                        goals={goals}
                        selectedGoalId={selectedGoalId}
                        onSelectGoal={setSelectedGoalId}
                        projects={filteredProjects}
                        selectedProjectId={selectedProjectId}
                        onSelectProject={setSelectedProjectId}
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
                        onRefreshCalendar={handleRefreshCalendar}
                    />
                </div>

                {/* Right Resize Handle */}
                <div
                    className="hidden lg:flex w-1 h-full bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-none items-center justify-center group"
                    onMouseDown={handleRightMouseDown}
                    onTouchStart={handleRightTouchStart}
                >
                    <div className="w-0.5 h-8 bg-muted-foreground/20 group-hover:bg-primary rounded-full" />
                </div>

                {/* Pane 3: Right Sidebar (Calendar) */}
                <div
                    className="hidden lg:block flex-none overflow-hidden h-full"
                    style={{ width: rightSidebarWidth }}
                >
                    <RightSidebar ref={rightSidebarRef} onUpdateTask={updateTask} />
                </div>
            </div>
            </TimerProvider>
        </DragProvider>
    )
}

