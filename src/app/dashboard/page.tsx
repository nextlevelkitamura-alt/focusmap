import { createClient } from "@/utils/supabase/server"
import { DashboardClient } from "./dashboard-client"
import { redirect } from "next/navigation"

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

    // 3. Groups
    const { data: groups } = await supabase
        .from("task_groups")
        .select("*")
        .order("order_index")

    // 4. Tasks
    const { data: tasks } = await supabase
        .from("tasks")
        .select("*")
        .order("priority", { ascending: false })

    return (
        <DashboardClient
            initialSpaces={spaces || []}
            initialProjects={projects || []}
            initialGroups={groups || []}
            initialTasks={tasks || []}
            userId={user.id}
        />
    )
}

