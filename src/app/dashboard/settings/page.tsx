import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsOverview } from "@/components/settings/settings-overview"

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return <SettingsOverview />
}
