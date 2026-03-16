import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, textResult, jsonResult } from "../helpers.js"

export function registerTaskTools(server: McpServer, client: ShikumikaClient) {
  const { supabase, userId } = client

  // 1. shikumika_task_list — タスク一覧
  server.tool(
    "shikumika_task_list",
    "タスク一覧を取得する。project_id, status, parent_task_id でフィルタ可能",
    {
      project_id: z.string().optional().describe("プロジェクトIDでフィルタ"),
      status: z.enum(["todo", "done"]).optional().describe("ステータスでフィルタ"),
      parent_task_id: z.string().optional().describe("親タスクIDでフィルタ（サブタスク取得）"),
      limit: z.number().optional().default(50).describe("取得件数（デフォルト50）"),
    },
    async ({ project_id, status, parent_task_id, limit }) => {
      let query = supabase
        .from("tasks")
        .select(
          "id, title, status, stage, priority, estimated_time, scheduled_at, parent_task_id, project_id, is_group, is_habit, memo"
        )
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("order_index", { ascending: true })
        .limit(limit ?? 50)

      if (project_id) query = query.eq("project_id", project_id)
      if (status) query = query.eq("status", status)
      if (parent_task_id) query = query.eq("parent_task_id", parent_task_id)

      const { data, error } = await query

      if (error) return errorResult(error.message)
      return jsonResult(data, `${data.length}件のタスクを取得しました`)
    }
  )

  // 2. shikumika_task_create — タスク作成
  server.tool(
    "shikumika_task_create",
    "新しいタスクを作成する",
    {
      title: z.string().describe("タスクのタイトル（必須）"),
      project_id: z.string().optional().describe("所属プロジェクトID"),
      parent_task_id: z.string().optional().describe("親タスクID（サブタスクの場合）"),
      priority: z.number().min(1).max(5).optional().describe("優先度 1-5"),
      estimated_time: z.number().optional().describe("見積もり時間（分）"),
      scheduled_at: z.string().optional().describe("予定日時（ISO 8601）"),
      memo: z.string().optional().describe("メモ"),
    },
    async ({ title, project_id, parent_task_id, priority, estimated_time, scheduled_at, memo }) => {
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title,
          status: "todo",
          stage: "plan",
          source: "manual",
          project_id: project_id ?? null,
          parent_task_id: parent_task_id ?? null,
          priority: priority ?? null,
          estimated_time: estimated_time ?? 0,
          scheduled_at: scheduled_at ?? null,
          memo: memo ?? null,
        })
        .select("id, title")
        .single()

      if (error) return errorResult(error.message)
      return textResult(`タスク「${data.title}」を作成しました (ID: ${data.id})`)
    }
  )

  // 3. shikumika_task_update — タスク更新
  server.tool(
    "shikumika_task_update",
    "既存のタスクを更新する",
    {
      id: z.string().describe("タスクID（必須）"),
      title: z.string().optional().describe("タイトル"),
      status: z.enum(["todo", "done"]).optional().describe("ステータス"),
      stage: z
        .enum(["plan", "scheduled", "executing", "done", "archived"])
        .optional()
        .describe("ステージ"),
      priority: z.number().min(1).max(5).optional().describe("優先度 1-5"),
      estimated_time: z.number().optional().describe("見積もり時間（分）"),
      scheduled_at: z.string().optional().describe("予定日時（ISO 8601）"),
      memo: z.string().optional().describe("メモ"),
    },
    async ({ id, title, status, stage, priority, estimated_time, scheduled_at, memo }) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (title !== undefined) updates.title = title
      if (status !== undefined) updates.status = status
      if (stage !== undefined) updates.stage = stage
      if (priority !== undefined) updates.priority = priority
      if (estimated_time !== undefined) updates.estimated_time = estimated_time
      if (scheduled_at !== undefined) updates.scheduled_at = scheduled_at
      if (memo !== undefined) updates.memo = memo

      const { data, error } = await supabase
        .from("tasks")
        .update(updates)
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, title")
        .single()

      if (error) return errorResult(error.message)
      return textResult(`タスク「${data.title}」を更新しました (ID: ${data.id})`)
    }
  )

  // 4. shikumika_task_complete — タスク完了
  server.tool(
    "shikumika_task_complete",
    "タスクを完了にする",
    {
      id: z.string().describe("タスクID（必須）"),
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("tasks")
        .update({
          status: "done",
          stage: "done",
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, title")
        .single()

      if (error) return errorResult(error.message)
      return textResult(`タスク「${data.title}」を完了しました (ID: ${data.id})`)
    }
  )

  // 5. shikumika_task_delete — タスク削除（論理削除）
  server.tool(
    "shikumika_task_delete",
    "タスクを論理削除する（deleted_at を設定）",
    {
      id: z.string().describe("タスクID（必須）"),
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", userId)
        .select("id, title")
        .single()

      if (error) return errorResult(error.message)
      return textResult(`タスク「${data.title}」を削除しました (ID: ${data.id})`)
    }
  )

  // 6. shikumika_task_search — タスク名検索
  server.tool(
    "shikumika_task_search",
    "タスクをタイトルで部分一致検索する",
    {
      query: z.string().describe("検索キーワード（必須）"),
    },
    async ({ query }) => {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, title, status, stage, priority, estimated_time, scheduled_at, parent_task_id, project_id, is_group, is_habit, memo"
        )
        .eq("user_id", userId)
        .is("deleted_at", null)
        .ilike("title", `%${query}%`)
        .order("order_index", { ascending: true })

      if (error) return errorResult(error.message)
      return jsonResult(data, `「${query}」で${data.length}件のタスクが見つかりました`)
    }
  )
}
