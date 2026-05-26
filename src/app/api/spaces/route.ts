import { createClient } from "@/utils/supabase/server"
import { NextResponse } from "next/server"

export async function GET() {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const { data, error } = await supabase
            .from("spaces")
            .select("id, title, color, created_at")
            .order("created_at", { ascending: true })

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        return NextResponse.json({ spaces: data ?? [] })
    } catch (error) {
        console.error("[API] GET /api/spaces error:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
        }

        const body = await request.json()
        const { title, color } = body

        if (!title) {
            return NextResponse.json({ error: "title is required" }, { status: 400 })
        }

        const { data, error } = await supabase
            .from("spaces")
            .insert({
                user_id: user.id,
                title,
                ...(color ? { color } : {}),
            })
            .select()
            .single()

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 })
        }

        await supabase
            .from("space_members")
            .upsert({
                space_id: data.id,
                user_id: user.id,
                role: "owner",
            }, { onConflict: "space_id,user_id" })

        return NextResponse.json(data)
    } catch (error) {
        console.error("[API] POST /api/spaces error:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        )
    }
}
