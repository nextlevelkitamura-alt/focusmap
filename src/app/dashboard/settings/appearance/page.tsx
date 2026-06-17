import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { ThemeSettings } from "@/components/settings/theme-settings"

export default async function AppearanceSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SettingsShell
      title="外観"
      description="低リスクな表示設定を、他の設定詳細と同じsection/row形式で揃えます。"
      className="max-w-[860px]"
    >
      <section id="theme" className="scroll-mt-20">
        <ThemeSettings />
      </section>
    </SettingsShell>
  )
}
