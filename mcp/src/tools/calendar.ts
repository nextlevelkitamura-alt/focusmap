import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, jsonResult } from "../helpers.js"

export function registerCalendarTools(
  server: McpServer,
  client: ShikumikaClient
) {
  const { supabase, userId } = client

  // ── shikumika_calendar_events ──
  server.tool(
    "shikumika_calendar_events",
    "カレンダーイベントを取得する。日付範囲を指定。",
    {
      date_from: z
        .string()
        .describe("開始日 (YYYY-MM-DD)"),
      date_to: z
        .string()
        .describe("終了日 (YYYY-MM-DD)"),
    },
    async ({ date_from, date_to }) => {
      const { data, error } = await supabase
        .from("calendar_events")
        .select(
          "id, title, description, start_time, end_time, all_day, location, calendar_id"
        )
        .eq("user_id", userId)
        .gte("start_time", `${date_from}T00:00:00+09:00`)
        .lte("start_time", `${date_to}T23:59:59+09:00`)
        .order("start_time", { ascending: true })

      if (error) return errorResult(error.message)
      return jsonResult(data, `${data.length}件のカレンダーイベント`)
    }
  )
}
