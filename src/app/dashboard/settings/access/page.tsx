import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
import { ApiKeySettings } from "@/components/settings/api-key-settings"
import { AccountSettings } from "@/components/settings/account-settings"

export default async function AccessSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <SettingsShell title="アクセス" description="APIキーとアカウント情報を管理します。">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section id="api-keys" className="scroll-mt-20">
          <ApiKeySettings />
        </section>
        <section id="account" className="scroll-mt-20">
          <AccountSettings userEmail={user.email} />
        </section>
      </div>
    </SettingsShell>
  )
}
