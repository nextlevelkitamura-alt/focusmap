import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { ContextManager } from "@/components/settings/context-manager"

export default async function AiContextPage() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    return <ContextManager />
}
