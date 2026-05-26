/**
 * task実行ハンドラ (Phase C: 3スキル対応)
 *
 * - skill_id で動的ディスパッチ
 * - 結果を ai_tasks に書き戻し
 * - ai_usage にログ記録
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig, AiTask, TaskResultJson } from './types.js';
import { runCalendarOrganize } from './skills/calendar-organize.js';
import { runWebResearch } from './skills/web-research.js';
import { runEmailSummary } from './skills/email-summary.js';
import { error as logError, info } from './logger.js';

export async function executeTask(
  task: AiTask,
  supabase: SupabaseClient,
  config: AgentConfig,
): Promise<void> {
  // 1. status を running に
  await supabase
    .from('ai_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', task.id);

  let result: TaskResultJson;
  try {
    // 2. skill_id でディスパッチ
    switch (task.skill_id) {
      case 'calendar-organize':
        result = await runCalendarOrganize(task, config, supabase);
        break;
      case 'web-research':
        result = await runWebResearch(task, config);
        break;
      case 'email-summary':
        result = await runEmailSummary(task, config, supabase);
        break;
      default:
        throw new Error(
          `Unsupported skill_id: ${task.skill_id ?? '<null>'} (対応: calendar-organize, web-research, email-summary)`,
        );
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
    if (result.usage && result.usage.input_tokens > 0) {
      const cycle = new Date().toISOString().slice(0, 7);
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

    info(`task ${task.id} 完了 (${task.skill_id})`);
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
