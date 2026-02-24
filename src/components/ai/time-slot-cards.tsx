"use client"

import { cn } from "@/lib/utils"

export interface TimeSlot {
  date: string        // "2026-02-25"
  startTime: string   // "10:00"
  endTime: string     // "11:00"
  label: string       // "明日（火）10:00〜11:00"
  scheduled_at: string // ISO8601 +09:00
}

interface TimeSlotCardsProps {
  slots: TimeSlot[]
  onSelect: (slot: TimeSlot) => void
  disabled?: boolean
  used?: boolean
}

// 所要時間のラベル
function durationLabel(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 60) return `${mins}分`
  if (mins % 60 === 0) return `${mins / 60}時間`
  return `${Math.floor(mins / 60)}時間${mins % 60}分`
}

export function TimeSlotCards({ slots, onSelect, disabled, used }: TimeSlotCardsProps) {
  if (used) {
    return (
      <p className="text-xs text-muted-foreground mt-1 opacity-50">選択済み</p>
    )
  }

  return (
    <div className="mt-2 pt-2 border-t border-border/30 grid grid-cols-2 gap-1.5">
      {slots.map((slot, i) => (
        <button
          key={i}
          onClick={() => !disabled && onSelect(slot)}
          disabled={disabled}
          className={cn(
            "flex flex-col items-start gap-0.5 px-2.5 py-2 rounded-xl border border-border",
            "text-left transition-all",
            disabled
              ? "opacity-50 cursor-not-allowed"
              : "hover:border-primary/50 hover:bg-primary/5 active:scale-[0.97] cursor-pointer"
          )}
        >
          {/* 日付ラベル（短縮形）*/}
          <span className="text-[10px] text-muted-foreground font-medium leading-none">
            {slot.label.split(' ')[0]}
          </span>
          {/* 時間 */}
          <span className="text-sm font-bold text-primary leading-tight">
            {slot.startTime}〜{slot.endTime}
          </span>
          {/* 所要時間 */}
          <span className="text-[10px] text-muted-foreground leading-none">
            {durationLabel(slot.startTime, slot.endTime)}
          </span>
        </button>
      ))}
    </div>
  )
}
