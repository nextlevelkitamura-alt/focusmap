import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import { Bell, Bot, Brain, Calendar, Key, Palette, User } from "lucide-react"
import { CalendarSettings } from "@/components/dashboard/calendar-settings"
import { NotificationSettings } from "@/components/notifications"
import { AiContextSettings } from "@/components/settings/ai-context-settings"
import { ThemeSettings } from "@/components/settings/theme-settings"
import { AccountSettings } from "@/components/settings/account-settings"
import { ApiKeySettings } from "@/components/settings/api-key-settings"
import { AiModelSettings } from "@/components/settings/ai-model-settings"

const SETTING_GROUPS = [
    {
        id: "ai",
        label: "AI",
        description: "モデルとAIに渡す情報",
        items: [
            { id: "ai-model", label: "AIモデル", icon: Bot },
            { id: "ai-context", label: "コンテキスト", icon: Brain },
        ],
    },
    {
        id: "workflow",
        label: "連携",
        description: "カレンダーと通知",
        items: [
            { id: "calendar", label: "カレンダー", icon: Calendar },
            { id: "notifications", label: "通知", icon: Bell },
        ],
    },
    {
        id: "access",
        label: "アクセス",
        description: "APIキーとアカウント",
        items: [
            { id: "api-keys", label: "APIキー", icon: Key },
            { id: "account", label: "アカウント", icon: User },
        ],
    },
    {
        id: "appearance",
        label: "表示",
        description: "画面の見た目",
        items: [
            { id: "theme", label: "テーマ", icon: Palette },
        ],
    },
]

export default async function SettingsPage() {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    return (
        <div className="flex-1 overflow-y-auto bg-background">
            <div className="mx-auto w-full max-w-6xl px-4 py-4 md:px-6 md:py-6">
                <div className="mb-5">
                    <h1 className="text-xl font-semibold md:text-2xl">設定</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        AI、連携、通知、表示をまとめて管理します。
                    </p>
                </div>

                <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <aside className="lg:sticky lg:top-4 lg:self-start">
                        <nav className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2 lg:overflow-visible lg:pb-0">
                            {SETTING_GROUPS.map(group => (
                                <div
                                    key={group.id}
                                    className="min-w-[190px] shrink-0 rounded-lg border bg-card p-2 lg:min-w-0"
                                >
                                    <a href={`#${group.id}`} className="block rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
                                        <div className="text-sm font-medium">{group.label}</div>
                                        <div className="mt-0.5 text-xs text-muted-foreground">{group.description}</div>
                                    </a>
                                    <div className="mt-1 space-y-0.5">
                                        {group.items.map(item => {
                                            const Icon = item.icon
                                            return (
                                                <a
                                                    key={item.id}
                                                    href={`#${item.id}`}
                                                    className="flex min-h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                                                >
                                                    <Icon className="h-3.5 w-3.5" />
                                                    {item.label}
                                                </a>
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}
                        </nav>
                    </aside>

                    <main className="space-y-6">
                        <SettingsGroup id="ai" label="AI" description="思考メモの整理品質と、AIが参照する情報を設定します。">
                            <div id="ai-model" className="scroll-mt-4">
                                <AiModelSettings />
                            </div>
                            <div id="ai-context" className="scroll-mt-4">
                                <AiContextSettings />
                            </div>
                        </SettingsGroup>

                        <SettingsGroup id="workflow" label="連携" description="予定登録、通知、外部サービスとのつながりを設定します。">
                            <div id="calendar" className="scroll-mt-4">
                                <CalendarSettings />
                            </div>
                            <div id="notifications" className="scroll-mt-4">
                                <NotificationSettings />
                            </div>
                        </SettingsGroup>

                        <SettingsGroup id="access" label="アクセス" description="外部アプリから使うキーとアカウント情報を管理します。">
                            <div id="api-keys" className="scroll-mt-4">
                                <ApiKeySettings />
                            </div>
                            <div id="account" className="scroll-mt-4">
                                <AccountSettings userEmail={user.email} />
                            </div>
                        </SettingsGroup>

                        <SettingsGroup id="appearance" label="表示" description="画面の見た目と操作感を調整します。">
                            <div id="theme" className="scroll-mt-4">
                                <ThemeSettings />
                            </div>
                        </SettingsGroup>
                    </main>
                </div>
            </div>
        </div>
    )
}

function SettingsGroup({
    id,
    label,
    description,
    children,
}: {
    id: string
    label: string
    description: string
    children: ReactNode
}) {
    return (
        <section id={id} className="scroll-mt-4">
            <div className="mb-3">
                <h2 className="text-base font-semibold">{label}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            </div>
            <div className="space-y-3">{children}</div>
        </section>
    )
}
