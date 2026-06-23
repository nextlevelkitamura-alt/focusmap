import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"

// POST /api/scan-settings/trigger — legacy scan設定に再スキャン要求を記録する
//   body: { hostname?: string }（省略時は全ホスト）
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => ({} as { hostname?: string }))
  const hostname = body.hostname

  let q = supabase
    .from("user_scan_settings")
    .update({ scan_now_requested_at: new Date().toISOString() })
    .eq("user_id", user.id)
  if (hostname) q = q.eq("hostname", hostname)

  const { error } = await q
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    message: "再スキャン要求を記録しました。通常のrepo候補はfocusmap-agent heartbeatで反映されます。",
  })
}
