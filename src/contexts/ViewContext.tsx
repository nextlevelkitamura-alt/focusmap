"use client"

import React, { createContext, useContext, useState } from 'react'

export type DashboardView = 'today' | 'map' | 'habits'

interface ViewContextType {
    activeView: DashboardView
    setActiveView: (view: DashboardView) => void
}

const ViewContext = createContext<ViewContextType>({
    activeView: 'map',
    setActiveView: () => {},
})

export const useView = () => useContext(ViewContext)

export function ViewProvider({ children }: { children: React.ReactNode }) {
    // Mobile defaults to 'today', desktop defaults to 'map'
    const [activeView, setActiveView] = useState<DashboardView>(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 768) return 'today'
        return 'map'
    })
    return (
        <ViewContext.Provider value={{ activeView, setActiveView }}>
            {children}
        </ViewContext.Provider>
    )
}
