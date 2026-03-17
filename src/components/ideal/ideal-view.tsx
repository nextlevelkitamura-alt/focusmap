"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { IdealBoard } from "./ideal-board"
import { IdealItemsPanel } from "./ideal-items-panel"
import { IdealChatPanel } from "./ideal-chat-panel"
import { IdealGalleryView } from "./ideal-gallery-view"
import { CostDashboard } from "./cost-dashboard"
import { CapacityBar } from "./capacity-bar"
import { IdealGoalWithItems } from "@/types/database"
import { useIdealTracking } from "@/hooks/useIdealTracking"
import { MessageCircle, LayoutGrid, Image, Wallet } from "lucide-react"
import { cn } from "@/lib/utils"
import { format } from "date-fns"

type ViewTab = 'board' | 'gallery' | 'cost'

export function IdealView() {
    const [ideals, setIdeals] = useState<IdealGoalWithItems[]>([])
    const [selectedIdealId, setSelectedIdealId] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [dailyCapacityMinutes, setDailyCapacityMinutes] = useState<number>(120)
    const [isChatOpen, setIsChatOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<ViewTab>('board')

    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const dateRange = useMemo(() => ({ from: todayStr, to: todayStr }), [todayStr])
    const { todaySummary } = useIdealTracking(ideals, dateRange)

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
                todayElapsedMinutes={todaySummary?.totalElapsedMinutes ?? 0}
            />

            {/* タブ切り替え */}
            <div className="flex items-center gap-1 px-4 py-1.5 border-b flex-shrink-0">
                <TabButton
                    active={activeTab === 'board'}
                    onClick={() => setActiveTab('board')}
                    icon={<LayoutGrid className="w-3.5 h-3.5" />}
                    label="ボード"
                />
                <TabButton
                    active={activeTab === 'gallery'}
                    onClick={() => setActiveTab('gallery')}
                    icon={<Image className="w-3.5 h-3.5" />}
                    label="ギャラリー"
                />
                <TabButton
                    active={activeTab === 'cost'}
                    onClick={() => setActiveTab('cost')}
                    icon={<Wallet className="w-3.5 h-3.5" />}
                    label="コスト"
                />
            </div>

            {/* メインエリア */}
            {activeTab === 'board' && (
                <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
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

                    {selectedIdeal && (
                        <div className="w-full md:w-80 lg:w-96 border-t md:border-t-0 md:border-l flex-shrink-0 overflow-hidden">
                            <IdealItemsPanel
                                ideal={selectedIdeal}
                                onItemsChanged={handleItemsChanged}
                                onClose={() => setSelectedIdealId(null)}
                            />
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'gallery' && (
                <div className="flex-1 min-h-0 overflow-hidden">
                    <IdealGalleryView
                        ideals={ideals}
                        onItemsChanged={handleItemsChanged}
                    />
                </div>
            )}

            {activeTab === 'cost' && (
                <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-6">
                    <CostDashboard ideals={ideals} />
                </div>
            )}

            {/* チャットパネル */}
            {isChatOpen && (
                <div className="fixed inset-y-0 right-0 w-full md:w-96 z-40 border-l bg-background shadow-xl">
                    <IdealChatPanel onClose={() => setIsChatOpen(false)} />
                </div>
            )}

            {/* チャットトグルボタン */}
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

function TabButton({ active, onClick, icon, label }: {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
}) {
    return (
        <button
            onClick={onClick}
            className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
        >
            {icon}
            {label}
        </button>
    )
}

