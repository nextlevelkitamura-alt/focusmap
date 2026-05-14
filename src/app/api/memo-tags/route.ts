import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { DEFAULT_TAG_COLOR, getTagColorFromName, normalizeColor } from "@/lib/color-utils"

type MemoTagRow = {
  id: string
  name: string
  color: string
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.includes("memo_tags") === true
}

async function getUser() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return { supabase, user, error }
}

export async function GET() {
  const { supabase, user, error } = await getUser()
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tagMap = new Map<string, { id: string | null; name: string; color: string; persisted: boolean }>()

  const saved = await supabase
    .from("memo_tags")
    .select("id, name, color")
    .eq("user_id", user.id)
    .order("name", { ascending: true })

  if (saved.error && !isMissingTable(saved.error)) {
    return NextResponse.json({ error: saved.error.message }, { status: 500 })
  }

  for (const tag of (saved.data ?? []) as MemoTagRow[]) {
    tagMap.set(tag.name, {
      id: tag.id,
      name: tag.name,
      color: normalizeColor(tag.color, DEFAULT_TAG_COLOR),
      persisted: true,
    })
  }

  const { data: memoRows } = await supabase
    .from("ideal_goals")
    .select("category, tags")
    .eq("user_id", user.id)
    .in("status", ["wishlist", "memo"])

  for (const row of memoRows ?? []) {
    const names = [row.category, ...(Array.isArray(row.tags) ? row.tags : [])]
    for (const rawName of names) {
      const name = typeof rawName === "string" ? rawName.trim() : ""
      if (!name || tagMap.has(name)) continue
      tagMap.set(name, {
        id: null,
        name,
        color: getTagColorFromName(name),
        persisted: false,
      })
    }
  }

  return NextResponse.json({
    tags: [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
  })
}

export async function POST(request: NextRequest) {
  const { supabase, user, error } = await getUser()
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const name = typeof body.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "タグ名は必須です" }, { status: 400 })

  const color = normalizeColor(typeof body.color === "string" ? body.color : null, getTagColorFromName(name))
  const { data, error: upsertError } = await supabase
    .from("memo_tags")
    .upsert({ user_id: user.id, name, color }, { onConflict: "user_id,name" })
    .select("id, name, color")
    .single()

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({
    tag: {
      id: data.id,
      name: data.name,
      color: normalizeColor(data.color, color),
      persisted: true,
    },
  })
}

export async function DELETE(request: NextRequest) {
  const { supabase, user, error } = await getUser()
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const name = request.nextUrl.searchParams.get("name")?.trim()
  if (!name) return NextResponse.json({ error: "タグ名は必須です" }, { status: 400 })

  const { error: deleteError } = await supabase
    .from("memo_tags")
    .delete()
    .eq("user_id", user.id)
    .eq("name", name)

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
