/**
 * スキル: email-summary (Gmail未読メールを要約・優先度判定)
 *
 * ⚠️ 現状ステータス: 「保留 (MCP経由実装待ち)」
 *
 * 当初 gmail.readonly OAuth scope を自前実装する計画だったが、
 * Google OAuth verification の負担 (動画提出 / 審査数ヶ月) を避けるため、
 * 外部 MCP サーバ (Composio / Zapier MCP 等) 経由で実装する方針に変更。
 * 詳細: docs/plans/mcp-integration.md
 *
 * 現状の実装は内部用 (北村本人の検証用) として残すが、
 * 本番運用では MCP コネクタ経由に置換予定。
 *
 * 動作要件:
 *   - user_calendar_settings の OAuth token に gmail.readonly scope が含まれていること
 *   - 現状の本番ユーザーには付与されていない → 起動時にスコープ不足エラーが返る
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchUnreadEmails, GoogleAuthError } from '../google-calendar.js';
import { callGemini } from '../ai/gemini.js';
import type { AgentConfig, AiTask, TaskResultJson } from '../types.js';
import { info, warn } from '../logger.js';

interface EmailSummaryArgs {
  lookback_hours?: number;
  max_emails?: number;
}

export async function runEmailSummary(
  task: AiTask,
  config: AgentConfig,
  supabase: SupabaseClient,
): Promise<TaskResultJson> {
  const startedAt = new Date().toISOString();
  const steps: TaskResultJson['steps'] = [];

  const args = ((task.package_snapshot as { args?: EmailSummaryArgs } | null)?.args ??
    {}) as EmailSummaryArgs;
  const lookbackHours = args.lookback_hours ?? 24;
  const maxEmails = args.max_emails ?? 20;

  // Step 1: Gmail から未読取得
  steps.push({ label: 'Gmail から未読メール取得', status: 'running', at: new Date().toISOString() });
  let emails: Awaited<ReturnType<typeof fetchUnreadEmails>>;
  try {
    emails = await fetchUnreadEmails(supabase, task.user_id, {
      lookbackHours,
      maxResults: maxEmails,
    });
    info(`[email-summary] fetched ${emails.length} unread emails`);
    steps[0] = { ...steps[0], status: 'done', at: new Date().toISOString() };
  } catch (e) {
    const msg = e instanceof GoogleAuthError ? e.message : String(e);
    steps[0] = { ...steps[0], status: 'failed', at: new Date().toISOString(), detail: msg };
    throw e;
  }

  if (emails.length === 0) {
    return {
      executor: 'simple',
      steps: [
        ...steps,
        { label: '未読メールなし', status: 'done', at: new Date().toISOString() },
      ],
      output: JSON.stringify(
        { emails: [], must_reply_today_count: 0, message: '未読メールはありません' },
        null,
        2,
      ),
      usage: { input_tokens: 0, output_tokens: 0, cost_usd: 0, model: 'none' },
      meta: { skill_id: 'email-summary', started_at: startedAt, email_count: 0 },
    };
  }

  // Step 2: AI で要約
  steps.push({ label: 'AIで要約 + 優先度判定', status: 'running', at: new Date().toISOString() });

  const prompt = `以下の未読メール ${emails.length}件 を 3行で要約し、 優先度 (high/medium/low) を判定してください。

${emails
  .map(
    (e, i) =>
      `--- メール ${i + 1} ---\nFrom: ${e.from}\nSubject: ${e.subject}\nReceived: ${e.receivedAt}\nSnippet: ${e.snippet}`,
  )
  .join('\n\n')}

【出力JSON】
{
  "emails": [
    {"index": 1, "from": "...", "subject": "...", "summary": "3行要約", "priority": "high|medium|low", "needs_reply": true|false}
  ],
  "must_reply_today_count": number,
  "overall_summary": "全体所感 (1-2文)"
}`;

  let ai;
  try {
    ai = await callGemini(prompt, {
      apiKey: config.gemini_api_key ?? '',
      maxTokens: 3072,
      temperature: 0.2,
      responseJson: true,
    });
    steps[1] = { ...steps[1], status: 'done', at: new Date().toISOString() };
  } catch (e) {
    warn('[email-summary] AI summary failed', e);
    steps[1] = {
      ...steps[1],
      status: 'failed',
      at: new Date().toISOString(),
      detail: e instanceof Error ? e.message : String(e),
    };
    throw e;
  }

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
    meta: { skill_id: 'email-summary', started_at: startedAt, email_count: emails.length },
  };
}
