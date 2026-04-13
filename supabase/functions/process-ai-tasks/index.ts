/**
 * Supabase Edge Function: process-ai-tasks
 *
 * 毎分 pg_cron から呼び出され、scheduled_at <= now() かつ status = 'pending' の
 * ai_tasks を取得し、Claude API で実行して結果を書き戻す。
 *
 * 環境変数（Supabase Dashboard > Edge Functions > Secrets）:
 *   SUPABASE_URL             - 自動設定
 *   SUPABASE_SERVICE_ROLE_KEY - 自動設定
 *   ANTHROPIC_API_KEY        - 手動設定が必要
 *
 * デプロイ:
 *   supabase functions deploy process-ai-tasks --project-ref PROJECT_ID
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0'

// ============================================================
// 型定義
// ============================================================
interface AiTaskRow {
  id: string
  user_id: string
  prompt: string
  skill_id: string | null
  approval_type: 'auto' | 'confirm' | 'interactive'
  status: string
  scheduled_at: string | null
  recurrence_cron: string | null
}

// ============================================================
// cron式から次回実行時刻を計算（シンプル実装）
// 対応: "* * * * *" 形式（分 時 日 月 曜日）
// ============================================================
function getNextScheduledAt(cronExpr: string, from: Date): Date {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${cronExpr}`)

  const [minutePart, hourPart] = parts

  // よくあるパターンのみサポート
  const now = new Date(from.getTime() + 60 * 1000) // 現在の次の分から開始
  now.setSeconds(0, 0)

  // 最大7日間サーチ
  const limit = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000)

  while (now < limit) {
    const minute = now.getUTCMinutes()
    const hour = now.getUTCHours()

    const minuteMatch = minutePart === '*' || parseInt(minutePart) === minute
    const hourMatch = hourPart === '*' || parseInt(hourPart) === hour

    if (minuteMatch && hourMatch) return now
    now.setTime(now.getTime() + 60 * 1000)
  }

  throw new Error(`Could not compute next run for cron: ${cronExpr}`)
}

// ============================================================
// メイン処理
// ============================================================
Deno.serve(async (_req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicApiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const anthropic = new Anthropic({ apiKey: anthropicApiKey })

    // ─────────────────────────────────────────────────────────
    // 1. due なタスクを取得（最大5件 / invocation でタイムアウト防止）
    // ─────────────────────────────────────────────────────────
    const { data: tasks, error: fetchError } = await supabase
      .from('ai_tasks')
      .select('id, user_id, prompt, skill_id, approval_type, scheduled_at, recurrence_cron')
      .eq('status', 'pending')
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(5)

    if (fetchError) throw fetchError

    if (!tasks || tasks.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0, message: 'No due tasks' }),
        { headers: { 'Content-Type': 'application/json' } },
      )
    }

    const results: { id: string; status: 'completed' | 'failed'; error?: string }[] = []

    for (const task of tasks as AiTaskRow[]) {
      // ── 2. status → running ──────────────────────────────
      const { error: updateErr } = await supabase
        .from('ai_tasks')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', task.id)
        .eq('status', 'pending') // 楽観的ロック（競合防止）

      if (updateErr) {
        console.error(`[process-ai-tasks] Failed to mark running: ${task.id}`, updateErr)
        continue
      }

      try {
        // ── 3. Claude API 呼び出し ───────────────────────────
        // コスト上限: max_tokens=2048 ≒ 入出力合計で $0.02 以内
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: buildPrompt(task),
            },
          ],
        })

        const resultText =
          message.content[0]?.type === 'text' ? message.content[0].text : ''

        const now = new Date().toISOString()

        // ── 4a. approval_type = 'confirm' → awaiting_approval ─
        if (task.approval_type === 'confirm') {
          await supabase
            .from('ai_tasks')
            .update({
              status: 'awaiting_approval',
              result: { message: resultText },
            })
            .eq('id', task.id)

          results.push({ id: task.id, status: 'completed' })
          continue
        }

        // ── 4b. auto / interactive → completed ───────────────
        // recurrence_cron がある場合は次回 scheduled_at を計算してリセット
        if (task.recurrence_cron) {
          const nextAt = getNextScheduledAt(task.recurrence_cron, new Date())
          await supabase
            .from('ai_tasks')
            .update({
              status: 'pending',
              result: { message: resultText, last_run: now },
              completed_at: now,
              scheduled_at: nextAt.toISOString(),
              started_at: null,
            })
            .eq('id', task.id)
        } else {
          await supabase
            .from('ai_tasks')
            .update({
              status: 'completed',
              result: { message: resultText },
              completed_at: now,
            })
            .eq('id', task.id)
        }

        results.push({ id: task.id, status: 'completed' })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[process-ai-tasks] Task ${task.id} failed:`, errMsg)

        await supabase
          .from('ai_tasks')
          .update({
            status: 'failed',
            error: errMsg.slice(0, 500),
            completed_at: new Date().toISOString(),
          })
          .eq('id', task.id)

        results.push({ id: task.id, status: 'failed', error: errMsg })
      }
    }

    return new Response(
      JSON.stringify({ processed: results.length, results }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[process-ai-tasks] Fatal error:', errMsg)
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})

// ============================================================
// プロンプト構築
// ============================================================
function buildPrompt(task: AiTaskRow): string {
  const skillHint = task.skill_id ? `\n[スキル: ${task.skill_id}]` : ''
  return `${task.prompt}${skillHint}`
}
