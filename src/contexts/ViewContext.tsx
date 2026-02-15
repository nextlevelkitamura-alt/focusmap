"use client"

import React, { createContext, useContext, useState } from 'react'

export type DashboardView = 'today' | 'map' | 'habits'

interface ViewContextType {
    activeView: DashboardView
    setActiveView: (view: DashboardView) => void
}

const ViewContext = createContext<ViewContextType>({
    activeView: 'today',
    setActiveView: () => {},
})

export const useView = () => useContext(ViewContext)

export function ViewProvider({ children }: { children: React.ReactNode }) {
    const [activeView, setActiveView] = useState<DashboardView>('today')
    return (
        <ViewContext.Provider value={{ activeView, setActiveView }}>
            {children}
        </ViewContext.Provider>
    )
}
