import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

// GET /api/scan-settings — ユーザー × ホスト ごとのスキャン対象パス
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data, error } = await supabase
    .from("user_scan_settings")
    .select("hostname, scan_paths, last_scanned_at, scan_now_requested_at")
    .eq("user_id", user.id)
    .order("hostname")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

// PUT /api/scan-settings — 指定ホストのスキャン対象パスを上書き
export async function PUT(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const { hostname, scan_paths } = body as { hostname?: string; scan_paths?: string[] }

  if (!hostname || typeof hostname !== "string") {
    return NextResponse.json({ error: "hostname is required" }, { status: 400 })
  }
  if (!Array.isArray(scan_paths)) {
    return NextResponse.json({ error: "scan_paths must be an array" }, { status: 400 })
  }
  // 不正な空文字列を除去
  const cleaned = scan_paths.map(p => String(p).trim()).filter(p => p.length > 0)

  const { data, error } = await supabase
    .from("user_scan_settings")
    .upsert({
      user_id: user.id,
      hostname,
      scan_paths: cleaned,
    }, { onConflict: "user_id,hostname" })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
