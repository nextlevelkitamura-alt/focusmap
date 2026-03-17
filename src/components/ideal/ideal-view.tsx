"use client"

import { useState, useEffect, useCallback } from "react"
import { IdealBoard } from "./ideal-board"
import { IdealItemsPanel } from "./ideal-items-panel"
import { IdealChatPanel } from "./ideal-chat-panel"
import { CapacityBar } from "./capacity-bar"
import { IdealGoalWithItems } from "@/types/database"
import { MessageCircle } from "lucide-react"

export function IdealView() {
    const [ideals, setIdeals] = useState<IdealGoalWithItems[]>([])
    const [selectedIdealId, setSelectedIdealId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [dailyCapacityMinutes, setDailyCapacityMinutes] = useState<number>(120)
    const [isChatOpen, setIsChatOpen] = useState(false)

    const fetchIdeals = useCallback(async () => {
        try {
            const res = await fetch('/api/ideals')
            if (!res.ok) return
            const { ideals: data } = await res.json()
            setIdeals(data ?? [])
        } catch {
            // silent
        } finally {
            setIsLoading(false)
        }
    }, [])

    const fetchPreferences = useCallback(async () => {
        try {
            const res = await fetch('/api/ai/context')
            if (!res.ok) return
            const { preferences } = await res.json()
            if (preferences?.daily_capacity_minutes) {
                setDailyCapacityMinutes(preferences.daily_capacity_minutes)
            }
        } catch {
            // silent - デフォルト値のまま
        }
    }, [])

    useEffect(() => {
        fetchIdeals()
        fetchPreferences()
    }, [fetchIdeals, fetchPreferences])

    const handleCapacityChange = async (minutes: number) => {
        setDailyCapacityMinutes(minutes)
        try {
            await fetch('/api/ai/context', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ preferences: { daily_capacity_minutes: minutes } }),
            })
        } catch {
            // silent
        }
    }

    const selectedIdeal = ideals.find(i => i.id === selectedIdealId) ?? null

    const handleIdealCreated = (ideal: IdealGoalWithItems) => {
        setIdeals(prev => [...prev, ideal])
    }

    const handleIdealUpdated = (updated: IdealGoalWithItems) => {
        setIdeals(prev => prev.map(i => i.id === updated.id ? updated : i))
    }

    const handleIdealDeleted = (id: string) => {
        setIdeals(prev => prev.filter(i => i.id !== id))
        if (selectedIdealId === id) setSelectedIdealId(null)
    }

    const handleItemsChanged = async () => {
        await fetchIdeals()
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                読み込み中...
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* キャパシティバー */}
            <CapacityBar
                ideals={ideals}
                dailyCapacityMinutes={dailyCapacityMinutes}
                onCapacityChange={handleCapacityChange}
            />

            {/* メインエリア */}
            <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                {/* ビジョンボード */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
                    <IdealBoard
                        ideals={ideals}
                        selectedIdealId={selectedIdealId}
                        onSelect={setSelectedIdealId}
                        onCreated={handleIdealCreated}
                        onUpdated={handleIdealUpdated}
                        onDeleted={handleIdealDeleted}
                    />
                </div>

                {/* アイテムパネル（カード選択時に表示） */}
                {selectedIdeal && (
                    <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l flex-shrink-0 overflow-hidden">
                        <IdealItemsPanel
                            ideal={selectedIdeal}
                            onItemsChanged={handleItemsChanged}
                            onClose={() => setSelectedIdealId(null)}
                        />
                    </div>
                )}

                {/* チャットパネル（トグル時に表示） */}
                {isChatOpen && (
                    <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l flex-shrink-0 overflow-hidden h-full">
                        <IdealChatPanel onClose={() => setIsChatOpen(false)} />
                    </div>
                )}
            </div>

            {/* チャットトグルボタン（フローティング） */}
            {!isChatOpen && (
                <button
                    onClick={() => setIsChatOpen(true)}
                    className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 flex items-center gap-2 rounded-full bg-primary text-primary-foreground px-4 py-2.5 shadow-lg hover:opacity-90 transition-opacity"
                >
                    <MessageCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">理想コーチ</span>
                </button>
            )}
        </div>
    )
}
