import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, jsonResult } from "../helpers.js"

export function registerHabitTools(
  server: McpServer,
  client: ShikumikaClient
) {
  const { supabase, userId } = client

  // ── shikumika_habit_list ──
  server.tool(
    "shikumika_habit_list",
    "習慣一覧を完了状況付きで取得する。from/to で期間を指定すると各習慣の完了日配列を含む。",
    {
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("開始日 (YYYY-MM-DD)"),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("終了日 (YYYY-MM-DD)"),
    },
    async ({ from, to }) => {
      // 習慣タスクを取得
      const { data: habits, error: habitsError } = await supabase
        .from("tasks")
        .select(
          "id, title, habit_frequency, habit_icon, habit_start_date, habit_end_date, status"
        )
        .eq("user_id", userId)
        .eq("is_habit", true)

      if (habitsError) return errorResult(habitsError.message)
      if (!habits || habits.length === 0) {
        return jsonResult([], "習慣が登録されていません")
      }

      // from/to が指定されていない場合は習慣リストのみ返す
      if (!from && !to) {
        const result = habits.map((h) => ({ ...h, completions: [] }))
        return jsonResult(result, `${habits.length}件の習慣`)
      }

      // 完了記録を取得
      const habitIds = habits.map((h) => h.id)
      let compQuery = supabase
        .from("habit_completions")
        .select("habit_id, completed_date")
        .eq("user_id", userId)
        .in("habit_id", habitIds)

      if (from) compQuery = compQuery.gte("completed_date", from)
      if (to) compQuery = compQuery.lte("completed_date", to)

      const { data: completions, error: compError } = await compQuery

      if (compError) return errorResult(compError.message)

      // 習慣ごとに完了日をマージ
      const completionMap = new Map<string, string[]>()
      for (const c of completions ?? []) {
        const dates = completionMap.get(c.habit_id) ?? []
        dates.push(c.completed_date)
        completionMap.set(c.habit_id, dates)
      }

      const result = habits.map((h) => ({
        ...h,
        completions: completionMap.get(h.id) ?? [],
      }))

      const totalCompletions = completions?.length ?? 0
      return jsonResult(
        result,
        `${habits.length}件の習慣 (期間内の完了: ${totalCompletions}件)`
      )
    }
  )
}
