"use client"

import { useState, useCallback, useRef } from "react"
import { Task, Project, Space } from "@/types/database"
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight"
import { useOutlineNavigation } from "@/hooks/useOutlineNavigation"
import { OutlineItem } from "./outline-item"
import { KeyboardAccessoryBar } from "./keyboard-accessory-bar"
import { MobileProjectSelector } from "./mobile-project-selector"
import { MobileMindMap } from "./mobile-mind-map"
import { Plus, List, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"

type MobileMapTab = 'outline' | 'mindmap'

interface OutlineViewProps {
    project?: Project
    groups: Task[]
    tasks: Task[]
    spaces: Space[]
    projects: Project[]
    selectedProjectId: string | null
    selectedSpaceId: string | null
    onSelectProject: (id: string) => void
    onCreateGroup: (title: string) => Promise<Task | null>
    onCreateTask: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask: (taskId: string) => Promise<void>
    onDeleteGroup: (groupId: string) => Promise<void>
    onMoveTask: (taskId: string, newGroupId: string) => Promise<void>
    onReorderTask: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
    onUpdateGroupTitle: (groupId: string, title: string) => Promise<void>
    onUpdateGroup: (groupId: string, updates: Partial<Task>) => Promise<void>
    onUpdateProject?: (projectId: string, title: string) => Promise<void>
    onCreateProject?: (title: string) => Promise<Project | null>
}

export function OutlineView({
    project,
    groups,
    tasks,
    spaces,
    projects,
    selectedProjectId,
    selectedSpaceId,
    onSelectProject,
    onCreateGroup,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
    onDeleteGroup,
    onMoveTask,
    onReorderTask,
    onUpdateGroupTitle,
    onUpdateGroup,
    onUpdateProject,
    onCreateProject,
}: OutlineViewProps) {
    const [activeTab, setActiveTab] = useState<MobileMapTab>('mindmap')

    return (
        <div className="flex flex-col h-full bg-background">
            {/* プロジェクトセレクタ + タブ切替 */}
            <div className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
                <MobileProjectSelector
                    project={project}
                    projects={projects}
                    spaces={spaces}
                    selectedSpaceId={selectedSpaceId}
                    onSelectProject={onSelectProject}
                    onCreateProject={onCreateProject}
                    onCreateGroup={async () => {
                        const g = await onCreateGroup('新しいグループ')
                        return undefined
                    }}
                />

                {/* タブバー */}
                <div className="flex px-3 gap-1 pb-2">
                    <button
                        onClick={() => setActiveTab('mindmap')}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                            activeTab === 'mindmap'
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground active:bg-muted"
                        )}
                    >
                        <GitBranch className="w-3.5 h-3.5" />
                        マインドマップ
                    </button>
                    <button
                        onClick={() => setActiveTab('outline')}
                        className={cn(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                            activeTab === 'outline'
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground active:bg-muted"
                        )}
                    >
                        <List className="w-3.5 h-3.5" />
                        アウトライン
                    </button>
                </div>
            </div>

            {/* コンテンツ */}
            {activeTab === 'outline' ? (
                <OutlineContent
                    project={project}
                    groups={groups}
                    tasks={tasks}
                    onCreateGroup={onCreateGroup}
                    onCreateTask={onCreateTask}
                    onUpdateTask={onUpdateTask}
                    onDeleteTask={onDeleteTask}
                    onDeleteGroup={onDeleteGroup}
                    onMoveTask={onMoveTask}
                    onReorderTask={onReorderTask}
                    onUpdateGroupTitle={onUpdateGroupTitle}
                />
            ) : (
                <div className="flex-1 overflow-hidden" style={{ paddingBottom: '64px' }}>
                    {project ? (
                        <MobileMindMap
                            project={project}
                            groups={groups}
                            tasks={tasks}
                            onCreateGroup={onCreateGroup}
                            onDeleteGroup={onDeleteGroup}
                            onUpdateProject={onUpdateProject}
                            onCreateTask={onCreateTask}
                            onUpdateTask={onUpdateTask}
                            onDeleteTask={onDeleteTask}
                            onReorderTask={onReorderTask}
                        />
                    ) : (
                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                            プロジェクトを選択してください
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// --- Outline Content (extracted from original OutlineView) ---
function OutlineContent({
    project,
    groups,
    tasks,
    onCreateGroup,
    onCreateTask,
    onUpdateTask,
    onDeleteTask,
    onDeleteGroup,
    onMoveTask,
    onReorderTask,
    onUpdateGroupTitle,
}: {
    project?: Project
    groups: Task[]
    tasks: Task[]
    onCreateGroup: (title: string) => Promise<Task | null>
    onCreateTask: (groupId: string, title?: string, parentTaskId?: string | null) => Promise<Task | null>
    onUpdateTask: (taskId: string, updates: Partial<Task>) => Promise<void>
    onDeleteTask: (taskId: string) => Promise<void>
    onDeleteGroup: (groupId: string) => Promise<void>
    onMoveTask: (taskId: string, newGroupId: string) => Promise<void>
    onReorderTask: (taskId: string, referenceTaskId: string, position: 'above' | 'below') => Promise<void>
    onUpdateGroupTitle: (groupId: string, title: string) => Promise<void>
}) {
    const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
    const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null)

    const { keyboardHeight, isKeyboardOpen } = useKeyboardHeight()
    const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

    const {
        flatItems,
        handleEnter,
        handleIndent,
        handleOutdent,
        handleDelete,
        handleAddChild,
        canIndent,
        canOutdent,
    } = useOutlineNavigation({
        groups,
        tasks,
        collapsedIds,
        focusedTaskId,
        onCreateGroup,
        onCreateTask,
        onUpdateTask,
        onDeleteTask,
        onDeleteGroup,
        onMoveTask,
        onReorderTask,
    })

    const toggleCollapse = useCallback((taskId: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(taskId)) next.delete(taskId); else next.add(taskId)
            return next
        })
    }, [])

    const handleTitleChange = useCallback((taskId: string, newTitle: string) => {
        const task = [...groups, ...tasks].find(t => t.id === taskId)
        if (!task) return
        if (!task.parent_task_id) onUpdateGroupTitle(taskId, newTitle)
        else onUpdateTask(taskId, { title: newTitle })
    }, [groups, tasks, onUpdateGroupTitle, onUpdateTask])

    const handleToggleStatus = useCallback((taskId: string) => {
        const task = tasks.find(t => t.id === taskId)
        if (!task) return
        onUpdateTask(taskId, { status: task.status === 'done' ? 'todo' : 'done' })
    }, [tasks, onUpdateTask])

    const handleKeyDown = useCallback(async (taskId: string, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Enter') {
            e.preventDefault()
            const input = inputRefs.current.get(taskId)
            if (input) {
                const task = [...groups, ...tasks].find(t => t.id === taskId)
                if (task && input.value !== task.title) handleTitleChange(taskId, input.value)
            }
            const newId = await handleEnter()
            if (newId) {
                setNewlyCreatedId(newId)
                setFocusedTaskId(newId)
            }
        }
        if (e.key === 'Backspace' && e.currentTarget.value === '') {
            e.preventDefault()
            await handleDelete()
        }
    }, [groups, tasks, handleEnter, handleDelete, handleTitleChange])

    const handleAccessoryAddChild = useCallback(async () => {
        const newId = await handleAddChild()
        if (newId) {
            setNewlyCreatedId(newId)
            setFocusedTaskId(newId)
            if (focusedTaskId && collapsedIds.has(focusedTaskId)) {
                setCollapsedIds(prev => { const n = new Set(prev); n.delete(focusedTaskId!); return n })
            }
        }
    }, [handleAddChild, focusedTaskId, collapsedIds])

    const handleAccessoryDelete = useCallback(async () => {
        const currentIndex = flatItems.findIndex(item => item.task.id === focusedTaskId)
        const nextFocusId = currentIndex > 0
            ? flatItems[currentIndex - 1]?.task.id
            : flatItems[currentIndex + 1]?.task.id ?? null
        await handleDelete()
        if (nextFocusId) {
            setFocusedTaskId(nextFocusId)
            setTimeout(() => inputRefs.current.get(nextFocusId)?.focus(), 50)
        }
    }, [flatItems, focusedTaskId, handleDelete])

    const handleDismissKeyboard = useCallback(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
        setFocusedTaskId(null)
    }, [])

    const handleFabCreateGroup = useCallback(async () => {
        const newGroup = await onCreateGroup('')
        if (newGroup) {
            setNewlyCreatedId(newGroup.id)
            setFocusedTaskId(newGroup.id)
        }
    }, [onCreateGroup])

    const setInputRef = useCallback((taskId: string) => {
        return (el: HTMLInputElement | null) => {
            if (el) inputRefs.current.set(taskId, el)
            else inputRefs.current.delete(taskId)
        }
    }, [])

    const bottomPadding = isKeyboardOpen ? keyboardHeight + 48 : 80

    return (
        <>
            <div className="flex-1 overflow-y-auto" style={{ paddingBottom: `${bottomPadding}px` }}>
                {flatItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4 py-20">
                        <p className="text-sm">マインドマップが空です</p>
                        <button
                            onClick={handleFabCreateGroup}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium active:opacity-80 transition-opacity"
                        >
                            <Plus className="w-4 h-4" />
                            最初のグループを作成
                        </button>
                    </div>
                ) : (
                    <>
                        {flatItems.map(item => (
                            <OutlineItem
                                key={item.task.id}
                                task={item.task}
                                depth={item.depth}
                                isFocused={focusedTaskId === item.task.id}
                                isCollapsed={collapsedIds.has(item.task.id)}
                                hasChildren={item.hasChildren}
                                isNewlyCreated={newlyCreatedId === item.task.id}
                                onToggleCollapse={() => toggleCollapse(item.task.id)}
                                onFocus={setFocusedTaskId}
                                onTitleChange={handleTitleChange}
                                onKeyDown={handleKeyDown}
                                onToggleStatus={handleToggleStatus}
                                inputRef={setInputRef(item.task.id)}
                            />
                        ))}
                        <button
                            onClick={handleFabCreateGroup}
                            className="flex items-center gap-2 px-4 py-3 w-full text-muted-foreground text-sm active:bg-muted/30 transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            グループ追加
                        </button>
                    </>
                )}
            </div>

            {isKeyboardOpen && (
                <KeyboardAccessoryBar
                    keyboardHeight={keyboardHeight}
                    canIndent={canIndent}
                    canOutdent={canOutdent}
                    onIndent={handleIndent}
                    onOutdent={handleOutdent}
                    onAddChild={handleAccessoryAddChild}
                    onDelete={handleAccessoryDelete}
                    onDismiss={handleDismissKeyboard}
                />
            )}
        </>
    )
}
