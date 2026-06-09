"use client"

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react"
import { Check, Clock, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { IosWheelColumn } from "@/components/ui/ios-wheel-column"
import { cn } from "@/lib/utils"

const DURATION_HOUR_OPTIONS = Array.from({ length: 13 }, (_, hour) => hour)
const DURATION_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => minute)

type DurationWheelPopoverProps = {
  valueMinutes: number | null | undefined
  onChange: (minutes: number) => void | Promise<void>
  trigger: ReactElement
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  className?: string
}

function splitDuration(minutes: number | null | undefined) {
  const normalized = typeof minutes === "number" && minutes > 0 ? minutes : 60
  return {
    hours: Math.min(12, Math.floor(normalized / 60)),
    minutes: normalized % 60,
  }
}

export function formatDurationWheelLabel(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "未設定"
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}時間${rest}分` : `${hours}時間`
}

export function DurationWheelPopover({
  valueMinutes,
  onChange,
  trigger,
  side = "bottom",
  align = "start",
  className,
}: DurationWheelPopoverProps) {
  const [open, setOpen] = useState(false)
  const initialParts = useMemo(() => splitDuration(valueMinutes), [valueMinutes])
  const [hours, setHours] = useState(initialParts.hours)
  const [minutes, setMinutes] = useState(initialParts.minutes)
  const [isSaving, setIsSaving] = useState(false)
  const totalMinutes = hours * 60 + minutes

  useEffect(() => {
    if (!open) return
    setHours(initialParts.hours)
    setMinutes(initialParts.minutes)
  }, [initialParts.hours, initialParts.minutes, open])

  const handleConfirm = useCallback(async () => {
    if (totalMinutes <= 0) return
    setIsSaving(true)
    try {
      await onChange(totalMinutes)
      setOpen(false)
    } finally {
      setIsSaving(false)
    }
  }, [onChange, totalMinutes])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        data-testid="duration-wheel-popover"
        className={cn(
          "w-[min(19rem,calc(100vw-2rem))] rounded-[22px] border-neutral-700/40 bg-[#2f2f2f]/95 p-2 text-neutral-100 shadow-[0_18px_52px_rgba(0,0,0,0.45)] backdrop-blur-xl",
          className,
        )}
      >
        <div className="relative overflow-hidden rounded-[18px] bg-[#383838]/90">
          <div className="grid grid-cols-2 border-b border-white/5 px-3 pt-2 text-center text-[11px] font-semibold text-neutral-500">
            <div>時間</div>
            <div>分</div>
          </div>
          <div className="relative h-[220px]">
            <div className="pointer-events-none absolute left-4 right-4 top-1/2 z-10 h-11 -translate-y-1/2 rounded-xl bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(0,0,0,0.22)]" />
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-[#383838] via-[#383838]/90 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-[#383838] via-[#383838]/90 to-transparent" />
            <div className="relative z-30 grid h-full grid-cols-2 px-3">
              <IosWheelColumn
                label="時間"
                values={DURATION_HOUR_OPTIONS}
                value={hours}
                onPreview={setHours}
                onCommit={setHours}
                formatValue={value => String(value)}
                dataColumn="duration-hour"
                idPrefix="duration-hour"
              />
              <IosWheelColumn
                label="分"
                values={DURATION_MINUTE_OPTIONS}
                value={minutes}
                onPreview={setMinutes}
                onCommit={setMinutes}
                dataColumn="duration-minute"
                idPrefix="duration-minute"
              />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1 pb-1">
          <div className="flex min-w-0 items-center gap-1.5 text-sm text-neutral-300">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{formatDurationWheelLabel(totalMinutes)}</span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleConfirm}
            disabled={isSaving || totalMinutes <= 0}
            className="h-9 shrink-0 gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            反映
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
