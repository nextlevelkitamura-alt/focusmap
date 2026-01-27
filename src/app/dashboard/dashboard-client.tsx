"use client"

import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { LeftSidebar } from "@/components/dashboard/left-sidebar"
import { CenterPane } from "@/components/dashboard/center-pane"
import { RightSidebar } from "@/components/dashboard/right-sidebar"
import { Database } from "@/types/database"
import { useMindMapSync } from "@/hooks/useMindMapSync"
import { TimerProvider } from "@/contexts/TimerContext"
import { DragProvider } from "@/contexts/DragContext"
type Goal = Database['public']['Tables']['goals']['Row']
type Project = Database['public']['Tables']['projects']['Row']
type TaskGroup = Database['public']['Tables']['task_groups']['Row']
type Task = Database['public']['Tables']['tasks']['Row']

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

    // Resizable Sidebar State
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(280)
    const [rightSidebarWidth, setRightSidebarWidth] = useState(300)
    const isDraggingLeftRef = useRef(false)
    const isDraggingRightRef = useRef(false)

    // Handle sidebar resize
    const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingLeftRef.current = true
        e.preventDefault()
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
    }, [])

    const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
        isDraggingRightRef.current = true
        e.preventDefault()
        document.body.style.userSelect = 'none'
        document.body.style.cursor = 'col-resize'
    }, [])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDraggingLeftRef.current) {
                const newWidth = Math.max(200, Math.min(450, e.clientX))
                setLeftSidebarWidth(newWidth)
            }
            if (isDraggingRightRef.current) {
                const newWidth = Math.max(200, Math.min(500, window.innerWidth - e.clientX))
                setRightSidebarWidth(newWidth)
            }
        }

        const handleMouseUp = () => {
            isDraggingLeftRef.current = false
            isDraggingRightRef.current = false
            document.body.style.userSelect = ''
            document.body.style.cursor = ''
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)
        return () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }
    }, [])

    return (
        <DragProvider>
            <TimerProvider tasks={currentTasks} onUpdateTask={updateTask}>
                <div className="flex h-full w-full">
                {/* Pane 1: Left Sidebar */}
                <div
                    className="hidden md:flex flex-none overflow-hidden h-full"
                    style={{ width: leftSidebarWidth }}
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

                {/* Left Resize Handle */}
                <div
                    className="hidden md:flex w-1 h-full bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-none items-center justify-center group"
                    onMouseDown={handleLeftMouseDown}
                >
                    <div className="w-0.5 h-8 bg-muted-foreground/20 group-hover:bg-primary rounded-full" />
                </div>

                {/* Pane 2: Center (MindMap + Lists) */}
                <div className="flex-1 min-w-0 overflow-hidden h-full">
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
                        onDeleteTask={deleteTask}
                        onMoveTask={moveTask}
                    />
                </div>

                {/* Right Resize Handle */}
                <div
                    className="hidden lg:flex w-1 h-full bg-border hover:bg-primary/50 cursor-col-resize transition-colors flex-none items-center justify-center group"
                    onMouseDown={handleRightMouseDown}
                >
                    <div className="w-0.5 h-8 bg-muted-foreground/20 group-hover:bg-primary rounded-full" />
                </div>

                {/* Pane 3: Right Sidebar (Calendar) */}
                <div
                    className="hidden lg:block flex-none overflow-hidden h-full"
                    style={{ width: rightSidebarWidth }}
                >
                    <RightSidebar />
                </div>
            </div>
            </TimerProvider>
        </DragProvider>
    )
}

