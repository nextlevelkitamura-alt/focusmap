"use client"

import { Loader2, Check, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

interface TaskCalendarSyncStatusProps {
  status: SyncStatus
  error: Error | null
  onRetry: () => void
  className?: string
}

export function TaskCalendarSyncStatus({
  status,
  error,
  onRetry,
  className
}: TaskCalendarSyncStatusProps) {
  if (status === 'idle') return null

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {status === 'syncing' && (
        <span title="同期中...">
          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        </span>
      )}

      {status === 'success' && (
        <span title="同期済み">
          <Check className="w-3 h-3 text-green-500" />
        </span>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-0.5">
          <span title={error?.message || "同期に失敗しました"}>
            <AlertCircle className="w-3 h-3 text-destructive" />
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 p-0 text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation()
              onRetry()
            }}
            title="再試行"
          >
            <RefreshCw className="w-2.5 h-2.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
