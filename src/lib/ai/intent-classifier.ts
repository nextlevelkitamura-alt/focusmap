/**
 * Intent Classifier — DeepSeek V4 Pro による自然言語 → スキル判定
 *
 * 入力: ユーザーの自然言語メッセージ
 * 出力: { skill_id, confidence, args, reasoning } の構造化データ
 *
 * Vercel AI SDK の generateObject() で structured output。
 * DEEPSEEK_API_KEY が無い場合は Gemini Flash-Lite にフォールバック。
 */

import { generateObject } from 'ai';
import { deepseek } from '@ai-sdk/deepseek';
import { google } from '@ai-sdk/google';
import { z } from 'zod';

const INTENT_SCHEMA = z.object({
  skill_id: z
    .enum(['calendar-organize', 'web-research', 'email-summary'])
    .nullable()
    .describe('推定されたスキルID。判定不可時は null'),
  confidence: z.number().min(0).max(1).describe('判定の自信度 (0-1)'),
  args: z
    .object({
      urls: z.array(z.string()).optional().describe('web-research 用: 巡回URL'),
      keywords: z.array(z.string()).optional().describe('web-research 用: キーワード'),
      lookback_hours: z.number().optional().describe('email-summary 用: 過去N時間'),
      max_emails: z.number().optional().describe('email-summary 用: 取得件数上限'),
    })
    .describe('スキル実行時のパラメータ'),
  reasoning: z.string().describe('判定根拠 (日本語、1-2文)'),
  followup_question: z
    .string()
    .nullable()
    .describe('スキル判定不可で追加情報が必要な場合の聞き返し質問'),
});

export type IntentResult = z.infer<typeof INTENT_SCHEMA>;

const SYSTEM_PROMPT = `あなたは Focusmap の自動化スキル判定エキスパートです。
ユーザーの自然言語の指示を解析し、最適なスキルを選んでください。

利用可能なスキル:
- calendar-organize: Google Calendar の今日の予定を取得し、空き時間と推奨作業を提案
- web-research: 指定URLを Playwright で巡回し、新着情報を要約
- email-summary: Gmail の未読メールを要約し、優先度を判定

判定原則:
- 「予定」「カレンダー」「スケジュール」「空き時間」 → calendar-organize
- 「Webサイト」「URL」「巡回」「確認して」「ニュース」「価格」 → web-research (URL がある場合は args.urls に入れる)
- 「メール」「Gmail」「未読」「返信」 → email-summary
- どれにも該当しない / 情報不足 → skill_id: null + followup_question に聞き返し
- 複数該当する可能性がある場合は最も主要なものを選び、 confidence を下げる`;

function getModel() {
  // DEEPSEEK_API_KEY があれば DeepSeek V4 Pro、 なければ Gemini Flash-Lite にフォールバック
  if (process.env.DEEPSEEK_API_KEY) {
    const modelId = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
    return deepseek(modelId);
  }
  return google('gemini-2.5-flash-lite');
}

export async function classifyIntent(userMessage: string): Promise<IntentResult> {
  const model = getModel();
  const result = await generateObject({
    model,
    system: SYSTEM_PROMPT,
    prompt: `ユーザーメッセージ:\n${userMessage}`,
    schema: INTENT_SCHEMA,
    temperature: 0.2,
  });
  return result.object;
}

export function getActiveModelLabel(): string {
  if (process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
  }
  return 'gemini-2.5-flash-lite (fallback)';
}
