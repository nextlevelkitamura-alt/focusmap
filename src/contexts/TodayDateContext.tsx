"use client"

import { createContext, useContext, useState, type Dispatch, type SetStateAction, type ReactNode } from "react"

interface TodayDateContextValue {
    selectedDate: Date
    setSelectedDate: Dispatch<SetStateAction<Date>>
}

const TodayDateContext = createContext<TodayDateContextValue | null>(null)

export function TodayDateProvider({
    children,
    selectedDate: controlledSelectedDate,
    setSelectedDate: controlledSetSelectedDate,
}: {
    children: ReactNode
    selectedDate?: Date
    setSelectedDate?: Dispatch<SetStateAction<Date>>
}) {
    const [internalSelectedDate, internalSetSelectedDate] = useState<Date>(() => {
        const d = new Date(); d.setHours(0, 0, 0, 0); return d
    })
    const selectedDate = controlledSelectedDate ?? internalSelectedDate
    const setSelectedDate = controlledSetSelectedDate ?? internalSetSelectedDate

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
