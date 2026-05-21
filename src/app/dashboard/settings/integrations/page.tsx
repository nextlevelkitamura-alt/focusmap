import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { CalendarSettings } from "@/components/dashboard/calendar-settings"

export default async function IntegrationsSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SettingsShell
      title="連携"
      description="今はGoogleカレンダーを中心に、連携アカウントと取り込み対象をまとめて管理します。"
      className="max-w-[1120px]"
    >
      <section id="calendar" className="scroll-mt-20">
        <CalendarSettings />
      </section>
    </SettingsShell>
  )
}
