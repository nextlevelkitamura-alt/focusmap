import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsHeader } from "@/components/settings/settings-header"
import { CalendarSettings } from "@/components/dashboard/calendar-settings"
import { NotificationSettings } from "@/components/notifications"

export default async function IntegrationsSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <SettingsHeader title="連携" />
      <div className="space-y-6 pt-4">
        <section id="calendar" className="scroll-mt-20">
          <CalendarSettings />
        </section>
        <section id="notifications" className="scroll-mt-20">
          <NotificationSettings />
        </section>
      </div>
    </div>
  )
}
