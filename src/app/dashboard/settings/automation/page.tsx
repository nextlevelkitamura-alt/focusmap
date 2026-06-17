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
      title="AI / 自動化"
      description="Macエージェント、Codex、thread取り込み、予定作成時の確認ルールを管理します。"
      className="max-w-[1120px]"
    >
      <AutomationSettings />
    </SettingsShell>
  )
}
