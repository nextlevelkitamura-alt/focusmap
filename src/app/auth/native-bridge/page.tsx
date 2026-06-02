'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

function normalizeNext(value: string | null) {
  if (!value || !value.startsWith('/')) return '/dashboard?source=ios-app&standalone=1'
  const url = new URL(value, window.location.origin)
  url.searchParams.set('source', 'ios-app')
  url.searchParams.set('standalone', '1')
  return `${url.pathname}${url.search}`
}

function NativeBridgeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('ログインを反映しています')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const nonce = searchParams.get('nonce')
      const next = normalizeNext(searchParams.get('next'))

      if (!nonce) {
        setMessage('ログイン情報が見つかりません。もう一度Googleログインを実行してください。')
        return
      }

      try {
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
            const supabase = createClient()
            const { error } = await supabase.auth.setSession({
              access_token: payload.access_token,
              refresh_token: payload.refresh_token,
            })
            if (error) throw error
            router.replace(next)
            return
          }
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
