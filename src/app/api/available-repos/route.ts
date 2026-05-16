import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

// GET /api/available-repos — task-runner が発見した、ログインユーザーが所有するMacのリポ一覧
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("available_repos")
    .select("id, hostname, absolute_path, display_name, last_git_commit_at, last_seen_at")
    .eq("user_id", user.id)
    .order("last_git_commit_at", { ascending: false, nullsFirst: false })
    .order("display_name")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}
