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
      title="自動化"
      description="PC実行、GWS / Google Workspace MCP、Playwright、Google認証、モデル設定をまとめて確認します。"
      className="max-w-[1120px]"
    >
      <AutomationSettings />
    </SettingsShell>
  )
}
