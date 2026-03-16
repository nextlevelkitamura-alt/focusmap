import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, jsonResult } from "../helpers.js"

export function registerSpaceTools(
  server: McpServer,
  client: ShikumikaClient
) {
  const { supabase, userId } = client

  // ── shikumika_space_list ──
  server.tool(
    "shikumika_space_list",
    "スペース一覧を取得する。",
    {},
    async () => {
      const { data, error } = await supabase
        .from("spaces")
        .select("id, title, description, status, icon, color")
        .eq("user_id", userId)

      if (error) return errorResult(error.message)
      return jsonResult(data, `${data.length}件のスペース`)
    }
  )
}
