import { redirect } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { SettingsHeader } from "@/components/settings/settings-header"
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
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <SettingsHeader title="Space共有" />
      <div className="pt-4">
        <SpaceSharingSettings initialSpaces={spaces ?? []} />
      </div>
    </div>
  )
}
