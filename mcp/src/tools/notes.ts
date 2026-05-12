import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ShikumikaClient } from "../client.js"
import { errorResult, jsonResult } from "../helpers.js"

const NOTE_STATUSES = ["pending", "processed", "archived"] as const
const INPUT_TYPES = ["text", "voice"] as const

export function registerNoteTools(server: McpServer, client: ShikumikaClient) {
  const { supabase, userId } = client

  async function resolveProjectId(projectId?: string, projectTitle?: string) {
    if (projectId) return { projectId }
    if (!projectTitle) return { projectId: undefined }

    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .eq("title", projectTitle)
      .maybeSingle()

    if (error) return { error: error.message }
    return { projectId: data?.id as string | undefined }
  }

  server.tool(
    "shikumika_note_list",
    "メモ一覧を取得する。project_id / project_title / status / input_type / q でフィルタ可能。SNS投稿素材は project_title='SNS投稿', status='pending' で取得する。",
    {
      project_id: z.string().uuid().optional().describe("プロジェクトIDでフィルタ"),
      project_title: z.string().optional().describe("プロジェクト名でフィルタ（例: SNS投稿）"),
      status: z.enum(NOTE_STATUSES).optional().describe("pending / processed / archived"),
      input_type: z.enum(INPUT_TYPES).optional().describe("text / voice"),
      q: z.string().optional().describe("本文の部分一致検索"),
      include_archived: z.boolean().optional().default(false).describe("status 未指定時に利用済みも含める"),
      limit: z.number().int().min(1).max(200).optional().default(50),
    },
    async ({ project_id, project_title, status, input_type, q, include_archived, limit }) => {
      const resolved = await resolveProjectId(project_id, project_title)
      if (resolved.error) return errorResult(resolved.error)
      if (project_title && !resolved.projectId) return jsonResult([], `プロジェクト「${project_title}」は見つかりませんでした`)

      let query = supabase
        .from("notes")
        .select("id, project_id, content, raw_input, input_type, status, ai_analysis, created_at, updated_at")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(limit ?? 50)

      if (resolved.projectId) query = query.eq("project_id", resolved.projectId)
      if (status) query = query.eq("status", status)
      else if (!include_archived) query = query.neq("status", "archived")
      if (input_type) query = query.eq("input_type", input_type)
      if (q) query = query.ilike("content", `%${q}%`)

      const { data, error } = await query
      if (error) return errorResult(error.message)
      return jsonResult(data, `${data.length}件のメモを取得しました`)
    }
  )

  server.tool(
    "shikumika_note_create",
    "新しいメモを作成する。project_title='SNS投稿' のようにプロジェクト名でも紐付け可能。",
    {
      content: z.string().describe("メモ本文"),
      project_id: z.string().uuid().optional().describe("プロジェクトID"),
      project_title: z.string().optional().describe("プロジェクト名（例: SNS投稿）"),
      input_type: z.enum(INPUT_TYPES).optional().default("text"),
      raw_input: z.string().optional().describe("音声認識などの生テキスト"),
    },
    async ({ content, project_id, project_title, input_type, raw_input }) => {
      const trimmed = content.trim()
      if (!trimmed) return errorResult("content is required")

      const resolved = await resolveProjectId(project_id, project_title)
      if (resolved.error) return errorResult(resolved.error)
      if (project_title && !resolved.projectId) return errorResult(`プロジェクト「${project_title}」は見つかりませんでした`)

      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: userId,
          content: trimmed,
          raw_input: raw_input ?? null,
          input_type: input_type ?? "text",
          project_id: resolved.projectId ?? null,
          status: "pending",
        })
        .select("id, project_id, content, input_type, status, created_at")
        .single()

      if (error) return errorResult(error.message)
      return jsonResult(data, "メモを作成しました")
    }
  )

  server.tool(
    "shikumika_note_mark_used",
    "メモをSNS投稿などで利用済み/未使用に切り替える。利用済みは status='archived' として扱う。",
    {
      id: z.string().uuid().describe("メモID"),
      used: z.boolean().optional().default(true).describe("true=利用済み, false=未使用に戻す"),
    },
    async ({ id, used }) => {
      const { data, error } = await supabase
        .from("notes")
        .update({ status: used ? "archived" : "pending" })
        .eq("id", id)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .select("id, status, updated_at")
        .single()

      if (error) return errorResult(error.message)
      return jsonResult(data, used ? "メモを利用済みにしました" : "メモを未使用に戻しました")
    }
  )
}
