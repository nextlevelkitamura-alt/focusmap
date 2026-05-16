import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsHeader } from "@/components/settings/settings-header"
import { ThemeSettings } from "@/components/settings/theme-settings"

export default async function AppearanceSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <SettingsHeader title="表示" />
      <div className="space-y-6 pt-4">
        <section id="theme" className="scroll-mt-20">
          <ThemeSettings />
        </section>
      </div>
    </div>
  )
}
