import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsHeader } from "@/components/settings/settings-header"
import { ApiKeySettings } from "@/components/settings/api-key-settings"
import { AccountSettings } from "@/components/settings/account-settings"

export default async function AccessSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <SettingsHeader title="アクセス" />
      <div className="space-y-6 pt-4">
        <section id="api-keys" className="scroll-mt-20">
          <ApiKeySettings />
        </section>
        <section id="account" className="scroll-mt-20">
          <AccountSettings userEmail={user.email} />
        </section>
      </div>
    </div>
  )
}
