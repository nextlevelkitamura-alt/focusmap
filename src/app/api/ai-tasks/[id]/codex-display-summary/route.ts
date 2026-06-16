import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { authenticateSupabaseRequest } from "@/lib/auth/verify-supabase-jwt"
import { generateCodexDisplaySummary } from "@/lib/ai/codex-display-summary"
import { createClient } from "@/utils/supabase/server"

const SUMMARY_MESSAGE_SCHEMA = z.object({
  role: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  body: z.string().max(4_000),
  created_at: z.string().nullable().optional(),
})

const SUMMARY_INPUT_SCHEMA = z.object({
  title: z.string().max(240),
  status: z.string().nullable().optional(),
  statusLabel: z.string().nullable().optional(),
  snippet: z.string().nullable().optional(),
  detailText: z.string().nullable().optional(),
  messages: z.array(SUMMARY_MESSAGE_SCHEMA).max(30).default([]),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { user } = auth

  const { data: task, error } = await supabase
    .from("ai_tasks")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) {
    console.error("[ai-tasks/codex-display-summary]", error.message)
    return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
  }
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const rawBody = await req.json().catch(() => null)
  const parsed = SUMMARY_INPUT_SCHEMA.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid summary input" }, { status: 400 })
  }

  const result = await generateCodexDisplaySummary(parsed.data)
  return NextResponse.json(result)
}
