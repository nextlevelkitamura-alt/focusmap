"use client"

import { useEffect, useMemo } from "react"
import { createClient } from "@/utils/supabase/client"
import {
  clearNativeAuthSession,
  isFocusmapDesktopShell,
  isFocusmapIosAppShell,
  saveNativeAuthSession,
} from "@/lib/external-auth-launch"

export function DesktopAuthSessionBridge() {
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const isDesktopShell = isFocusmapDesktopShell()
    const isIosAppShell = isFocusmapIosAppShell()
    if (!isDesktopShell && !isIosAppShell) return

    let cancelled = false

    const saveSession = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (!session?.access_token || !session.refresh_token) return
      const payload = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: typeof session.expires_at === "number" ? session.expires_at : null,
        user_id: session.user?.id ?? null,
      }
      if (isDesktopShell && window.focusmapDesktop?.saveAuthSession) {
        await window.focusmapDesktop.saveAuthSession(payload)
      }
      if (isIosAppShell) {
        saveNativeAuthSession(payload)
      }
    }

    supabase.auth.getSession()
      .then(({ data }) => {
        if (!cancelled) return saveSession(data.session)
      })
      .catch(() => undefined)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        window.focusmapDesktop?.clearAuthSession?.().catch(() => undefined)
        clearNativeAuthSession()
        return
      }
      if (session) saveSession(session).catch(() => undefined)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase])

  return null
}
