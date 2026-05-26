import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { classifyIntent, getActiveModelLabel } from '@/lib/ai/intent-classifier';
import { assertCanExecute } from '@/lib/usage-guard';
import { formatBillingCycle } from '@/lib/format';

/**
 * POST /api/chat/send
 *
 * Body: { message: string, space_id?: string, auto_execute?: boolean }
 * Returns: { intent, task_id?, model_label, message }
 *
 * 1. DeepSeek V4 Pro (or Gemini Fallback) で intent判定
 * 2. auto_execute=true なら即座に ai_tasks INSERT
 * 3. auto_execute=false なら intent のみ返す (UI で確認ボタン → 後続でINSERT)
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const message: string = String(body.message ?? '').trim();
  const spaceId: string | null = body.space_id ?? null;
  const autoExecute: boolean = body.auto_execute === true;

  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  // 1. Intent判定
  let intent;
  try {
    intent = await classifyIntent(message);
  } catch (e) {
    console.error('[chat/send] intent classify failed', e);
    return NextResponse.json(
      {
        error: 'intent判定に失敗しました',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  // 2. auto_execute=false なら intent のみ返す
  if (!autoExecute || !intent.skill_id) {
    return NextResponse.json({
      intent,
      task_id: null,
      model_label: getActiveModelLabel(),
      message: '判定結果を確認してください',
    });
  }

  // 3. プラン上限check
  const usage = await assertCanExecute(supabase, spaceId, user.id);
  if (!usage.allowed) {
    return NextResponse.json(
      {
        intent,
        task_id: null,
        model_label: getActiveModelLabel(),
        error: usage.message,
        reason: usage.reason,
        usage: usage.usage,
      },
      { status: 402 },
    );
  }

  // 4. ai_tasks INSERT
  const { data: task, error } = await supabase
    .from('ai_tasks')
    .insert({
      user_id: user.id,
      space_id: spaceId,
      prompt: message,
      skill_id: intent.skill_id,
      approval_type: 'auto',
      status: 'pending',
      executor: 'playwright', // focusmap-agent が claim する
      run_visibility: spaceId ? 'space' : 'private',
      billing_cycle: formatBillingCycle(),
      scheduled_at: new Date().toISOString(),
      package_snapshot: {
        skill_id: intent.skill_id,
        args: intent.args,
        source: 'chat',
      },
    })
    .select()
    .single();

  if (error) {
    console.error('[chat/send] ai_tasks insert failed', error);
    return NextResponse.json(
      { error: 'タスク作成に失敗しました', detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    intent,
    task_id: task.id,
    model_label: getActiveModelLabel(),
    message: 'タスクを投入しました',
  });
}
