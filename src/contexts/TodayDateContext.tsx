"use client"

import { createContext, useContext, useState, type Dispatch, type SetStateAction, type ReactNode } from "react"

interface TodayDateContextValue {
    selectedDate: Date
    setSelectedDate: Dispatch<SetStateAction<Date>>
}

const TodayDateContext = createContext<TodayDateContextValue | null>(null)

export function TodayDateProvider({ children }: { children: ReactNode }) {
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    return (
        <TodayDateContext.Provider value={{ selectedDate, setSelectedDate }}>
            {children}
        </TodayDateContext.Provider>
    )
}

/** Returns shared date context if inside a TodayDateProvider, otherwise null */
export function useTodayDateContext() {
    return useContext(TodayDateContext)
}
