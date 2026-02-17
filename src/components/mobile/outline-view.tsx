"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import { Task, Project, Space } from "@/types/database"
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight"
import { useOutlineNavigation } from "@/hooks/useOutlineNavigation"
import { OutlineItem } from "./outline-item"
import { KeyboardAccessoryBar } from "./keyboard-accessory-bar"
import { MobileProjectSelector } from "./mobile-project-selector"
import { Plus } from "lucide-react"

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
}: OutlineViewProps) {
    const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null)
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
    const [newlyCreatedId, setNewlyCreatedId] = useState<string | null>(null)

    const { keyboardHeight, isKeyboardOpen } = useKeyboardHeight()

    // input ref map (taskId -> HTMLInputElement)
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

    // 折りたたみトグル
    const toggleCollapse = useCallback((taskId: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev)
            if (next.has(taskId)) {
                next.delete(taskId)
            } else {
                next.add(taskId)
            }
            return next
        })
    }, [])

    // タイトル変更
    const handleTitleChange = useCallback((taskId: string, newTitle: string) => {
        const task = [...groups, ...tasks].find(t => t.id === taskId)
        if (!task) return

        if (!task.parent_task_id) {
            // ルートグループ
            onUpdateGroupTitle(taskId, newTitle)
        } else {
            onUpdateTask(taskId, { title: newTitle })
        }
    }, [groups, tasks, onUpdateGroupTitle, onUpdateTask])

    // ステータストグル
    const handleToggleStatus = useCallback((taskId: string) => {
        const task = tasks.find(t => t.id === taskId)
        if (!task) return
        onUpdateTask(taskId, { status: task.status === 'done' ? 'todo' : 'done' })
    }, [tasks, onUpdateTask])

    // キー入力ハンドラ
    const handleKeyDown = useCallback(async (taskId: string, e: React.KeyboardEvent<HTMLInputElement>) => {
        // IME入力中は無視
        if (e.nativeEvent.isComposing) return

        if (e.key === 'Enter') {
            e.preventDefault()
            // 現在のタイトルを保存
            const input = inputRefs.current.get(taskId)
            if (input) {
                const task = [...groups, ...tasks].find(t => t.id === taskId)
                if (task && input.value !== task.title) {
                    handleTitleChange(taskId, input.value)
                }
            }
            // 兄弟タスク追加
            const newId = await handleEnter()
            if (newId) {
                setNewlyCreatedId(newId)
                setFocusedTaskId(newId)
                // 折りたたまれている親を展開
                const task = [...groups, ...tasks].find(t => t.id === taskId)
                if (task?.parent_task_id && collapsedIds.has(task.parent_task_id)) {
                    setCollapsedIds(prev => {
                        const next = new Set(prev)
                        next.delete(task.parent_task_id!)
                        return next
                    })
                }
            }
        }

        if (e.key === 'Backspace' && e.currentTarget.value === '') {
            e.preventDefault()
            // 空タイトルのタスクは削除
            await handleDelete()
        }
    }, [groups, tasks, collapsedIds, handleEnter, handleDelete, handleTitleChange])

    // キーボードアクセサリバーのハンドラ
    const handleAccessoryIndent = useCallback(async () => {
        await handleIndent()
    }, [handleIndent])

    const handleAccessoryOutdent = useCallback(async () => {
        await handleOutdent()
    }, [handleOutdent])

    const handleAccessoryAddChild = useCallback(async () => {
        const newId = await handleAddChild()
        if (newId) {
            setNewlyCreatedId(newId)
            setFocusedTaskId(newId)
            // 親ノードの折りたたみを解除
            if (focusedTaskId && collapsedIds.has(focusedTaskId)) {
                setCollapsedIds(prev => {
                    const next = new Set(prev)
                    next.delete(focusedTaskId!)
                    return next
                })
            }
        }
    }, [handleAddChild, focusedTaskId, collapsedIds])

    const handleAccessoryDelete = useCallback(async () => {
        // 削除前に次のフォーカス先を決定
        const currentIndex = flatItems.findIndex(item => item.task.id === focusedTaskId)
        const nextFocusId = currentIndex > 0
            ? flatItems[currentIndex - 1]?.task.id
            : flatItems[currentIndex + 1]?.task.id ?? null

        await handleDelete()

        if (nextFocusId) {
            setFocusedTaskId(nextFocusId)
            setTimeout(() => {
                inputRefs.current.get(nextFocusId)?.focus()
            }, 50)
        }
    }, [flatItems, focusedTaskId, handleDelete])

    const handleDismissKeyboard = useCallback(() => {
        // すべてのinputからblur
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
        }
        setFocusedTaskId(null)
    }, [])

    // グループ追加（ハンバーガーメニューから）
    const handleCreateGroupFromMenu = useCallback(async () => {
        const newGroup = await onCreateGroup('新しいグループ')
        if (newGroup) {
            setNewlyCreatedId(newGroup.id)
            setFocusedTaskId(newGroup.id)
        }
    }, [onCreateGroup])

    // 空の状態のFAB
    const handleFabCreateGroup = useCallback(async () => {
        const newGroup = await onCreateGroup('')
        if (newGroup) {
            setNewlyCreatedId(newGroup.id)
            setFocusedTaskId(newGroup.id)
        }
    }, [onCreateGroup])

    // ref callback
    const setInputRef = useCallback((taskId: string) => {
        return (el: HTMLInputElement | null) => {
            if (el) {
                inputRefs.current.set(taskId, el)
            } else {
                inputRefs.current.delete(taskId)
            }
        }
    }, [])

    // ボトムナビとキーボードのためのパディング計算
    const bottomPadding = isKeyboardOpen
        ? keyboardHeight + 48 // キーボード + アクセサリバー分
        : 80 // ボトムナビ分 (64px + 余白)

    return (
        <div className="flex flex-col h-full bg-background">
            {/* プロジェクトセレクタ */}
            <MobileProjectSelector
                project={project}
                projects={projects}
                spaces={spaces}
                selectedSpaceId={selectedSpaceId}
                onSelectProject={onSelectProject}
                onCreateGroup={handleCreateGroupFromMenu}
            />

            {/* アウトラインリスト */}
            <div
                className="flex-1 overflow-y-auto"
                style={{ paddingBottom: `${bottomPadding}px` }}
            >
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

                        {/* リスト末尾の追加ボタン */}
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

            {/* キーボードアクセサリバー */}
            {isKeyboardOpen && (
                <KeyboardAccessoryBar
                    keyboardHeight={keyboardHeight}
                    canIndent={canIndent}
                    canOutdent={canOutdent}
                    onIndent={handleAccessoryIndent}
                    onOutdent={handleAccessoryOutdent}
                    onAddChild={handleAccessoryAddChild}
                    onDelete={handleAccessoryDelete}
                    onDismiss={handleDismissKeyboard}
                />
            )}
        </div>
    )
}
