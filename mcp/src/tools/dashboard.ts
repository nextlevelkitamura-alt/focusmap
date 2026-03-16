import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, textResult } from "../helpers.js"

export function registerDashboardTools(
  server: McpServer,
  client: ShikumikaClient
) {
  const { supabase, userId } = client

  // ── shikumika_today_summary ──
  server.tool(
    "shikumika_today_summary",
    "今日のサマリーを取得する。スケジュール済みタスク・未完了タスク数・カレンダーイベント・習慣完了状況をまとめて返す。",
    {},
    async () => {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Tokyo",
      })
      const todayStart = `${today}T00:00:00+09:00`
      const todayEnd = `${today}T23:59:59+09:00`

      // 並列で4つのクエリを実行
      const [scheduledRes, todoCountRes, calendarRes, habitsRes] =
        await Promise.all([
          // a. 今日のスケジュール済みタスク
          supabase
            .from("tasks")
            .select("id, title, status, scheduled_at")
            .eq("user_id", userId)
            .is("deleted_at", null)
            .gte("scheduled_at", todayStart)
            .lte("scheduled_at", todayEnd)
            .order("scheduled_at", { ascending: true }),

          // b. 未完了タスク数
          supabase
            .from("tasks")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .eq("status", "todo")
            .is("deleted_at", null),

          // c. 今日のカレンダーイベント
          supabase
            .from("calendar_events")
            .select("id, title, start_time, end_time, all_day")
            .eq("user_id", userId)
            .gte("start_time", todayStart)
            .lte("start_time", todayEnd)
            .order("start_time", { ascending: true }),

          // d. 習慣タスク + 今日の完了状況
          supabase
            .from("tasks")
            .select(
              "id, title, habit_completions(id, completed_date)"
            )
            .eq("user_id", userId)
            .eq("is_habit", true)
            .is("deleted_at", null)
            .gte("habit_completions.completed_date", today)
            .lte("habit_completions.completed_date", today),
        ])

      // エラーチェック
      for (const res of [scheduledRes, todoCountRes, calendarRes, habitsRes]) {
        if (res.error) return errorResult(res.error.message)
      }

      const scheduled = scheduledRes.data ?? []
      const todoCount = todoCountRes.count ?? 0
      const calendar = calendarRes.data ?? []
      const habits = (habitsRes.data ?? []) as Array<{
        id: string
        title: string
        habit_completions: Array<{ id: string; completed_date: string }>
      }>

      // フォーマット
      const lines: string[] = []

      lines.push(`Today's Summary (${today})`)
      lines.push("")

      // スケジュール済みタスク
      lines.push(`Scheduled Tasks (${scheduled.length})`)
      if (scheduled.length === 0) {
        lines.push("  (none)")
      } else {
        for (const t of scheduled) {
          const time = t.scheduled_at
            ? new Date(t.scheduled_at).toLocaleTimeString("ja-JP", {
                timeZone: "Asia/Tokyo",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "--:--"
          lines.push(`  - ${time} ${t.title} [${t.status}]`)
        }
      }
      lines.push("")

      // 未完了タスク
      lines.push(`Incomplete Tasks: ${todoCount}`)
      lines.push("")

      // カレンダーイベント
      lines.push(`Calendar Events (${calendar.length})`)
      if (calendar.length === 0) {
        lines.push("  (none)")
      } else {
        for (const e of calendar) {
          if (e.all_day) {
            lines.push(`  - (all day) ${e.title}`)
          } else {
            const start = new Date(e.start_time).toLocaleTimeString("ja-JP", {
              timeZone: "Asia/Tokyo",
              hour: "2-digit",
              minute: "2-digit",
            })
            const end = new Date(e.end_time).toLocaleTimeString("ja-JP", {
              timeZone: "Asia/Tokyo",
              hour: "2-digit",
              minute: "2-digit",
            })
            lines.push(`  - ${start}-${end} ${e.title}`)
          }
        }
      }
      lines.push("")

      // 習慣
      const habitsDone = habits.filter(
        (h) => h.habit_completions && h.habit_completions.length > 0
      ).length
      lines.push(`Habits (${habitsDone}/${habits.length})`)
      if (habits.length === 0) {
        lines.push("  (none)")
      } else {
        for (const h of habits) {
          const done =
            h.habit_completions && h.habit_completions.length > 0
          lines.push(`  - ${h.title}: ${done ? "done" : "not yet"}`)
        }
      }

      return textResult(lines.join("\n"))
    }
  )
}
