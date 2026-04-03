'use client'

import { useState, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ServiceStatus {
  name: string
  status: 'ok' | 'warning' | 'checking'
  label: string
}

export function AuthStatusBar() {
  const [services, setServices] = useState<ServiceStatus[]>([
    { name: 'supabase', status: 'checking', label: 'DB' },
    { name: 'calendar', status: 'checking', label: 'カレンダー' },
  ])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const checkServices = async () => {
      const results: ServiceStatus[] = []

      // Supabase check
      try {
        const res = await fetch('/api/tasks?limit=1')
        results.push({
          name: 'supabase',
          status: res.ok ? 'ok' : 'warning',
          label: 'DB',
        })
      } catch {
        results.push({ name: 'supabase', status: 'warning', label: 'DB' })
      }

      // Calendar check
      try {
        const res = await fetch('/api/calendar/events/list?timeMin=' + new Date().toISOString() + '&timeMax=' + new Date().toISOString())
        results.push({
          name: 'calendar',
          status: res.ok ? 'ok' : 'warning',
          label: 'カレンダー',
        })
      } catch {
        results.push({ name: 'calendar', status: 'warning', label: 'カレンダー' })
      }

      setServices(results)
    }

    checkServices()
  }, [])

  const hasWarning = services.some(s => s.status === 'warning')
  const isChecking = services.some(s => s.status === 'checking')

  // 全部 OK なら何も表示しない
  if (!hasWarning && !isChecking) return null

  return (
    <div className="px-4 py-2 border-b">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-2 w-full text-left"
      >
        {isChecking ? (
          <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
        ) : hasWarning ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
        )}
        <span className="text-xs text-muted-foreground flex-1">
          {isChecking ? '接続確認中...' : hasWarning ? '一部サービスに問題があります' : '全サービス正常'}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-1">
          {services.map(service => (
            <div key={service.name} className="flex items-center gap-2 px-1 py-1">
              {service.status === 'ok' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
              ) : service.status === 'warning' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              ) : (
                <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin shrink-0" />
              )}
              <span className={cn(
                'text-xs',
                service.status === 'warning' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
              )}>
                {service.label}
              </span>
              <span className="text-[10px] text-muted-foreground/50 ml-auto">
                {service.status === 'ok' ? 'OK' : service.status === 'warning' ? '要確認' : '確認中'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
