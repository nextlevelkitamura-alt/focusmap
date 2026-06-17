import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { SettingsShell } from "@/components/settings/settings-shell"
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
    <SettingsShell
      title="プロジェクト"
      description="AI作業の実行先、repo path、プロジェクト文脈、色の識別を管理します。"
      className="max-w-[1120px]"
    >
      <ProjectSettings
        initialProjects={projectsResult.data ?? []}
        initialSpaces={spacesResult.data ?? []}
      />
    </SettingsShell>
  )
}
