import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { space_id, title, status = "active", priority = 3 } = body

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
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}
