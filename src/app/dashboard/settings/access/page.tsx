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
    <SettingsShell
      title="アクセス/API"
      description="外部AIに渡すAPIキー、scope、アカウント操作をリスク別に管理します。"
      className="max-w-[1180px]"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section id="api-keys" className="scroll-mt-20">
          <ApiKeySettings />
        </section>
        <aside id="account" className="scroll-mt-20 xl:sticky xl:top-8 xl:self-start">
          <AccountSettings userEmail={user.email} />
        </aside>
      </div>
    </SettingsShell>
  )
}
