import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { NotificationSettings } from "@/components/notifications"

export default async function SettingsPage() {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    return (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="max-w-2xl mx-auto space-y-6">
                <div>
                    <h1 className="text-2xl font-bold">設定</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        アプリケーションの設定を管理できます
                    </p>
                </div>

                <NotificationSettings />
            </div>
        </div>
    )
}
