import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { SettingsShell } from "@/components/settings/settings-shell"
import { SpaceSharingSettings } from "@/components/settings/space-sharing-settings"

export default async function SpacesSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: spaces } = await supabase
    .from("spaces")
    .select("*")
    .order("created_at", { ascending: false })

  return (
    <SettingsShell
      title="スペース共有"
      description="メンバー招待と権限を管理します。"
      className="max-w-[900px]"
    >
      <section id="spaces" className="scroll-mt-20">
        <SpaceSharingSettings initialSpaces={spaces ?? []} />
      </section>
    </SettingsShell>
  )
}
