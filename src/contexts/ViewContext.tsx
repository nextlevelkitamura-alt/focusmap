"use client"

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'

export type DashboardView = 'today' | 'map' | 'habits' | 'ai' | 'ideal' | 'long-term' | 'ai-todos' | 'settings'

const STORAGE_KEY = 'focusmap:activeView'
const VALID_VIEWS: DashboardView[] = ['today', 'map', 'habits', 'ai', 'ideal', 'long-term', 'ai-todos', 'settings']

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
        queueMicrotask(() => {
            const requestedView = new URLSearchParams(window.location.search).get('view')
            const normalizedView = requestedView === 'automation' ? 'ai' : requestedView
            if (normalizedView && VALID_VIEWS.includes(normalizedView as DashboardView)) {
                try { localStorage.setItem(STORAGE_KEY, normalizedView) } catch {}
                setActiveViewState(normalizedView as DashboardView)
                setIsViewReady(true)
                return
            }

            const saved = localStorage.getItem(STORAGE_KEY)
            const normalizedSaved = saved === 'automation' ? 'ai' : saved
            if (normalizedSaved && VALID_VIEWS.includes(normalizedSaved as DashboardView)) {
                if (saved === 'automation') try { localStorage.setItem(STORAGE_KEY, 'ai') } catch {}
                setActiveViewState(normalizedSaved as DashboardView)
            }
            setIsViewReady(true)
        })
    }, [])

    const setActiveView = useCallback((view: DashboardView) => {
        try { localStorage.setItem(STORAGE_KEY, view) } catch {}
        setActiveViewState(view)
    }, [])

    return (
        <ViewContext.Provider value={{ activeView, setActiveView, isViewReady }}>
            {children}
        </ViewContext.Provider>
    )
}
