"use client"

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'

interface DragState {
    isDragging: boolean
    draggedTaskId: string | null
    draggedTaskTitle: string | null
}

interface DragContextType {
    dragState: DragState
    startDrag: (taskId: string, title: string) => void
    endDrag: () => void
}

const DragContext = createContext<DragContextType | null>(null)

interface DragProviderProps {
    children: ReactNode
}

export function DragProvider({ children }: DragProviderProps) {
    const [dragState, setDragState] = useState<DragState>({
        isDragging: false,
        draggedTaskId: null,
        draggedTaskTitle: null
    })

    const startDrag = useCallback((taskId: string, title: string) => {
        setDragState({
            isDragging: true,
            draggedTaskId: taskId,
            draggedTaskTitle: title
        })
    }, [])

    const endDrag = useCallback(() => {
        setDragState({
            isDragging: false,
            draggedTaskId: null,
            draggedTaskTitle: null
        })
    }, [])

    return (
        <DragContext.Provider value={{ dragState, startDrag, endDrag }}>
            {children}
        </DragContext.Provider>
    )
}

export function useDrag() {
    const context = useContext(DragContext)
    if (!context) {
        throw new Error('useDrag must be used within DragProvider')
    }
    return context
}
