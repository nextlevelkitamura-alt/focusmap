import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { AiModelSettings } from "@/components/settings/ai-model-settings"
import { AiContextSettings } from "@/components/settings/ai-context-settings"

export default async function AiSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SettingsShell
      title="AI"
      description="モデル選択と、AIが判断に使うコンテキストを同じ画面で確認できます。"
      className="max-w-[1120px]"
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
        <section id="ai-model" className="scroll-mt-20">
          <AiModelSettings />
        </section>
        <section id="ai-context" className="scroll-mt-20">
          <AiContextSettings />
        </section>
      </div>
    </SettingsShell>
  )
}
