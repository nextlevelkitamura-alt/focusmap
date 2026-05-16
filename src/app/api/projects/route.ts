import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server"
import { createProjectContextFolder } from "@/lib/ai/context/create-project-context"

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const body = await request.json()
        const { space_id, title, status = "active", priority = 3, color_theme, repo_path } = body

        if (!space_id || !title) {
            return NextResponse.json({ error: "space_id and title are required" }, { status: 400 })
        }

        const { data, error } = await supabase
            .from("projects")
            .insert({
                user_id: user.id,
                space_id,
                title,
                status,
                priority,
                ...(color_theme ? { color_theme } : {}),
                ...(repo_path !== undefined ? { repo_path: repo_path || null } : {}),
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        // AIコンテキストフォルダを自動作成（バックグラウンド、失敗してもプロジェクト作成は成功扱い）
        createProjectContextFolder(supabase, user.id, data.id, title).catch(err => {
            console.error('[API] Failed to create project context folder:', err)
        })

        return NextResponse.json(data)
    } catch (error) {
        console.error("[API] POST /api/projects error:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}
