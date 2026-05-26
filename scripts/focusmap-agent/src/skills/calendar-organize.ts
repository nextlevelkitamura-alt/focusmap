/**
 * スキル: calendar-organize (今日のカレンダー整理)
 *
 * MVP: 固定のサンプル予定データを使って AI で空き時間提案を生成。
 * Phase 4 で実際の Google Calendar API 連携に置き換える。
 */

import { callGemini } from '../ai/gemini.js';
import type { AgentConfig, AiTask, TaskResultJson } from '../types.js';
import { info } from '../logger.js';

interface CalendarEvent {
  start: string;
  end: string;
  title: string;
}

const SAMPLE_EVENTS: CalendarEvent[] = [
  { start: '09:00', end: '10:00', title: '朝会 (チームスタンドアップ)' },
  { start: '11:00', end: '12:30', title: '候補者面接 1名' },
  { start: '14:00', end: '15:00', title: '求人企業との打ち合わせ' },
  { start: '16:00', end: '17:00', title: '候補者面接 1名' },
];

const SAMPLE_TODOS = ['メール返信 (15分)', '求人原稿の更新 (45分)', '候補者管理表更新 (30分)'];

export async function runCalendarOrganize(
  task: AiTask,
  config: AgentConfig,
): Promise<TaskResultJson> {
  const startTime = new Date().toISOString();
  const steps: TaskResultJson['steps'] = [];

  // Step 1: 予定取得 (MVP: 固定データ)
  steps.push({ label: '今日の予定を取得', status: 'done', at: new Date().toISOString() });
  info(`[calendar-organize] task ${task.id}: 予定取得 (sample data, ${SAMPLE_EVENTS.length}件)`);

  // Step 2: AI 提案生成
  steps.push({ label: 'AI で空き時間提案を生成', status: 'running', at: new Date().toISOString() });
  const eventsLines = SAMPLE_EVENTS.map((e) => `- ${e.start}〜${e.end}: ${e.title}`).join('\n');
  const todosLines = SAMPLE_TODOS.map((t) => `- ${t}`).join('\n');

  const userPrompt = task.prompt && task.prompt.trim().length > 0
    ? task.prompt
    : '今日の空き時間と推奨作業を提案してください。';

  const fullPrompt = `${userPrompt}

【今日の予定】
${eventsLines}

【今日中に終わらせたいタスク】
${todosLines}

【出力フォーマット】
必ず以下のキーを含むJSONを返してください:
{
  "free_slots": [{"start": "HH:MM", "end": "HH:MM", "duration_min": number}],
  "suggested_allocations": [{"slot_start": "HH:MM", "task": "タスク名", "duration_min": number, "reason": "理由"}],
  "warnings": ["警告メッセージがあれば"],
  "total_free_minutes": number
}`;

  const ai = await callGemini(fullPrompt, {
    apiKey: config.gemini_api_key ?? '',
    maxTokens: 2048,
    temperature: 0.2,
    responseJson: true,
  });

  steps[1] = { ...steps[1], status: 'done', at: new Date().toISOString() };
  steps.push({ label: '結果を保存', status: 'done', at: new Date().toISOString() });

  info(
    `[calendar-organize] task ${task.id} 完了 (入力 ${ai.inputTokens} / 出力 ${ai.outputTokens} tokens, $${ai.costUsd.toFixed(6)})`,
  );

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
      started_at: startTime,
      sample_events_count: SAMPLE_EVENTS.length,
    },
  };
}
