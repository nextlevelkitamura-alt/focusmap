import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { ThemeSettings } from "@/components/settings/theme-settings"

export default async function AppearanceSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SettingsShell title="外観" description="テーマと配色を調整します。">
      <section id="theme" className="max-w-2xl scroll-mt-20">
        <ThemeSettings />
      </section>
    </SettingsShell>
  )
}
