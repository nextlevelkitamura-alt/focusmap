'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import {
  clearNativeAuthSession,
  loadNativeAuthSession,
  saveNativeAuthSession,
  type FocusmapNativeAuthSession,
} from '@/lib/external-auth-launch'

function normalizeNext(value: string | null) {
  if (!value || !value.startsWith('/')) return '/dashboard?source=ios-app&standalone=1'
  const url = new URL(value, window.location.origin)
  url.searchParams.set('source', 'ios-app')
  url.searchParams.set('standalone', '1')
  return `${url.pathname}${url.search}`
}

function decodeNativePayload(value: string | null): FocusmapNativeAuthSession | null {
  if (!value) return null
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<FocusmapNativeAuthSession> | null
    if (!parsed?.access_token || !parsed.refresh_token) return null
    return {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_at: typeof parsed.expires_at === 'number' ? parsed.expires_at : null,
      user_id: typeof parsed.user_id === 'string' ? parsed.user_id : null,
    }
  } catch {
    return null
  }
}

function NativeBridgeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('ログインを反映しています')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const nonce = searchParams.get('nonce')
      const restore = searchParams.get('restore') === '1'
      const next = normalizeNext(searchParams.get('next'))
      const payloadSession = decodeNativePayload(searchParams.get('payload'))
      const supabase = createClient()

      const applySession = async (session: FocusmapNativeAuthSession) => {
        const { error } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })
        if (error) {
          clearNativeAuthSession()
          throw error
        }
        saveNativeAuthSession(session)
        router.replace(next)
      }

      try {
        if (payloadSession) {
          await applySession(payloadSession)
          return
        }

        if (restore) {
          const { data: { user } } = await supabase.auth.getUser()
          if (cancelled) return
          if (user) {
            router.replace(next)
            return
          }

          const saved = await loadNativeAuthSession()
          if (cancelled) return
          if (saved?.access_token && saved.refresh_token) {
            await applySession(saved)
            return
          }

          router.replace(next)
          return
        }

        if (!nonce) {
          setMessage('ログイン情報が見つかりません。もう一度Googleログインを実行してください。')
          return
        }

        for (let attempt = 0; attempt < 12; attempt += 1) {
          const response = await fetch(`/api/auth/desktop-session?nonce=${encodeURIComponent(nonce)}`)
          if (cancelled) return

          if (response.status === 202) {
            await new Promise(resolve => setTimeout(resolve, 700))
            continue
          }

          const payload = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(payload?.error || 'ログイン情報の受け渡しに失敗しました')
          }

          if (payload?.access_token && payload?.refresh_token) {
            const session = {
              access_token: payload.access_token,
              refresh_token: payload.refresh_token,
              expires_at: typeof payload.expires_at === 'number' ? payload.expires_at : null,
              user_id: typeof payload.user_id === 'string' ? payload.user_id : null,
            }
            await applySession(session)
            return
          }
        }

        const saved = await loadNativeAuthSession()
        if (saved?.access_token && saved.refresh_token) {
          await applySession(saved)
          return
        }

        throw new Error('ログイン完了を確認できませんでした')
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        setMessage(detail)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [router, searchParams])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-lg font-semibold">Focusmap</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </main>
  )
}

export default function NativeBridgePage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        ログインを反映しています
      </main>
    }>
      <NativeBridgeContent />
    </Suspense>
  )
}
