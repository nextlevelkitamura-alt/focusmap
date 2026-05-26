/**
 * スキル: calendar-organize (今日のカレンダー整理)
 *
 * Phase C で MVP の固定データから 実Google Calendar API 呼び出しに置換。
 * - user_calendar_settings に Google OAuth token があれば実データ取得
 * - 連携未済 / token失効時はフォールバックで固定データを使う
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { callGemini } from '../ai/gemini.js';
import { fetchTodayEvents, GoogleAuthError } from '../google-calendar.js';
import type { AgentConfig, AiTask, TaskResultJson } from '../types.js';
import { info, warn } from '../logger.js';

const FALLBACK_EVENTS = [
  { start: '09:00', end: '10:00', title: '朝会 (チームスタンドアップ)' },
  { start: '11:00', end: '12:30', title: '候補者面接 1名' },
  { start: '14:00', end: '15:00', title: '求人企業との打ち合わせ' },
];

const SAMPLE_TODOS = ['メール返信 (15分)', '求人原稿の更新 (45分)', '候補者管理表更新 (30分)'];

export async function runCalendarOrganize(
  task: AiTask,
  config: AgentConfig,
  supabase: SupabaseClient,
): Promise<TaskResultJson> {
  const startedAt = new Date().toISOString();
  const steps: TaskResultJson['steps'] = [];

  // Step 1: Google Calendar から取得 (失敗時はフォールバック)
  steps.push({ label: '今日の予定を取得', status: 'running', at: new Date().toISOString() });
  let events: Array<{ start: string; end: string; title: string }> = [];
  let useFallback = false;
  try {
    events = await fetchTodayEvents(supabase, task.user_id);
    info(`[calendar-organize] fetched ${events.length} events from Google Calendar`);
    if (events.length === 0) {
      events = FALLBACK_EVENTS;
      useFallback = true;
      warn('[calendar-organize] no events today, using sample data for demonstration');
    }
  } catch (e) {
    if (e instanceof GoogleAuthError) {
      warn(`[calendar-organize] Google auth not available, fallback: ${e.message}`);
      events = FALLBACK_EVENTS;
      useFallback = true;
    } else {
      throw e;
    }
  }
  steps[0] = {
    ...steps[0],
    status: 'done',
    at: new Date().toISOString(),
    detail: useFallback ? 'サンプルデータを使用' : `Google Calendar から ${events.length}件取得`,
  };

  // Step 2: AI 提案生成
  steps.push({ label: 'AI で空き時間提案を生成', status: 'running', at: new Date().toISOString() });
  const userPrompt =
    task.prompt && task.prompt.trim().length > 0
      ? task.prompt
      : '今日の空き時間と推奨作業を提案してください。';

  const fullPrompt = `${userPrompt}

【今日の予定】${useFallback ? ' (※デモ用サンプルデータ)' : ''}
${events.map((e) => `- ${e.start}〜${e.end}: ${e.title}`).join('\n')}

${useFallback ? `【今日中に終わらせたいタスク (サンプル)】\n${SAMPLE_TODOS.map((t) => `- ${t}`).join('\n')}\n` : ''}
【出力フォーマット】
JSON: {"free_slots": [{"start": "HH:MM", "end": "HH:MM", "duration_min": number}], "suggested_allocations": [...], "warnings": [...], "total_free_minutes": number}`;

  const ai = await callGemini(fullPrompt, {
    apiKey: config.gemini_api_key ?? '',
    maxTokens: 2048,
    temperature: 0.2,
    responseJson: true,
  });
  steps[1] = { ...steps[1], status: 'done', at: new Date().toISOString() };

  return {
    executor: 'simple',
    steps,
    output: ai.text,
    usage: {
      input_tokens: ai.inputTokens,
      output_tokens: ai.outputTokens,
      cost_usd: ai.costUsd,
      model: ai.model,
    },
    meta: {
      skill_id: 'calendar-organize',
      started_at: startedAt,
      event_count: events.length,
      used_fallback: useFallback,
    },
  };
}
