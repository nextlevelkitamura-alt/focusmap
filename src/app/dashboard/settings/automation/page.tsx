import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { AutomationSettings } from "@/components/settings/automation-settings"

export default async function AutomationSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SettingsShell
      title="AI"
      description="Macエージェントのオンライン状態、巡回更新、Codex連携を確認します。"
      className="max-w-[1120px]"
    >
      <AutomationSettings />
    </SettingsShell>
  )
}
