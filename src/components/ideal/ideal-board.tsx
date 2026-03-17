"use client"

import { IdealGoalWithItems } from "@/types/database"
import { IdealCard } from "./ideal-card"
import { IdealCardEmpty } from "./ideal-card-empty"
import { IdealEditDialog } from "./ideal-edit-dialog"
import { useState } from "react"

interface IdealBoardProps {
    ideals: IdealGoalWithItems[]
    selectedIdealId: string | null
    onSelect: (id: string | null) => void
    onCreated: (ideal: IdealGoalWithItems) => void
    onUpdated: (ideal: IdealGoalWithItems) => void
    onDeleted: (id: string) => void
}

export function IdealBoard({
    ideals,
    selectedIdealId,
    onSelect,
    onCreated,
    onUpdated,
    onDeleted,
}: IdealBoardProps) {
    const [createOpen, setCreateOpen] = useState(false)

    const activeIdeals = ideals.filter(i => i.status === 'active')
    const emptySlots = Math.max(0, 3 - activeIdeals.length)

    return (
        <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeIdeals.map(ideal => (
                    <IdealCard
                        key={ideal.id}
                        ideal={ideal}
                        isSelected={selectedIdealId === ideal.id}
                        onSelect={() => onSelect(selectedIdealId === ideal.id ? null : ideal.id)}
                        onUpdated={onUpdated}
                        onDeleted={onDeleted}
                    />
                ))}
                {/* 空スロット */}
                {emptySlots > 0 && Array.from({ length: emptySlots }).map((_, i) => (
                    <IdealCardEmpty key={`empty-${i}`} onClick={() => setCreateOpen(true)} />
                ))}
            </div>

            <IdealEditDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onSaved={(ideal) => {
                    onCreated(ideal)
                    setCreateOpen(false)
                }}
            />
        </>
    )
}
