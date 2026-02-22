import { createClient } from "@/utils/supabase/server"
import { redirect } from "next/navigation"
import { DashboardLoader } from "./dashboard-loader"

export default async function DashboardPage() {
    const supabase = await createClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/login')
    }

    // Fetch ALL data (Hierarchical)
    // 1. Spaces
    const { data: spaces } = await supabase
        .from("spaces")
        .select("*")
        .order("created_at", { ascending: false })

    // 2. Projects
    const { data: projects } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: false })

    // 3. Tasks (soft-deleteされたタスクを除外)
    const { data: tasks } = await supabase
        .from("tasks")
        .select("*")
        .is("deleted_at", null)
        .order("priority", { ascending: false })

    return (
        <DashboardLoader
            initialSpaces={spaces || []}
            initialProjects={projects || []}
            initialTasks={tasks || []}
            userId={user.id}
        />
    )
}
