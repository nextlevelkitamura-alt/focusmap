'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

function safeNext(value: string | null) {
  if (!value || !value.startsWith('/')) return '/dashboard'
  return value
}

function NativeStartContent() {
  const searchParams = useSearchParams()
  const [message, setMessage] = useState('外部ブラウザーでGoogleログインを開始しています')

  useEffect(() => {
    let cancelled = false

    async function run() {
      const nonce = searchParams.get('nonce')
      const desktop = searchParams.get('desktop') === '1'
      const nativeApp = searchParams.get('native_app') === 'ios' ? 'ios' : null
      const next = safeNext(searchParams.get('next'))

      if (!nonce || (!desktop && !nativeApp)) {
        setMessage('ログイン開始情報が不足しています。Focusmapアプリからもう一度ログインしてください。')
        return
      }

      try {
        const callbackUrl = new URL('/auth/callback', window.location.origin)
        callbackUrl.searchParams.set('nonce', nonce)
        callbackUrl.searchParams.set('next', next)
        if (desktop) callbackUrl.searchParams.set('desktop', '1')
        if (nativeApp) callbackUrl.searchParams.set('native_app', nativeApp)

        const supabase = createClient()
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: callbackUrl.toString(),
          },
        })

        if (!cancelled && error) throw error
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (!cancelled) setMessage(`Googleログインを開始できませんでした: ${detail}`)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [searchParams])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-lg font-semibold">Focusmap</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </main>
  )
}

export default function NativeStartPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
        外部ブラウザーでGoogleログインを開始しています
      </main>
    }>
      <NativeStartContent />
    </Suspense>
  )
}
