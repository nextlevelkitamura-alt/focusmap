"use client"

import { useEffect, useMemo, useState } from "react"
import type { CSSProperties } from "react"
import { CalendarDays, Network } from "lucide-react"

type CachedCalendarEvent = {
    id?: string
    title?: string
    start_time?: string
    end_time?: string
    color?: string | null
    background_color?: string | null
}

type StartupSnapshot = {
    activeView: "today" | "map"
    events: CachedCalendarEvent[]
}

const CALENDAR_CACHE_PREFIX = "focusmap:calendar-events:"
const MINDMAP_SKELETON_DEPTHS = [0, 1, 2, 1, 2]

function readJson<T>(raw: string | null): T | null {
    if (!raw) return null
    try {
        return JSON.parse(raw) as T
    } catch {
        return null
    }
}

function readCalendarEvents(): CachedCalendarEvent[] {
    const stores = [window.localStorage, window.sessionStorage]
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(today.getDate() + 1)

    const candidates: Array<{ events: CachedCalendarEvent[]; syncedAt: number }> = []

    for (const storage of stores) {
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i)
            if (!key?.startsWith(CALENDAR_CACHE_PREFIX)) continue
            const parsed = readJson<{ events?: CachedCalendarEvent[]; syncedAt?: string }>(storage.getItem(key))
            if (!Array.isArray(parsed?.events)) continue
            const syncedAt = parsed.syncedAt ? new Date(parsed.syncedAt).getTime() : 0
            candidates.push({ events: parsed.events, syncedAt: Number.isFinite(syncedAt) ? syncedAt : 0 })
        }
    }

    return candidates
        .sort((a, b) => b.syncedAt - a.syncedAt)
        .flatMap(candidate => candidate.events)
        .filter(event => {
            const start = event.start_time ? new Date(event.start_time).getTime() : NaN
            return Number.isFinite(start) && start >= today.getTime() && start < tomorrow.getTime()
        })
        .sort((a, b) => new Date(a.start_time ?? 0).getTime() - new Date(b.start_time ?? 0).getTime())
        .slice(0, 8)
}

function createStartupSnapshot(): StartupSnapshot {
    if (typeof window === "undefined") {
        return {
            activeView: "today",
            events: [],
        }
    }

    const savedView = window.localStorage.getItem("focusmap:activeView")
    return {
        activeView: savedView === "map" ? "map" : "today",
        events: readCalendarEvents(),
    }
}

function formatDateLabel() {
    return new Intl.DateTimeFormat("ja-JP", {
        month: "long",
        day: "numeric",
        weekday: "short",
    }).format(new Date())
}

function formatTime(value?: string) {
    if (!value) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    return new Intl.DateTimeFormat("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(date)
}

function useStartupSnapshot(): StartupSnapshot {
    const [snapshot, setSnapshot] = useState<StartupSnapshot>(() => createStartupSnapshot())

    useEffect(() => {
        const handle = window.setTimeout(() => {
            setSnapshot(createStartupSnapshot())
        }, 0)
        return () => window.clearTimeout(handle)
    }, [])

    return snapshot
}

export function DashboardStartupFallback() {
    const snapshot = useStartupSnapshot()
    const dateLabel = useMemo(() => formatDateLabel(), [])
    const isMap = snapshot.activeView === "map"
    const calendarEventsByHour = useMemo(() => {
        const map = new Map<number, CachedCalendarEvent>()
        for (const event of snapshot.events) {
            const start = event.start_time ? new Date(event.start_time) : null
            if (!start || Number.isNaN(start.getTime())) continue
            const hour = start.getHours()
            if (!map.has(hour)) map.set(hour, event)
        }
        return map
    }, [snapshot.events])

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#050607] text-neutral-100 md:hidden">
            <div className="shrink-0 border-b border-white/10 px-4 pb-3 pt-[max(12px,env(safe-area-inset-top,0px))]">
                <div className="flex min-h-12 items-center justify-between gap-3">
                    <div>
                        <div className="text-[26px] font-bold leading-tight tracking-normal">
                            {isMap ? "マップ" : dateLabel}
                        </div>
                        <div className="mt-1 text-xs text-neutral-400">
                            {isMap ? "マップを準備中" : `${snapshot.events.length}件のスケジュール`}
                        </div>
                    </div>
                    <div className="inline-flex h-10 min-w-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] px-3">
                        {isMap ? <Network className="h-5 w-5 text-[#58a6ff]" /> : <CalendarDays className="h-5 w-5 text-[#58a6ff]" />}
                    </div>
                </div>
            </div>

            {isMap ? (
                <div className="relative flex-1 overflow-hidden px-4 py-5">
                    <div className="absolute left-10 top-12 h-px w-[72%] bg-white/10" />
                    <div className="absolute left-14 top-12 h-[52%] w-px bg-white/10" />
                    <div className="space-y-3">
                        {MINDMAP_SKELETON_DEPTHS.map((depth, index) => (
                            <div
                                key={index}
                                className="relative ml-[calc(var(--depth)*22px)] min-h-11 rounded-md border border-white/10 bg-[#153329] px-3 py-2 shadow-sm"
                                style={{ "--depth": depth } as CSSProperties & Record<"--depth", number>}
                            >
                                <div className="h-3 w-[68%] rounded-full bg-white/12" />
                                <div className="mt-2 h-1.5 w-24 rounded-full bg-white/10" />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-hidden px-4 py-3">
                    <div className="grid grid-cols-[44px_1fr] gap-x-3">
                        {Array.from({ length: 8 }).map((_, index) => {
                            const hour = 10 + index
                            const event = calendarEventsByHour.get(hour)
                            return (
                                <div key={event?.id ?? index} className="contents">
                                    <div className="pt-2 text-xs text-neutral-500">{hour}:00</div>
                                    <div className="min-h-[62px] border-t border-white/[0.07] py-1.5">
                                        {event ? (
                                            <div
                                                className="min-h-10 rounded-md border-l-4 px-3 py-2 text-sm font-medium text-neutral-100"
                                                style={{
                                                    backgroundColor: event.background_color || "rgba(45, 102, 82, 0.62)",
                                                    borderLeftColor: event.color || "#8ee8c1",
                                                }}
                                            >
                                                <div className="truncate">{event.title || "予定"}</div>
                                                <div className="mt-1 text-[11px] text-neutral-300">
                                                    {formatTime(event.start_time)} - {formatTime(event.end_time)}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="h-10 rounded-md bg-white/[0.035]" />
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            )}
        </div>
    )
}
