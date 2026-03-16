import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, jsonResult } from "../helpers.js"

export function registerProjectTools(
  server: McpServer,
  client: ShikumikaClient
) {
  const { supabase, userId } = client

  // ── shikumika_project_list ──
  server.tool(
    "shikumika_project_list",
    "プロジェクト一覧を取得する。space_id や status でフィルタ可能。",
    {
      space_id: z.string().uuid().optional().describe("スペースIDでフィルタ"),
      status: z.string().optional().describe("ステータスでフィルタ"),
    },
    async ({ space_id, status }) => {
      let query = supabase
        .from("projects")
        .select("id, title, purpose, status, priority, space_id, created_at")
        .eq("user_id", userId)
        .order("priority", { ascending: true })

      if (space_id) query = query.eq("space_id", space_id)
      if (status) query = query.eq("status", status)

      const { data, error } = await query

      if (error) return errorResult(error.message)
      return jsonResult(data, `${data.length}件のプロジェクト`)
    }
  )

  // ── shikumika_project_create ──
  server.tool(
    "shikumika_project_create",
    "新しいプロジェクトを作成する。",
    {
      title: z.string().describe("プロジェクト名"),
      space_id: z.string().uuid().describe("所属スペースのID"),
      purpose: z.string().optional().describe("プロジェクトの目的"),
      priority: z
        .number()
        .int()
        .optional()
        .default(3)
        .describe("優先度 (1=最高, 5=最低, default=3)"),
    },
    async ({ title, space_id, purpose, priority }) => {
      const { data, error } = await supabase
        .from("projects")
        .insert({
          user_id: userId,
          title,
          space_id,
          purpose,
          priority,
        })
        .select("id, title, space_id, priority")
        .single()

      if (error) return errorResult(error.message)
      return jsonResult(data, `プロジェクト「${data.title}」を作成しました`)
    }
  )

  // ── shikumika_project_update ──
  server.tool(
    "shikumika_project_update",
    "既存プロジェクトを更新する。変更したいフィールドのみ指定。",
    {
      id: z.string().uuid().describe("プロジェクトID"),
      title: z.string().optional().describe("プロジェクト名"),
      status: z.string().optional().describe("ステータス"),
      priority: z.number().int().optional().describe("優先度"),
      purpose: z.string().optional().describe("目的"),
    },
    async ({ id, title, status, priority, purpose }) => {
      const updates: Record<string, unknown> = {}
      if (title !== undefined) updates.title = title
      if (status !== undefined) updates.status = status
      if (priority !== undefined) updates.priority = priority
      if (purpose !== undefined) updates.purpose = purpose

      if (Object.keys(updates).length === 0) {
        return errorResult("更新するフィールドを1つ以上指定してください")
      }

      const { data, error } = await supabase
        .from("projects")
        .update(updates)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, title, status, priority, purpose")
        .single()

      if (error) return errorResult(error.message)
      return jsonResult(data, `プロジェクト「${data.title}」を更新しました`)
    }
  )
}
