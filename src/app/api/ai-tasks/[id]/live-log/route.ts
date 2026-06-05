import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { authenticateSupabaseRequest } from "@/lib/auth/verify-supabase-jwt"
import { isTursoConfigured } from "@/lib/turso/client"
import { getTursoTaskForAuth, listTaskProgress } from "@/lib/turso/codex-monitoring"
import { promises as fs } from "fs"
import path from "path"

// GET /api/ai-tasks/:id/live-log
// Mac ローカルの tmux ログファイルの末尾を読んで返す（Codex 実行中の進捗確認用）
// 注: このAPIは Cloud Run 上では動かない（ファイルシステムアクセス前提）
//   Mac で Next.js dev サーバーが localhost で動いている場合のみ意味あり
//   または将来、task-runner が定期的に DB の result.live_log にダンプする実装に切替可
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { user } = auth

  const { id } = await params

  if (isTursoConfigured()) {
    try {
      const tursoTask = await getTursoTaskForAuth(id, {
        userId: user.id,
        supabase,
      })
      if (tursoTask) {
        const progress = await listTaskProgress(tursoTask.id, tursoTask.user_id, 20)
        const log = progress
          .slice()
          .reverse()
          .map(item => item.message)
          .filter((message): message is string => typeof message === "string" && message.length > 0)
          .join("\n")
          .slice(-4_000)

        if (log || tursoTask.current_step || tursoTask.summary) {
          return NextResponse.json({
            id,
            executor: tursoTask.executor,
            status: tursoTask.status,
            log: log || tursoTask.current_step || tursoTask.summary || "",
            source: "turso",
          })
        }
      }
    } catch (tursoError) {
      console.error("[ai-tasks/live-log turso]", tursoError)
    }
  }

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
    .select("result_message:result->>message, result_live_log:result->>live_log")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  const result = (full ?? {}) as { result_live_log?: string; result_message?: string }

  // 完了済みなら message、実行中なら live_log を返す
  const log = task.status === "completed" || task.status === "failed"
    ? (result.result_message ?? "")
    : (result.result_live_log ?? "")

  // 安全のため pathは未使用扱い（将来のローカル拡張用にimportは残す）
  void fs
  void path

  return NextResponse.json({
    id,
    executor: task.executor,
    status: task.status,
    log,
    source: "supabase",
  })
}
