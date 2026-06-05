"use client"

import { createClient } from "@/utils/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState, useEffect, Suspense, useCallback, useMemo } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { isFocusmapIosAppShell, openExternalAuthUrl } from "@/lib/external-auth-launch"
import type { Session } from "@supabase/supabase-js"

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MzgzNTcsImV4cCI6MjA4NDMxNDM1N30.qMVqh1DPzYFhJx29NtWghqfLGM68JHd3O51nxxWsWPA'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')

declare global {
    interface Window {
        focusmapDesktop?: {
            openExternal?: (url: string) => Promise<unknown>
            getWebAuthOrigin?: () => Promise<string>
            consumeAuthSession?: (nonce: string, origin?: string) => Promise<{
                ok: boolean
                status: number
                payload?: {
                    error?: string
                    access_token?: string
                    refresh_token?: string
                    user_id?: string
                    status?: string
                } | null
            }>
            saveAuthSession?: (session: {
                access_token: string
                refresh_token: string
                expires_at?: number | null
                user_id?: string | null
            }) => Promise<{ ok: boolean; error?: string }>
            loadAuthSession?: () => Promise<{
                ok: boolean
                error?: string
                session?: {
                    access_token: string
                    refresh_token: string
                    expires_at?: number | null
                    user_id?: string | null
                } | null
            }>
            clearAuthSession?: () => Promise<{ ok: boolean; error?: string }>
        }
    }
}

function getAuthCallbackUrl(options?: { desktop?: boolean; nativeApp?: 'ios'; nonce?: string; next?: string }) {
    const origin = options?.desktop ? location.origin : SITE_URL || location.origin
    const url = new URL('/auth/callback', origin)
    if (options?.desktop) url.searchParams.set('desktop', '1')
    if (options?.nativeApp) url.searchParams.set('native_app', options.nativeApp)
    if (options?.nonce) url.searchParams.set('nonce', options.nonce)
    if (options?.next) url.searchParams.set('next', options.next)
    return url.toString()
}

function getExternalAuthStartUrl(options: { desktop?: boolean; nativeApp?: 'ios'; nonce: string; next: string; origin?: string }) {
    const url = new URL('/auth/native-start', options.origin || location.origin)
    url.searchParams.set('nonce', options.nonce)
    url.searchParams.set('next', options.next)
    if (options.desktop) url.searchParams.set('desktop', '1')
    if (options.nativeApp) url.searchParams.set('native_app', options.nativeApp)
    return url.toString()
}

async function getDesktopAuthOrigin() {
    const configured = await window.focusmapDesktop?.getWebAuthOrigin?.()
    return (configured || SITE_URL || location.origin).replace(/\/$/, '')
}

async function consumeDesktopAuthSession(nonce: string, authOrigin: string) {
    if (window.focusmapDesktop?.consumeAuthSession) {
        const result = await window.focusmapDesktop.consumeAuthSession(nonce, authOrigin)
        if (result.status === 202) return { pending: true as const }
        if (!result.ok) {
            throw new Error(result.payload?.error || 'Macアプリへのログイン受け渡しに失敗しました')
        }
        return { pending: false as const, payload: result.payload }
    }

    const url = new URL('/api/auth/desktop-session', authOrigin)
    if (url.origin !== location.origin) {
        throw new Error('Macアプリ側の認証受け渡し機能が古い状態です。Macアプリを再ビルドしてください。')
    }
    url.searchParams.set('nonce', nonce)
    const response = await fetch(url.toString())
    if (response.status === 202) return { pending: true as const }
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(payload?.error || 'Macアプリへのログイン受け渡しに失敗しました')
    return { pending: false as const, payload }
}

function LoginContent() {
    const supabase = useMemo(() => createClient(), [])
    const searchParams = useSearchParams()
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)
    const isDesktopShell = searchParams.get('desktop') === '1' || searchParams.get('source') === 'mac'
    const isIosAppShell = isFocusmapIosAppShell()
    const dashboardPath = isDesktopShell
        ? '/dashboard?desktop=1&source=mac'
        : isIosAppShell
            ? '/dashboard?source=ios-app&standalone=1'
            : '/dashboard'

    const formatAuthError = (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        if (text.includes('exceed_cached_egress_quota') || text.includes('Service for this project is restricted')) {
            return 'Supabase の転送量上限によりプロジェクトが制限されています。課金設定または Supabase サポートで制限解除が必要です。'
        }
        return text
    }

    const saveDesktopSession = useCallback(async (session: Session | {
        access_token?: string | null
        refresh_token?: string | null
        expires_at?: number | null
        user?: { id?: string | null } | null
        user_id?: string | null
    } | null) => {
        if (!isDesktopShell || !window.focusmapDesktop?.saveAuthSession || !session?.access_token || !session.refresh_token) {
            return
        }
        await window.focusmapDesktop.saveAuthSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
            expires_at: typeof session.expires_at === 'number' ? session.expires_at : null,
            user_id: session.user?.id ?? ('user_id' in session ? session.user_id ?? null : null),
        })
    }, [isDesktopShell])

    const restoreDesktopSession = useCallback(async () => {
        if (!isDesktopShell || !window.focusmapDesktop?.loadAuthSession) return false
        const saved = await window.focusmapDesktop.loadAuthSession()
        if (!saved.ok || !saved.session?.access_token || !saved.session.refresh_token) return false
        const { error } = await supabase.auth.setSession({
            access_token: saved.session.access_token,
            refresh_token: saved.session.refresh_token,
        })
        if (error) {
            await window.focusmapDesktop.clearAuthSession?.()
            return false
        }
        return true
    }, [isDesktopShell, supabase])

    const checkSupabaseAuthAvailable = async () => {
        const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
        })

        if (!response.ok) {
            const body = await response.json().catch(() => null)
            const message = typeof body?.message === 'string'
                ? body.message
                : `Supabase Auth is unavailable (${response.status})`
            throw new Error(message)
        }
    }

    useEffect(() => {
        const errorQuery = searchParams.get('error')
        if (errorQuery) {
            setMessage({ type: 'error', text: 'Authentication failed. Please try again.' })
        }
    }, [searchParams])

    // Check if already logged in
    useEffect(() => {
        let cancelled = false
        const checkUser = async () => {
            let { data: { user } } = await supabase.auth.getUser()
            if (!user) {
                const restored = await restoreDesktopSession()
                if (restored) {
                    const restoredUser = await supabase.auth.getUser()
                    user = restoredUser.data.user
                }
            }
            if (user) {
                if (cancelled) return
                router.push(dashboardPath)
            }
        }
        checkUser()
        return () => {
            cancelled = true
        }
    }, [supabase, router, dashboardPath, restoreDesktopSession])

    useEffect(() => {
        if (!isDesktopShell) return
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_OUT') {
                window.focusmapDesktop?.clearAuthSession?.()
                return
            }
            if (session) {
                saveDesktopSession(session).catch(() => {})
            }
        })
        return () => subscription.unsubscribe()
    }, [supabase, isDesktopShell, saveDesktopSession])

    const handleGoogleLogin = async () => {
        setLoading(true)
        setMessage(null)
        try {
            await checkSupabaseAuthAvailable()
            if (isDesktopShell && window.focusmapDesktop?.openExternal) {
                const nonce = crypto.randomUUID()
                const authOrigin = await getDesktopAuthOrigin()
                await window.focusmapDesktop.openExternal(getExternalAuthStartUrl({
                    desktop: true,
                    nonce,
                    next: '/dashboard?desktop=1&source=mac',
                    origin: authOrigin,
                }))
                setMessage({ type: 'success', text: '外部ブラウザでGoogleログインを完了してください。完了後、このMacアプリに自動で戻ります。' })

                const startedAt = Date.now()
                while (Date.now() - startedAt < 5 * 60 * 1000) {
                    await new Promise(resolve => setTimeout(resolve, 1500))
                    const session = await consumeDesktopAuthSession(nonce, authOrigin)
                    if (session.pending) continue
                    const payload = session.payload
                    if (payload?.access_token && payload?.refresh_token) {
                        const { error: sessionError } = await supabase.auth.setSession({
                            access_token: payload.access_token,
                            refresh_token: payload.refresh_token,
                        })
                        if (sessionError) throw sessionError
                        await saveDesktopSession({
                            access_token: payload.access_token,
                            refresh_token: payload.refresh_token,
                            user_id: payload.user_id ?? null,
                        })
                        router.push('/dashboard?desktop=1&source=mac')
                        return
                    }
                }
                throw new Error('外部ブラウザでのログイン完了を確認できませんでした。もう一度お試しください。')
            }

            if (isIosAppShell) {
                const nonce = crypto.randomUUID()
                await openExternalAuthUrl(getExternalAuthStartUrl({
                    nativeApp: 'ios',
                    nonce,
                    next: dashboardPath,
                }))
                setMessage({ type: 'success', text: '外部ブラウザーでGoogleログインを完了してください。完了後、Focusmapアプリへ戻ります。' })
                setLoading(false)
                return
            }

            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: getAuthCallbackUrl(),
                },
            })
            if (error) throw error
        } catch (error: unknown) {
            setMessage({ type: 'error', text: formatAuthError(error) })
            setLoading(false)
        }
    }

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setMessage(null)
        try {
            await checkSupabaseAuthAvailable()
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            })
            if (error) throw error
            await saveDesktopSession(data.session)
            router.push(dashboardPath)
        } catch (error: unknown) {
            setMessage({ type: 'error', text: formatAuthError(error) })
        } finally {
            setLoading(false)
        }
    }

    const handleEmailSignUp = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setMessage(null)
        try {
            await checkSupabaseAuthAvailable()
            const { error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    emailRedirectTo: getAuthCallbackUrl(),
                },
            })
            if (error) throw error
            setMessage({ type: 'success', text: '確認メールを送信しました。メール内のリンクをクリックしてください。' })
        } catch (error: unknown) {
            setMessage({ type: 'error', text: formatAuthError(error) })
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
            <div className="w-full max-w-md p-8 space-y-6 border rounded-xl shadow-sm bg-card">
                <div className="space-y-2 text-center">
                    <h1 className="text-3xl font-bold tracking-tighter">Focusmap</h1>
                    <p className="text-muted-foreground">Focus on &quot;Now Here&quot;</p>
                </div>

                {message && (
                    <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-green-500 text-green-500' : ''}>
                        <AlertDescription>{message.text}</AlertDescription>
                    </Alert>
                )}

                <div className="space-y-4">
                    <Button onClick={handleGoogleLogin} className="w-full" variant="outline" size="lg" disabled={loading}>
                        Sign in with Google
                    </Button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">
                                Or continue with email
                            </span>
                        </div>
                    </div>

                    <Tabs defaultValue="signin" className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="signin">Sign In</TabsTrigger>
                            <TabsTrigger value="signup">Sign Up</TabsTrigger>
                        </TabsList>
                        <TabsContent value="signin">
                            <form onSubmit={handleEmailSignIn} className="space-y-4 pt-4">
                                <Input
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                                <Input
                                    type="password"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                />
                                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                                    {loading ? "Signing In..." : "Sign In"}
                                </Button>
                            </form>
                        </TabsContent>
                        <TabsContent value="signup">
                            <form onSubmit={handleEmailSignUp} className="space-y-4 pt-4">
                                <Input
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                                <Input
                                    type="password"
                                    placeholder="Password (min 6 characters)"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                />
                                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                                    {loading ? "Creating Account..." : "Create Account"}
                                </Button>
                            </form>
                        </TabsContent>
                    </Tabs>

                    <p className="text-xs text-center text-muted-foreground">
                        Googleログインは Supabase Auth の Google Provider を使用します。
                    </p>
                </div>
            </div>
        </div>
    )
}

export default function LoginPage() {
    return (
        <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen bg-background">
                <div className="animate-pulse">Loading...</div>
            </div>
        }>
            <LoginContent />
        </Suspense>
    )
}
