import { NextRequest, NextResponse } from 'next/server'
import { insertAiTaskActivityMessage } from '@/lib/ai-task-activity'
import { createClient } from '@/utils/supabase/server'
import { normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { isTursoConfigured } from '@/lib/turso/client'
import { upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

export const runtime = 'nodejs'

function taskProgressSource(input: {
  source_task_id?: string | null
  source_note_id?: string | null
  source_ideal_goal_id?: string | null
}) {
  if (input.source_task_id) return { source_type: 'mindmap', source_id: input.source_task_id }
  if (input.source_note_id) return { source_type: 'note', source_id: input.source_note_id }
  if (input.source_ideal_goal_id) return { source_type: 'ideal_goal', source_id: input.source_ideal_goal_id }
  return { source_type: null, source_id: null }
}

// cronのバリデーション（5フィールド形式）
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const rangeCheck = (part: string, min: number, max: number) => {
    if (part === '*') return true
    const n = parseInt(part, 10)
    return !isNaN(n) && n >= min && n <= max
  }
  return (
    rangeCheck(parts[0], 0, 59) && // 分
    rangeCheck(parts[1], 0, 23) && // 時
    rangeCheck(parts[2], 1, 31) && // 日
    rangeCheck(parts[3], 1, 12) && // 月
    rangeCheck(parts[4], 0, 6)     // 曜日
  )
}

// POST /api/ai-tasks/schedule — スケジュール付きAIタスクを作成
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const body = await req.json()
  const { prompt, skill_id, scheduled_at, recurrence_cron, approval_type, cwd, source_note_id, source_ideal_goal_id, source_task_id, executor, space_id, run_visibility, codex_resume_thread_id, dispatch_mode, codex_handoff_token } = body as {
    prompt?: string
    skill_id?: string
    scheduled_at?: string
    recurrence_cron?: string
    approval_type?: string
    cwd?: string
    source_note_id?: string
    source_ideal_goal_id?: string
    source_task_id?: string
    executor?: 'claude' | 'codex' | 'codex_app'
    space_id?: string
    run_visibility?: string
    codex_resume_thread_id?: string
    dispatch_mode?: 'auto' | 'manual'
    codex_handoff_token?: string
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  if (!scheduled_at || isNaN(Date.parse(scheduled_at))) {
    return NextResponse.json({ error: 'scheduled_at must be a valid ISO8601 datetime' }, { status: 400 })
  }

  // 過去日時は拒否（5分のバッファを許容、繰り返しタスクは過去でもOK）
  if (!recurrence_cron && new Date(scheduled_at).getTime() < Date.now() - 5 * 60_000) {
    return NextResponse.json({ error: 'scheduled_at must be in the future' }, { status: 400 })
  }

  if (recurrence_cron && !isValidCron(recurrence_cron)) {
    return NextResponse.json({ error: 'recurrence_cron must be a valid 5-field cron expression' }, { status: 400 })
  }

  const validApprovalTypes = ['auto', 'confirm', 'interactive']
  const resolvedApprovalType = validApprovalTypes.includes(approval_type ?? '')
    ? approval_type
    : 'auto'

  const resolvedExecutor =
    executor === 'codex_app' ? 'codex_app' :
    executor === 'codex' ? 'codex' :
    'claude'
  const codexDispatchMode = resolvedExecutor === 'codex_app'
    ? (dispatch_mode === 'auto' ? 'auto' : 'manual')
    : null
  const manualCodexHandoff = resolvedExecutor === 'codex_app' && codexDispatchMode !== 'auto'
  if (resolvedExecutor === 'codex_app' && !manualCodexHandoff && (!cwd || typeof cwd !== 'string' || !cwd.trim())) {
    return NextResponse.json({ error: 'cwd is required for Codex.app auto dispatch' }, { status: 400 })
  }
  const handoffToken = typeof codex_handoff_token === 'string' && /^FM-[A-Za-z0-9._:-]{8,120}$/.test(codex_handoff_token.trim())
    ? codex_handoff_token.trim()
    : null
  const nowIso = new Date().toISOString()

  const resolvedSpace = await resolveAiTaskSpaceId(supabase, user.id, {
    space_id: space_id || null,
    source_note_id: source_note_id || null,
    source_ideal_goal_id: source_ideal_goal_id || null,
    source_task_id: source_task_id || null,
  })
  if (resolvedSpace.error) {
    return NextResponse.json({ error: resolvedSpace.error }, { status: 403 })
  }

  // 同一メモ（notes / ideal_goals）から pending/running のタスクが既にある場合は重複として拒否
  const dupeColumn = source_task_id ? 'source_task_id' : source_ideal_goal_id ? 'source_ideal_goal_id' : source_note_id ? 'source_note_id' : null
  const dupeValue = source_task_id || source_ideal_goal_id || source_note_id || null
  if (dupeColumn && dupeValue) {
    const { data: existing } = await supabase
      .from('ai_tasks')
      .select('id, status, result')
      .eq(dupeColumn, dupeValue)
      .eq('user_id', user.id)
      .in('status', ['pending', 'running', 'awaiting_approval', 'needs_input'])
      .limit(1)
      .maybeSingle()
    if (existing) {
      const existingResult = (existing.result ?? {}) as Record<string, unknown>
      const canPromoteManualCodexHandoff =
        resolvedExecutor === 'codex_app' &&
        !manualCodexHandoff &&
        (existing.status === 'needs_input' || existing.status === 'awaiting_approval') &&
        existingResult.codex_manual_handoff === true

      if (canPromoteManualCodexHandoff) {
        const { data: promoted, error: promoteError } = await supabase
          .from('ai_tasks')
          .update({
            prompt: prompt.trim(),
            skill_id: skill_id || null,
            approval_type: resolvedApprovalType,
            status: 'pending',
            started_at: null,
            completed_at: null,
            scheduled_at,
            recurrence_cron: recurrence_cron || null,
            cwd: cwd || null,
            codex_resume_thread_id: codex_resume_thread_id || null,
            executor: resolvedExecutor,
            run_visibility: normalizeVisibility(run_visibility, resolvedSpace.spaceId ? 'space' : 'private'),
            error: null,
            result: {
              ...existingResult,
              executor: 'codex_app',
              codex_manual_handoff: false,
              codex_run_state: 'running',
              codex_review_reason: 'queued',
              live_log: 'MacエージェントがCodex.app app-serverで実行開始します。',
              message: 'Macエージェントの自動実行待ちです。',
              last_activity_at: nowIso,
              steps: [
                {
                  key: 'queued',
                  label: 'Codex.app 自動実行に切替',
                  status: 'active',
                  at: nowIso,
                },
              ],
            },
          })
          .eq('id', existing.id)
          .select()
          .single()

        if (promoteError) {
          console.error('[ai-tasks/schedule] promote Codex handoff', promoteError.message)
          return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
        }

        await insertAiTaskActivityMessage(supabase, {
          taskId: promoted.id,
          userId: user.id,
          role: 'status',
          kind: 'sent',
          body: 'Codex自動実行に切り替えました。',
          dedupeKey: `task:${promoted.id}:sent`,
        })

        return NextResponse.json(promoted, { status: 200 })
      }

      return NextResponse.json(
        { error: 'この項目は既に実行中または確認待ちです', existing_task_id: existing.id },
        { status: 409 },
      )
    }
  }

  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: user.id,
      space_id: resolvedSpace.spaceId,
      prompt: prompt.trim(),
      skill_id: skill_id || null,
      approval_type: resolvedApprovalType,
      status: manualCodexHandoff ? 'needs_input' : 'pending',
      started_at: manualCodexHandoff ? nowIso : null,
      scheduled_at,
      recurrence_cron: recurrence_cron || null,
      cwd: cwd || null,
      codex_resume_thread_id: codex_resume_thread_id || null,
      source_task_id: source_task_id || null,
      source_note_id: source_note_id || null,
      source_ideal_goal_id: source_ideal_goal_id || null,
      executor: resolvedExecutor,
      run_visibility: normalizeVisibility(run_visibility, resolvedSpace.spaceId ? 'space' : 'private'),
      result: manualCodexHandoff
        ? {
            executor: 'codex_app',
            codex_manual_handoff: true,
            codex_handoff_token: handoffToken,
            codex_run_state: 'prompt_waiting',
            codex_review_reason: 'manual_handoff',
            live_log: 'プロンプト待ち。Codex.appで送信されると、Focusmapはthread状態とログを同期します。',
            message: 'プロンプト待ちです。Codex.appで送信してください。',
            last_activity_at: nowIso,
            steps: [
              {
                key: 'prompt_waiting',
                label: 'プロンプト待ち',
                status: 'active',
                at: nowIso,
              },
            ],
          }
        : resolvedExecutor === 'codex_app'
          ? {
              executor: 'codex_app',
              codex_manual_handoff: false,
              codex_run_state: 'running',
              codex_review_reason: 'queued',
              live_log: 'MacエージェントがCodex.app app-serverで実行開始します。',
              message: 'Macエージェントの自動実行待ちです。',
              last_activity_at: nowIso,
              steps: [
                {
                  key: 'queued',
                  label: 'Codex.app 自動実行待ち',
                  status: 'active',
                  at: nowIso,
                },
              ],
            }
        : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[ai-tasks/schedule]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  if (isTursoConfigured()) {
    try {
      const source = taskProgressSource({
        source_task_id: source_task_id || null,
        source_note_id: source_note_id || null,
        source_ideal_goal_id: source_ideal_goal_id || null,
      })
      await upsertTursoAiTask({
        id: String(data.id),
        user_id: user.id,
        space_id: typeof data.space_id === 'string' ? data.space_id : null,
        title: prompt.trim().slice(0, 140),
        status: typeof data.status === 'string' ? data.status : manualCodexHandoff ? 'needs_input' : 'pending',
        executor: resolvedExecutor,
        dispatch_mode: codexDispatchMode,
        source_type: source.source_type,
        source_id: source.source_id,
        codex_thread_id: typeof data.codex_thread_id === 'string' ? data.codex_thread_id : null,
        created_at: typeof data.created_at === 'string' ? data.created_at : nowIso,
        updated_at: nowIso,
        started_at: typeof data.started_at === 'string' ? data.started_at : null,
        completed_at: typeof data.completed_at === 'string' ? data.completed_at : null,
      })
    } catch (tursoError) {
      console.error('[ai-tasks/schedule turso mirror]', tursoError)
    }
  }

  if (resolvedExecutor === 'codex' || resolvedExecutor === 'codex_app') {
    await insertAiTaskActivityMessage(supabase, {
      taskId: data.id,
      userId: user.id,
      role: 'status',
      kind: manualCodexHandoff ? 'prompt_waiting' : 'sent',
      body: manualCodexHandoff
        ? 'プロンプト待ちです。Codex側で貼り付けて送信してください。'
        : 'Codex実行をキューに追加しました。',
      dedupeKey: `task:${data.id}:${manualCodexHandoff ? 'prompt_waiting' : 'sent'}`,
    })
  }

  return NextResponse.json(data, { status: 201 })
}
