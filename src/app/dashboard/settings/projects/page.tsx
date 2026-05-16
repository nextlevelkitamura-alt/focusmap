import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsHeader } from "@/components/settings/settings-header"
import { ProjectSettings } from "@/components/settings/project-settings"

export default async function ProjectsSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [projectsResult, spacesResult] = await Promise.all([
    supabase.from("projects").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
    supabase.from("spaces").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
  ])

  return (
    <div className="flex-1 overflow-y-auto bg-background pb-12">
      <SettingsHeader title="プロジェクトとリポジトリ" />
      <div className="pt-4">
        <ProjectSettings
          initialProjects={projectsResult.data ?? []}
          initialSpaces={spacesResult.data ?? []}
        />
      </div>
    </div>
  )
}
