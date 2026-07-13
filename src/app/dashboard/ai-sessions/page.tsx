import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { AiSessionsView } from "@/components/ai-sessions/ai-sessions-view"

export default async function AiSessionsPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // 箱の段階: データ取得はまだ繋がない（personal-os Tursoの読み取りAPIは次フェーズ）
    return <AiSessionsView />
}
