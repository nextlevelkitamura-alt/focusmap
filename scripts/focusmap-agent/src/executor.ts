/**
 * task実行ハンドラ
 *
 * - claim したタスクの status を 'running' に更新
 * - skill_id に応じてスキル実装にディスパッチ
 * - 結果を ai_tasks.result に書き戻し
 * - ai_usage にログを記録 (使用量計測)
 * - 失敗時は status='failed' + error メッセージ
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig, AiTask, TaskResultJson } from './types.js';
import { runCalendarOrganize } from './skills/calendar-organize.js';
import { error as logError, info, warn } from './logger.js';

export async function executeTask(
  task: AiTask,
  supabase: SupabaseClient,
  config: AgentConfig,
): Promise<void> {
  // 1. status を running に
  await supabase
    .from('ai_tasks')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .eq('id', task.id);

  let result: TaskResultJson;
  try {
    // 2. skill_id でディスパッチ (MVP: 1つだけ)
    if (task.skill_id === 'calendar-organize') {
      result = await runCalendarOrganize(task, config);
    } else {
      throw new Error(`Unsupported skill_id: ${task.skill_id ?? '<null>'} (MVPで対応するのは calendar-organize のみ)`);
    }

    // 3. ai_tasks に書き戻し
    await supabase
      .from('ai_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: result as unknown as Record<string, unknown>,
      })
      .eq('id', task.id);

    // 4. ai_usage にログ
    if (result.usage) {
      const cycle = new Date().toISOString().slice(0, 7); // YYYY-MM
      await supabase.from('ai_usage').insert({
        user_id: task.user_id,
        space_id: task.space_id,
        package_id: task.package_id ?? null,
        feature: task.skill_id ?? 'unknown',
        model: result.usage.model,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cost_usd: result.usage.cost_usd,
        billing_cycle: cycle,
        metadata: { task_id: task.id, executor: result.executor },
      });
    }

    info(`task ${task.id} 完了`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logError(`task ${task.id} 失敗:`, message);
    await supabase
      .from('ai_tasks')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: message,
        result: {
          executor: 'simple',
          steps: [],
          output: '',
          error: message,
        } as unknown as Record<string, unknown>,
      })
      .eq('id', task.id);
  }
}
