import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createClient } from '@/utils/supabase/server'
import { normalizeVisibility, resolveAiTaskSpaceId } from '@/lib/space-access'

export const runtime = 'nodejs'

function requestImmediateCodexAppDispatch(taskId: string): void {
  if (process.env.FOCUSMAP_DISABLE_LOCAL_CODEX_DISPATCH === 'true') return

  const root = process.cwd()
  const localTsx = path.join(root, 'node_modules', '.bin', 'tsx')
  const hasLocalTsx = fs.existsSync(localTsx)
  const command = hasLocalTsx ? localTsx : 'npx'
  const args = hasLocalTsx
    ? ['scripts/task-runner.ts', '--task-id', taskId, '--fast']
    : ['--yes', 'tsx', 'scripts/task-runner.ts', '--task-id', taskId, '--fast']
  const outPath = path.join(root, 'scripts', 'task-runner.log')
  const errPath = path.join(root, 'scripts', 'task-runner.err')

  let outFd: number | null = null
  let errFd: number | null = null
  try {
    outFd = fs.openSync(outPath, 'a')
    errFd = fs.openSync(errPath, 'a')
    const child = spawn(command, args, {
      cwd: root,
      detached: true,
      stdio: ['ignore', outFd, errFd],
      env: {
        ...process.env,
        FOCUSMAP_IMMEDIATE_TASK_ID: taskId,
      },
    })
    child.unref()
    console.log(`[ai-tasks/schedule] immediate Codex.app dispatch requested: ${taskId}`)
  } catch (err) {
    console.error('[ai-tasks/schedule] immediate Codex.app dispatch failed:', err instanceof Error ? err.message : err)
  } finally {
    if (outFd !== null) {
      try { fs.closeSync(outFd) } catch {}
    }
    if (errFd !== null) {
      try { fs.closeSync(errFd) } catch {}
    }
  }
}

function canUseLocalDispatch(req: NextRequest): boolean {
  if (process.env.FOCUSMAP_ENABLE_LOCAL_CODEX_DISPATCH === 'true') return true
  return ['localhost', '127.0.0.1', '::1'].includes(req.nextUrl.hostname)
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { prompt, skill_id, scheduled_at, recurrence_cron, approval_type, cwd, source_note_id, source_ideal_goal_id, source_task_id, executor, space_id, run_visibility, dispatch_mode, codex_handoff_token } = body as {
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

  // 同一メモ（notes / ideal_goals）から pending/running のタスクが既にある場合は重複として拒否
  const dupeColumn = source_task_id ? 'source_task_id' : source_ideal_goal_id ? 'source_ideal_goal_id' : source_note_id ? 'source_note_id' : null
  const dupeValue = source_task_id || source_ideal_goal_id || source_note_id || null
  if (dupeColumn && dupeValue) {
    const { data: existing } = await supabase
      .from('ai_tasks')
      .select('id, status')
      .eq(dupeColumn, dupeValue)
      .in('status', ['pending', 'running', 'awaiting_approval', 'needs_input'])
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        { error: 'この項目は既に実行中または確認待ちです', existing_task_id: existing.id },
        { status: 409 },
      )
    }
  }

  const resolvedExecutor =
    executor === 'codex_app' ? 'codex_app' :
    executor === 'codex' ? 'codex' :
    'claude'
  const manualCodexHandoff = resolvedExecutor === 'codex_app' && dispatch_mode === 'manual'
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
      source_note_id: source_note_id || null,
      source_ideal_goal_id: source_ideal_goal_id || null,
      source_task_id: source_task_id || null,
      executor: resolvedExecutor,
      run_visibility: normalizeVisibility(run_visibility, resolvedSpace.spaceId ? 'space' : 'private'),
      result: manualCodexHandoff
        ? {
            executor: 'codex_app',
            codex_manual_handoff: true,
            codex_handoff_token: handoffToken,
            codex_run_state: 'awaiting_approval',
            codex_review_reason: 'manual_handoff',
            live_log: 'Codex.appでプロンプトを送信すると、Focusmapはthread状態とログだけ同期します。',
            message: 'Codex.appでプロンプトを送信してください。Focusmap側は状態確認用の待機レコードです。',
            last_activity_at: nowIso,
            steps: [
              {
                key: 'handoff_ready',
                label: 'Codex.app 手動開始待ち',
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

  if (
    resolvedExecutor === 'codex_app' &&
    !manualCodexHandoff &&
    canUseLocalDispatch(req) &&
    new Date(scheduled_at).getTime() <= Date.now() + 5_000
  ) {
    requestImmediateCodexAppDispatch(data.id)
  }

  return NextResponse.json(data, { status: 201 })
}
