"use client"

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

export type DashboardView = 'today' | 'map' | 'habits' | 'ai' | 'ideal' | 'ai-todos'

const STORAGE_KEY = 'focusmap:activeView'

interface ViewContextType {
    activeView: DashboardView
    setActiveView: (view: DashboardView) => void
    isViewReady: boolean
}

const ViewContext = createContext<ViewContextType>({
    activeView: 'map',
    setActiveView: () => {},
    isViewReady: false,
})

export const useView = () => useContext(ViewContext)

export function ViewProvider({ children }: { children: React.ReactNode }) {
    // Use consistent default for SSR and client initial render to avoid hydration mismatch
    const [activeView, setActiveViewState] = useState<DashboardView>('today')
    const [isViewReady, setIsViewReady] = useState(false)

    // Read localStorage after mount (client-only)
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY) as DashboardView | null
        if (saved && ['today', 'map', 'habits', 'ai', 'ideal', 'ai-todos'].includes(saved)) {
            setActiveViewState(saved)
        }
        setIsViewReady(true)
    }, [])

    const setActiveView = useCallback((view: DashboardView) => {
        setActiveViewState(view)
        try { localStorage.setItem(STORAGE_KEY, view) } catch {}
    }, [])

    return (
        <ViewContext.Provider value={{ activeView, setActiveView, isViewReady }}>
            {children}
        </ViewContext.Provider>
    )
}
