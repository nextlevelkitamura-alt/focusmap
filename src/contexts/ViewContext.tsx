"use client"

import React, { createContext, useContext, useState, useCallback, useEffect, startTransition } from 'react'

export type DashboardView = 'today' | 'map' | 'habits' | 'ai' | 'automation' | 'ideal' | 'long-term' | 'ai-todos'

const STORAGE_KEY = 'focusmap:activeView'
const VALID_VIEWS: DashboardView[] = ['today', 'map', 'habits', 'ai', 'automation', 'ideal', 'long-term', 'ai-todos']

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
            const requestedView = new URLSearchParams(window.location.search).get('view') as DashboardView | null
            if (requestedView && VALID_VIEWS.includes(requestedView)) {
                try { localStorage.setItem(STORAGE_KEY, requestedView) } catch {}
                setActiveViewState(requestedView)
                setIsViewReady(true)
                return
            }

            const saved = localStorage.getItem(STORAGE_KEY) as DashboardView | null
            if (saved && VALID_VIEWS.includes(saved)) {
                if (saved === 'automation') {
                    try { localStorage.setItem(STORAGE_KEY, 'ai') } catch {}
                    setActiveViewState('ai')
                } else {
                    setActiveViewState(saved)
                }
            }
            setIsViewReady(true)
        })
    }, [])

    const setActiveView = useCallback((view: DashboardView) => {
        try { localStorage.setItem(STORAGE_KEY, view) } catch {}
        startTransition(() => {
            setActiveViewState(view)
        })
    }, [])

    return (
        <ViewContext.Provider value={{ activeView, setActiveView, isViewReady }}>
            {children}
        </ViewContext.Provider>
    )
}
