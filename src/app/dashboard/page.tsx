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

    const [spacesResult, projectsResult, tasksResult] = await Promise.all([
        supabase
            .from("spaces")
            .select("*")
            .order("created_at", { ascending: false }),
        supabase
            .from("projects")
            .select("*")
            .order("created_at", { ascending: false }),
        supabase
            .from("tasks")
            .select("*")
            .is("deleted_at", null)
            .order("priority", { ascending: false, nullsFirst: false })
            .order("order_index", { ascending: true }),
    ])

    const spaces = spacesResult.data
    const projects = projectsResult.data
    const tasks = tasksResult.data

    return (
        <DashboardLoader
            initialSpaces={spaces || []}
            initialProjects={projects || []}
            initialTasks={tasks || []}
            userId={user.id}
        />
    )
}
