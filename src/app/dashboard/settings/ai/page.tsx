import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsHeader } from "@/components/settings/settings-header"
import { AiModelSettings } from "@/components/settings/ai-model-settings"
import { AiContextSettings } from "@/components/settings/ai-context-settings"

export default async function AiSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <SettingsHeader title="AI" />
      <div className="space-y-6 pt-4">
        <section id="ai-model" className="scroll-mt-20">
          <AiModelSettings />
        </section>
        <section id="ai-context" className="scroll-mt-20">
          <AiContextSettings />
        </section>
      </div>
    </div>
  )
}
