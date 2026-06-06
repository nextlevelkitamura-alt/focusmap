import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { canViewSpace, normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'
import { assertCanExecute } from '@/lib/usage-guard'
import { formatBillingCycle } from '@/lib/format'
import { authenticateSupabaseRequest } from '@/lib/auth/verify-supabase-jwt'
import { isTursoConfigured } from '@/lib/turso/client'
import { upsertTursoAiTask } from '@/lib/turso/codex-monitoring'

const AI_TASK_LIST_SELECT = [
  'id',
  'user_id',
  'space_id',
  'package_id',
  'package_version_id',
  'claimed_runner_id',
  'claim_expires_at',
  'run_visibility',
  'prompt',
  'skill_id',
  'approval_type',
  'status',
  'error',
  'parent_task_id',
  'created_at',
  'started_at',
  'completed_at',
  'scheduled_at',
  'recurrence_cron',
  'cwd',
  'source_note_id',
  'source_ideal_goal_id',
  'source_task_id',
  'remote_session_url',
  'tmux_session_name',
  'executor',
  'codex_thread_id',
  'result_codex_run_state:result->>codex_run_state',
  'result_codex_review_reason:result->>codex_review_reason',
  'result_current_step:result->>current_step',
  'result_last_activity_at:result->>last_activity_at',
  'result_message:result->>message',
  'result_live_log:result->>live_log',
  'result_progress_summary:result->progress_summary',
  'result_steps:result->steps',
  'result_codex_manual_handoff:result->codex_manual_handoff',
  'result_awaiting_approval_at:result->>awaiting_approval_at',
].join(', ')

const AI_TASK_STATUS_SELECT = [
  'id',
  'user_id',
  'space_id',
  'status',
  'error',
  'created_at',
  'started_at',
  'completed_at',
  'cwd',
  'source_note_id',
  'source_ideal_goal_id',
  'source_task_id',
  'executor',
  'codex_thread_id',
  'result_codex_run_state:result->>codex_run_state',
  'result_codex_review_reason:result->>codex_review_reason',
  'result_current_step:result->>current_step',
  'result_last_activity_at:result->>last_activity_at',
  'result_message:result->>message',
  'result_progress_summary:result->progress_summary',
  'result_codex_manual_handoff:result->codex_manual_handoff',
  'result_awaiting_approval_at:result->>awaiting_approval_at',
].join(', ')

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function trimText(value: unknown, max: number) {
  return typeof value === 'string' && value.length > max ? value.slice(-max) : value
}

function compactAiTask(row: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  const resultKeyMap: Array<[string, string, number?]> = [
    ['result_codex_run_state', 'codex_run_state'],
    ['result_codex_review_reason', 'codex_review_reason'],
    ['result_current_step', 'current_step'],
    ['result_last_activity_at', 'last_activity_at'],
    ['result_message', 'message', 2_000],
    ['result_live_log', 'live_log', 4_000],
    ['result_progress_summary', 'progress_summary'],
    ['result_steps', 'steps'],
    ['result_codex_manual_handoff', 'codex_manual_handoff'],
    ['result_awaiting_approval_at', 'awaiting_approval_at'],
  ]

  for (const [sourceKey, targetKey, max] of resultKeyMap) {
    const value = row[sourceKey]
    if (value === undefined || value === null) continue
    result[targetKey] = max ? trimText(value, max) : value
  }

  const compacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (!key.startsWith('result_')) compacted[key] = value
  }
  compacted.result = Object.keys(result).length > 0 ? result : null
  return compacted
}

function parseIdList(value: string | null) {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => /^[0-9a-fA-F-]{20,80}$/.test(item))
    .slice(0, 300)
}

// GET /api/ai-tasks — 自分のAIタスク一覧取得
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const executor = searchParams.get('executor')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const spaceId = searchParams.get('space_id')
  const source = searchParams.get('source')
  const view = searchParams.get('view')
  const sourceTaskIds = parseIdList(searchParams.get('source_task_ids'))
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '50', 10) || 50, 1), 500)
  const selectColumns = view === 'status' ? AI_TASK_STATUS_SELECT : AI_TASK_LIST_SELECT

  let query = supabase
    .from('ai_tasks')
    .select(selectColumns)
    .limit(limit)

  if (spaceId && spaceId !== '__unassigned__') {
    if (!(await canViewSpace(supabase, user.id, spaceId))) {
      return NextResponse.json({ error: 'No access to the selected space' }, { status: 403 })
    }
    query = query
      .eq('space_id', spaceId)
      .or(`user_id.eq.${user.id},run_visibility.eq.space`)
  } else if (spaceId === '__unassigned__') {
    query = query.eq('user_id', user.id).is('space_id', null)
  } else {
    query = query.eq('user_id', user.id)
  }

  if (status) {
    query = query.eq('status', status)
  }
  if (executor && ['claude', 'codex', 'codex_app'].includes(executor)) {
    query = query.eq('executor', executor)
  }
  if (sourceTaskIds.length > 0) {
    query = query.in('source_task_id', sourceTaskIds)
  } else if (source === 'linked') {
    query = query.or('source_note_id.not.is.null,source_ideal_goal_id.not.is.null,source_task_id.not.is.null')
  } else if (source === 'note') {
    query = query.not('source_note_id', 'is', null)
  } else if (source === 'mindmap') {
    query = query.not('source_task_id', 'is', null)
  }

  // scheduled=true のとき recurrence_cron が設定されたタスクのみ返す
  const scheduled = searchParams.get('scheduled')
  if (scheduled === 'true') {
    query = query.not('recurrence_cron', 'is', null)
  }
  if (from && !Number.isNaN(Date.parse(from))) {
    query = query.gte('scheduled_at', new Date(from).toISOString())
  }
  if (to && !Number.isNaN(Date.parse(to))) {
    query = query.lt('scheduled_at', new Date(to).toISOString())
  }

  query = from || to
    ? query.order('scheduled_at', { ascending: true, nullsFirst: false })
    : query.order('created_at', { ascending: false })

  const { data, error } = await query
  if (error) {
    console.error('[ai-tasks]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  return NextResponse.json((data ?? []).map(row => compactAiTask(isRecord(row) ? row : {})))
}

// POST /api/ai-tasks — AIタスク作成（壁打ち・スキル実行）
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const auth = await authenticateSupabaseRequest(req, supabase)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { user } = auth

  const body = await req.json()
  const {
    prompt,
    skill_id,
    approval_type,
    parent_task_id,
    scheduled_at,
    recurrence_cron,
    cwd,
    executor,
    dispatch_mode,
    codex_handoff_token,
    space_id,
    run_visibility,
  } = body

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  const selectedExecutor = executor ?? 'claude'
  if (!['claude', 'codex', 'codex_app', 'playwright', 'simple', 'browser', 'terminal'].includes(selectedExecutor)) {
    return NextResponse.json({ error: 'Invalid executor' }, { status: 400 })
  }
  const codexDispatchMode = selectedExecutor === 'codex_app'
    ? (dispatch_mode === 'auto' ? 'auto' : 'manual')
    : null
  const manualCodexHandoff = selectedExecutor === 'codex_app' && codexDispatchMode !== 'auto'
  if (selectedExecutor === 'codex_app' && codexDispatchMode === 'auto' && (!cwd || typeof cwd !== 'string' || !cwd.trim())) {
    return NextResponse.json({ error: 'cwd is required for Codex.app auto dispatch' }, { status: 400 })
  }
  const handoffToken = typeof codex_handoff_token === 'string' && /^FM-[A-Za-z0-9._:-]{8,120}$/.test(codex_handoff_token.trim())
    ? codex_handoff_token.trim()
    : null
  const nowIso = new Date().toISOString()

  const resolved = await resolveAiTaskSpaceId(supabase, user.id, {
    space_id: typeof space_id === 'string' ? space_id : null,
    parent_task_id: typeof parent_task_id === 'string' ? parent_task_id : null,
  })
  if (resolved.error) {
    return NextResponse.json({ error: resolved.error }, { status: 403 })
  }

  // プラン上限check (スキル実行系のみ。pure 壁打ち=skill_idなし は無制限扱い)
  if (skill_id) {
    const usageCheck = await assertCanExecute(supabase, resolved.spaceId, user.id, user.email)
    if (!usageCheck.allowed) {
      return NextResponse.json(
        {
          error: usageCheck.message ?? '使用量上限に達しました',
          reason: usageCheck.reason,
          usage: usageCheck.usage,
        },
        { status: 402 },
      )
    }
  }

  const { data, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: user.id,
      space_id: resolved.spaceId,
      prompt: prompt.trim(),
      skill_id: skill_id || null,
      approval_type: approval_type || 'auto',
      parent_task_id: parent_task_id || null,
      status: manualCodexHandoff ? 'needs_input' : 'pending',
      started_at: manualCodexHandoff ? nowIso : null,
      scheduled_at: scheduled_at ?? null,
      recurrence_cron: recurrence_cron ?? null,
      cwd: cwd ?? null,
      executor: selectedExecutor,
      run_visibility: normalizeVisibility(run_visibility, resolved.spaceId ? 'space' : 'private'),
      billing_cycle: formatBillingCycle(),
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
        : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[ai-tasks]', error.message)
    return NextResponse.json({ error: 'Database operation failed' }, { status: 500 })
  }

  if (isTursoConfigured() && isRecord(data)) {
    try {
      await upsertTursoAiTask({
        id: String(data.id),
        user_id: user.id,
        space_id: typeof data.space_id === 'string' ? data.space_id : null,
        title: prompt.trim().slice(0, 140),
        status: typeof data.status === 'string' ? data.status : manualCodexHandoff ? 'needs_input' : 'pending',
        executor: selectedExecutor,
        dispatch_mode: codexDispatchMode,
        created_at: typeof data.created_at === 'string' ? data.created_at : null,
        started_at: typeof data.started_at === 'string' ? data.started_at : null,
        completed_at: typeof data.completed_at === 'string' ? data.completed_at : null,
      })
    } catch (tursoError) {
      console.error('[ai-tasks turso mirror]', tursoError)
    }
  }

  return NextResponse.json(data, { status: 201 })
}
