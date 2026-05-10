"use client"

import { createClient } from "@/utils/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useState, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const FALLBACK_SUPABASE_URL = 'https://whsjsscgmkkkzgcwxjko.supabase.co'
const FALLBACK_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indoc2pzc2NnbWtra3pnY3d4amtvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3MzgzNTcsImV4cCI6MjA4NDMxNDM1N30.qMVqh1DPzYFhJx29NtWghqfLGM68JHd3O51nxxWsWPA'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY

function LoginContent() {
    const supabase = createClient()
    const searchParams = useSearchParams()
    const router = useRouter()
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null)

    const formatAuthError = (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error)
        if (text.includes('exceed_cached_egress_quota') || text.includes('Service for this project is restricted')) {
            return 'Supabase の転送量上限によりプロジェクトが制限されています。課金設定または Supabase サポートで制限解除が必要です。'
        }
        return text
    }

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
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user) {
                router.push('/dashboard')
            }
        }
        checkUser()
    }, [supabase, router])

    const handleGoogleLogin = async () => {
        setLoading(true)
        setMessage(null)
        try {
            await checkSupabaseAuthAvailable()
            const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: `${location.origin}/auth/callback`,
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
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            })
            if (error) throw error
            router.push('/dashboard')
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
                    emailRedirectTo: `${location.origin}/auth/callback`,
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
