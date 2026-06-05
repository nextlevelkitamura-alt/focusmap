import { generateText } from "ai"
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { authenticateSupabaseRequest } from "@/lib/auth/verify-supabase-jwt"
import { getModelForSkill, resolveGeminiModel } from "@/lib/ai/providers"
import {
  collectProgressEvidence,
  deterministicProgress,
  isRecord,
  normalizeGeminiProgress,
  progressObservationPayload,
  type AiTaskProgressTask,
} from "@/lib/ai-task-progress"

export const runtime = "nodejs"

function firstBalancedJson(source: string) {
  const start = source.search(/\{/)
  if (start < 0) return null
  const stack: string[] = []
  let inString = false
  let escaped = false

  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === "\"") inString = false
      continue
    }
    if (ch === "\"") {
      inString = true
      continue
    }
    if (ch === "{") stack.push("}")
    if (ch === "}") {
      if (stack.pop() !== ch) return null
      if (stack.length === 0) return source.slice(start, i + 1)
    }
  }
  return null
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? raw
  const candidate = firstBalancedJson(fenced.trim())
  if (!candidate) throw new Error("Gemini response did not include a JSON object")
  const parsed = JSON.parse(candidate)
  if (!isRecord(parsed)) throw new Error("Gemini response JSON is not an object")
  return parsed
}

function shouldAwaitApproval(task: AiTaskProgressTask, state: string, confidence: number) {
  return ["pending", "running", "needs_input"].includes(task.status) &&
    (state === "likely_completed" || state === "needs_review") &&
    confidence >= 0.7
}

async function maybeGenerateGeminiComment(
  task: AiTaskProgressTask,
  deterministic: ReturnType<typeof deterministicProgress>,
  evidence: Awaited<ReturnType<typeof collectProgressEvidence>>,
) {
  const modelName = resolveGeminiModel()

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      progress: {
        ...deterministic,
        model: "Gemini APIキー未設定",
      },
      judgeError: "GOOGLE_GENERATIVE_AI_API_KEY is not configured",
    }
  }

  try {
    const aiResult = await generateText({
      model: getModelForSkill("ai-task-progress"),
      temperature: 0.1,
      maxOutputTokens: 900,
      system: `あなたはFocusmapのAI実行監視エージェントです。
入力は既に機械的に集めた証拠JSONです。証拠から外れた推測はしないでください。

必ずJSONオブジェクトのみ返してください。
comment はメモカードにそのまま表示する短い日本語にしてください:
「ここまで: ...。残り: ...。次: ...。」

can_mark_completed は deterministic.can_mark_completed が true の場合だけ true にできます。
状態を強く変える場合も evidence に根拠がある時だけにしてください。`,
      prompt: JSON.stringify({
        task: {
          id: task.id,
          executor: task.executor,
          status: task.status,
          prompt: task.prompt.slice(0, 1600),
        },
        deterministic,
        evidence: {
          session_health: evidence.session_health,
          last_activity_at: evidence.last_activity_at,
          last_tool: evidence.last_tool,
          files_touched: evidence.files_touched,
          tests_seen: evidence.tests_seen,
          done_evidence: evidence.done_evidence,
          remaining_work: evidence.remaining_work,
          blocked_reason: evidence.blocked_reason,
          has_error: evidence.has_error,
          has_permission_denied: evidence.has_permission_denied,
          has_question_or_notification: evidence.has_question_or_notification,
          transcript_path: evidence.transcript_path,
          stdout_log_path: evidence.stdout_log_path,
          log_tail: evidence.log_tail.slice(-3000),
        },
        output_schema: {
          state: "not_started | running | likely_completed | needs_review | blocked | failed | unknown",
          progress_percent: "0-100 integer",
          summary: "240字以内",
          comment: "ここまで/残り/次 が分かる320字以内の日本語",
          current_step: "120字以内",
          evidence: "判定根拠を240字以内",
          recommended_action: "160字以内",
          done_evidence: "string[]",
          remaining_work: "string[]",
          blocked_reason: "string|null",
          can_mark_completed: "boolean",
          confidence: "0-1 number",
        },
      }),
    })

    return {
      progress: {
        ...normalizeGeminiProgress(parseJsonObject(aiResult.text), deterministic),
        checked_at: evidence.checked_at,
        source: "gemini" as const,
        model: modelName,
        tmux_alive: evidence.tmux_alive,
        log_chars: evidence.log_chars,
        last_activity_at: evidence.last_activity_at,
        last_tool: evidence.last_tool,
        files_touched: evidence.files_touched,
        tests_seen: evidence.tests_seen,
        session_health: evidence.session_health,
      },
      judgeError: null,
    }
  } catch (e) {
    return {
      progress: {
        ...deterministic,
        model: `Gemini判定失敗: ${e instanceof Error ? e.message : "unknown"}`,
      },
      judgeError: e instanceof Error ? e.message : "progress judge failed",
    }
  }
}

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
    .select("id, prompt, status, error, result, executor, started_at, completed_at, created_at, remote_session_url, tmux_session_name, codex_thread_id, cwd")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  if (error) {
    console.error("[ai-tasks/progress-check]", error.message)
    return NextResponse.json({ error: "Database operation failed" }, { status: 500 })
  }
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 })

  const taskRecord = task as AiTaskProgressTask
  const evidence = await collectProgressEvidence(taskRecord)
  const deterministic = deterministicProgress(taskRecord, evidence)
  const { progress, judgeError } = await maybeGenerateGeminiComment(taskRecord, deterministic, evidence)

  const currentResult = isRecord(taskRecord.result) ? taskRecord.result : {}
  const updates: Record<string, unknown> = {
    result: {
      ...currentResult,
      progress_summary: progress,
      progress_judge_error: judgeError,
      progress_evidence: progressObservationPayload(progress, evidence).evidence,
    },
  }

  if (shouldAwaitApproval(taskRecord, progress.state, progress.confidence)) {
    updates.status = "awaiting_approval"
  }

  const { data: updated, error: updateError } = await supabase
    .from("ai_tasks")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single()

  if (updateError) {
    console.error("[ai-tasks/progress-check update]", updateError.message)
    return NextResponse.json({ error: "Update failed" }, { status: 500 })
  }

  const observation = progressObservationPayload(progress, evidence)
  const { error: observationError } = await supabase
    .from("ai_task_observations")
    .insert({
      task_id: id,
      user_id: user.id,
      source: "progress_check",
      ...observation,
    })

  if (observationError) {
    // Migration may not be applied yet. The latest summary is already persisted
    // on ai_tasks.result, so keep the user-facing action successful.
    console.error("[ai-tasks/progress-check observation]", observationError.message)
  }

  return NextResponse.json({
    task: updated,
    progress_summary: progress,
    evidence,
    updated_status: typeof updates.status === "string" ? updates.status : taskRecord.status,
    judge_error: judgeError,
    observation_saved: !observationError,
  })
}
