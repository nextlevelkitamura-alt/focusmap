import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

// GET /api/ai/memo-chat-logs?memo_id=xxx — 指定メモの過去対話一覧
// GET /api/ai/memo-chat-logs?session_id=xxx — 特定セッションの詳細
export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(req.url)
  const memoId = url.searchParams.get("memo_id")
  const sessionId = url.searchParams.get("session_id")

  if (sessionId) {
    // 個別セッション詳細
    const { data, error } = await supabase
      .from("memo_chat_logs")
      .select("*")
      .eq("user_id", user.id)
      .eq("session_id", sessionId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(data)
  }

  if (!memoId) {
    return NextResponse.json({ error: "memo_id or session_id required" }, { status: 400 })
  }

  // メモごとのセッション一覧（30日以内、新しい順）
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from("memo_chat_logs")
    .select("id, session_id, source_memo_title, turn_count, created_at, updated_at, actions")
    .eq("user_id", user.id)
    .eq("source_memo_id", memoId)
    .gte("updated_at", thirtyDaysAgo)
    .order("updated_at", { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // actions は要約だけ返す（フロント側で全文取得は session 個別取得で）
  const summarized = (data ?? []).map(row => ({
    session_id: row.session_id,
    source_memo_title: row.source_memo_title,
    turn_count: row.turn_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    action_count: Array.isArray(row.actions) ? row.actions.length : 0,
  }))

  return NextResponse.json({ logs: summarized })
}
