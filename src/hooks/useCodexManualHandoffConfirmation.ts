'use client'

import { useCallback, useEffect, useRef } from 'react'
import { fetchWithSupabaseAuth } from '@/lib/auth/supabase-auth-fetch'
import type { AiTask } from '@/types/ai-task'

type PendingHandoff = {
  token: string
  taskId: string | null
  screenSwitched: boolean
  confirmed: boolean
  confirming: boolean
  event: 'external_app_opened' | 'external_app_returned' | 'screen_switched'
}

type TrackManualHandoffInput = {
  taskId?: string | null
  taskPromise?: Promise<Pick<AiTask, 'id'> | null | undefined>
}

type UseCodexManualHandoffConfirmationOptions = {
  onConfirmed?: (task: AiTask) => Promise<void> | void
}

function nextToken() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function useCodexManualHandoffConfirmation(options: UseCodexManualHandoffConfirmationOptions = {}) {
  const pendingRef = useRef<PendingHandoff | null>(null)
  const onConfirmedRef = useRef(options.onConfirmed)
  onConfirmedRef.current = options.onConfirmed

  const confirmPending = useCallback(async (event?: PendingHandoff['event']) => {
    const pending = pendingRef.current
    if (!pending || pending.confirmed || pending.confirming || !pending.screenSwitched || !pending.taskId) return null

    pending.confirming = true
    const nextEvent = event ?? pending.event
    try {
      const response = await fetchWithSupabaseAuth(`/api/ai-tasks/${pending.taskId}/manual-handoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ event: nextEvent }),
      })
      const data = await response.json().catch(() => null) as AiTask | { error?: string } | null
      if (!response.ok) {
        throw new Error(data && 'error' in data && data.error ? data.error : `manual handoff ${response.status}`)
      }
      pending.confirmed = true
      pendingRef.current = null
      if (data && 'id' in data) {
        await onConfirmedRef.current?.(data)
        return data
      }
      return null
    } catch {
      pending.confirming = false
      return null
    }
  }, [])

  const markScreenSwitched = useCallback((event: PendingHandoff['event'] = 'screen_switched') => {
    const pending = pendingRef.current
    if (!pending || pending.confirmed) return
    pending.screenSwitched = true
    pending.event = event
    void confirmPending(event)
  }, [confirmPending])

  const trackManualHandoff = useCallback((input: TrackManualHandoffInput = {}) => {
    const token = nextToken()
    pendingRef.current = {
      token,
      taskId: input.taskId ?? null,
      screenSwitched: false,
      confirmed: false,
      confirming: false,
      event: 'screen_switched',
    }

    input.taskPromise
      ?.then(task => {
        const pending = pendingRef.current
        if (!pending || pending.token !== token || pending.confirmed) return
        pending.taskId = task?.id ?? pending.taskId
        void confirmPending(pending.event)
      })
      .catch(() => undefined)

    return token
  }, [confirmPending])

  const confirmManualHandoffNow = useCallback((taskId: string, event: PendingHandoff['event'] = 'screen_switched') => {
    pendingRef.current = {
      token: nextToken(),
      taskId,
      screenSwitched: true,
      confirmed: false,
      confirming: false,
      event,
    }
    return confirmPending(event)
  }, [confirmPending])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markScreenSwitched('external_app_opened')
      } else if (document.visibilityState === 'visible') {
        const pending = pendingRef.current
        if (pending?.screenSwitched) void confirmPending('external_app_returned')
      }
    }
    const handlePageHide = () => markScreenSwitched('external_app_opened')
    const handleBlur = () => markScreenSwitched('screen_switched')
    const handleFocus = () => {
      const pending = pendingRef.current
      if (pending?.screenSwitched) void confirmPending('external_app_returned')
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('focus', handleFocus)
    }
  }, [confirmPending, markScreenSwitched])

  return {
    trackManualHandoff,
    confirmManualHandoffNow,
    markScreenSwitched,
  }
}
