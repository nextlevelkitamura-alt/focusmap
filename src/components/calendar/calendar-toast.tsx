"use client"

import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react"

export type ToastType = 'success' | 'error' | 'info'

interface ToastProps {
  type: ToastType
  message: string
  duration?: number
  onClose?: () => void
  actionLabel?: string
  onAction?: () => void
}

export function CalendarToast({ type, message, duration = 3000, onClose, actionLabel, onAction }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(() => onClose?.(), 300)
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, onClose])

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-green-500" />,
    error: <XCircle className="w-5 h-5 text-red-500" />,
    info: <AlertCircle className="w-5 h-5 text-blue-500" />
  }

  return (
    <div
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 60px)" }}
      className={cn(
        "pointer-events-none fixed right-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg transition-all duration-300",
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2"
      )}
    >
      {icons[type]}
      <span className="text-sm font-medium">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={() => {
            onAction()
            setIsVisible(false)
            setTimeout(() => onClose?.(), 300)
          }}
          className="pointer-events-auto rounded-md border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted"
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        aria-label="通知を閉じる"
        onClick={() => {
          setIsVisible(false)
          setTimeout(() => onClose?.(), 300)
        }}
        className="pointer-events-auto ml-2 text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}

// 簡易的なトースト管理フック
export function useCalendarToast() {
  const [toast, setToast] = useState<{ type: ToastType; message: string } | null>(null)

  const showToast = (type: ToastType, message: string) => {
    setToast({ type, message })
  }

  const hideToast = () => {
    setToast(null)
  }

  return {
    toast,
    showToast,
    hideToast,
    success: (message: string) => showToast('success', message),
    error: (message: string) => showToast('error', message),
    info: (message: string) => showToast('info', message)
  }
}
