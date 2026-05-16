import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { promises as fs } from "fs"
import path from "path"

// GET /api/ai-tasks/:id/live-log
// Mac ローカルの tmux ログファイルの末尾を読んで返す（Codex 実行中の進捗確認用）
// 注: このAPIは Cloud Run 上では動かない（ファイルシステムアクセス前提）
//   Mac で Next.js dev サーバーが localhost で動いている場合のみ意味あり
//   または将来、task-runner が定期的に DB の result.live_log にダンプする実装に切替可
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  // 所有確認 + executor 取得
  const { data: task } = await supabase
    .from("ai_tasks")
    .select("id, executor, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 })

  // result.live_log カラムから取得（task-runner が定期的に書き込む方式）
  const { data: full } = await supabase
    .from("ai_tasks")
    .select("result")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  const result = (full?.result ?? {}) as { live_log?: string; message?: string }

  // 完了済みなら message、実行中なら live_log を返す
  const log = task.status === "completed" || task.status === "failed"
    ? (result.message ?? "")
    : (result.live_log ?? "")

  // 安全のため pathは未使用扱い（将来のローカル拡張用にimportは残す）
  void fs
  void path

  return NextResponse.json({
    id,
    executor: task.executor,
    status: task.status,
    log,
  })
}
