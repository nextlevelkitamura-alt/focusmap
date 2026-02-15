"use client"

import { useCallback, useRef } from 'react'

const MAX_STACK_SIZE = 50

export interface UndoableAction {
    description: string
    undo: () => Promise<void>
    redo: () => Promise<void>
}

export interface UseUndoRedoReturn {
    pushAction: (action: UndoableAction) => void
    undo: () => Promise<string | null>
    redo: () => Promise<string | null>
    canUndo: () => boolean
    canRedo: () => boolean
    clear: () => void
}

export function useUndoRedo(): UseUndoRedoReturn {
    const undoStackRef = useRef<UndoableAction[]>([])
    const redoStackRef = useRef<UndoableAction[]>([])
    const isUndoRedoingRef = useRef(false)

    const pushAction = useCallback((action: UndoableAction) => {
        // undo/redo実行中に発生した操作は記録しない（再帰防止）
        if (isUndoRedoingRef.current) return

        undoStackRef.current.push(action)
        // スタック上限を超えたら古いものを削除
        if (undoStackRef.current.length > MAX_STACK_SIZE) {
            undoStackRef.current.shift()
        }
        // 新しいアクション実行時はredoスタックをクリア
        redoStackRef.current = []
    }, [])

    const undo = useCallback(async (): Promise<string | null> => {
        const action = undoStackRef.current.pop()
        if (!action) return null

        isUndoRedoingRef.current = true
        try {
            await action.undo()
            redoStackRef.current.push(action)
            return action.description
        } catch (e) {
            console.error('[UndoRedo] undo failed:', e)
            return null
        } finally {
            isUndoRedoingRef.current = false
        }
    }, [])

    const redo = useCallback(async (): Promise<string | null> => {
        const action = redoStackRef.current.pop()
        if (!action) return null

        isUndoRedoingRef.current = true
        try {
            await action.redo()
            undoStackRef.current.push(action)
            return action.description
        } catch (e) {
            console.error('[UndoRedo] redo failed:', e)
            return null
        } finally {
            isUndoRedoingRef.current = false
        }
    }, [])

    const canUndo = useCallback(() => undoStackRef.current.length > 0, [])
    const canRedo = useCallback(() => redoStackRef.current.length > 0, [])

    const clear = useCallback(() => {
        undoStackRef.current = []
        redoStackRef.current = []
    }, [])

    return { pushAction, undo, redo, canUndo, canRedo, clear }
}
